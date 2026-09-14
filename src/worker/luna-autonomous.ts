import { cleanText } from "./http";
import { LunaServiceError, runLunaAgent } from "./luna-agent-service";
import { saveAnalysis } from "./luna-memory";
import { recordLunaRun } from "./luna-observability";
import { conversationExcerpt, lunaInputTypeForMessage, type PassiveMessage, type RecentMessageRow } from "./luna-passive";
import type { ValidatedLunaRequest } from "./luna-types";
import type { MessageRow } from "./repository";
import { INBOX_ROOM } from "./realtime";
import type { AppEnv } from "./types";
import { sendText } from "./zapi";

interface AutonomousConversationRow {
  contactId: string;
  phone: string;
  assigneeId: string | null;
  serviceStatus: string;
  lunaAutonomousEnabled: number;
}

export function autonomousRepliesEnabled(env: Pick<AppEnv, "LUNA_AUTONOMOUS_ENABLED">): boolean {
  return env.LUNA_AUTONOMOUS_ENABLED?.trim().toLowerCase() === "true";
}

export function shouldReplyAutonomously(message: PassiveMessage, conversation: Pick<AutonomousConversationRow, "assigneeId" | "serviceStatus" | "lunaAutonomousEnabled">): boolean {
  return message.direction === "inbound" && Boolean(conversation.lunaAutonomousEnabled) && !conversation.assigneeId && conversation.serviceStatus !== "resolved";
}

export function buildAutonomousLunaInput(message: PassiveMessage, clientId: string, recentMessages: RecentMessageRow[], firstReply: boolean): ValidatedLunaRequest {
  const attachmentType = lunaInputTypeForMessage(message);
  const transcript = conversationExcerpt(recentMessages);
  const text = [
    "Atendimento autônomo do WhatsApp institucional da Karrer.",
    firstReply
      ? "Esta é a primeira resposta da Luna nesta conversa. Identifique-se brevemente como Luna, assistente virtual da Karrer."
      : "A Luna já respondeu nesta conversa; não repita uma apresentação completa.",
    "Responda somente ao que o cliente pediu, com linguagem humana, curta e profissional.",
    "Não dê parecer jurídico, não prometa resultado, prazo ou valor e não invente informações.",
    "Quando houver dúvida, decisão sensível ou necessidade de ação humana, marque requiresHumanReview como true.",
    "Se o cliente pedir para encerrar ou não receber mensagens, apenas confirme respeitosamente e não prolongue a conversa.",
    "Conversa recente:",
    transcript,
  ].join("\n");
  return {
    clientId,
    conversationId: message.conversationId,
    inputType: attachmentType ?? "text",
    text,
    fileKey: attachmentType ? message.mediaKey : null,
    metadata: {
      mode: "autonomous_reply",
      direction: message.direction,
      messageId: message.id,
      firstReply,
      unsupportedAttachment: message.type !== "text" && !attachmentType,
    },
  };
}

async function setReplyStatus(env: AppEnv, messageId: string, status: "sent" | "skipped" | "failed", errorCode: string | null = null): Promise<void> {
  await env.DB.prepare(`UPDATE luna_autonomous_replies SET status = ?1, error_code = ?2,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE inbound_message_id = ?3`)
    .bind(status, errorCode, messageId).run();
}

export async function processAutonomousReply(env: AppEnv, message: PassiveMessage): Promise<void> {
  if (!autonomousRepliesEnabled(env) || !env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID || message.direction !== "inbound") return;
  const startedAt = Date.now();
  const requestId = `autonomous-${message.id}`;
  let input: ValidatedLunaRequest | null = null;
  let claimed = false;
  let runRecorded = false;
  try {
    const conversation = await env.DB.prepare(`SELECT c.contact_id AS contactId, ct.phone, c.assignee_id AS assigneeId,
      c.service_status AS serviceStatus, c.luna_autonomous_enabled AS lunaAutonomousEnabled
      FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ?1`)
      .bind(message.conversationId).first<AutonomousConversationRow>();
    if (!conversation || !shouldReplyAutonomously(message, conversation)) return;

    const claim = await env.DB.prepare(`INSERT INTO luna_autonomous_replies
      (inbound_message_id, conversation_id, status) VALUES (?1, ?2, 'processing') ON CONFLICT(inbound_message_id) DO NOTHING`)
      .bind(message.id, message.conversationId).run();
    if (!claim.meta.changes) return;
    claimed = true;

    const [recent, previousReplies] = await Promise.all([
      env.DB.prepare(`SELECT direction, type, body, file_name AS fileName, created_at AS createdAt
        FROM messages WHERE conversation_id = ?1 AND created_at <= ?2 ORDER BY created_at DESC, id DESC LIMIT 8`)
        .bind(message.conversationId, message.createdAt).all<RecentMessageRow>(),
      env.DB.prepare(`SELECT COUNT(*) AS count FROM luna_autonomous_replies
        WHERE conversation_id = ?1 AND status = 'sent'`).bind(message.conversationId).first<{ count: number }>(),
    ]);
    input = buildAutonomousLunaInput(message, conversation.contactId, [...recent.results].reverse(), Number(previousReplies?.count ?? 0) === 0);
    const result = await runLunaAgent(env, { id: null }, input, requestId);
    await saveAnalysis(env, { id: null }, input, result.analysis, result.fileHash);
    await env.DB.prepare(`INSERT INTO luna_conversation_summaries
      (conversation_id, contact_id, summary, through_message_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary,
        through_message_at = excluded.through_message_at,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE luna_conversation_summaries.through_message_at IS NULL
        OR excluded.through_message_at >= luna_conversation_summaries.through_message_at`)
      .bind(message.conversationId, conversation.contactId, result.analysis.summary, message.createdAt).run();
    await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: null, status: "completed", model: result.model,
      durationMs: Date.now() - startedAt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens, totalTokens: result.usage.totalTokens, toolCalls: result.toolCalls });
    runRecorded = true;

    if (result.analysis.requiresHumanReview || !result.analysis.replyToClient) {
      await setReplyStatus(env, message.id, "skipped", "AI_HUMAN_REVIEW_REQUIRED");
      return;
    }
    const current = await env.DB.prepare(`SELECT c.assignee_id AS assigneeId, c.service_status AS serviceStatus,
      c.luna_autonomous_enabled AS lunaAutonomousEnabled,
      (SELECT id FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC, id DESC LIMIT 1) AS latestMessageId
      FROM conversations c WHERE c.id = ?1`).bind(message.conversationId)
      .first<{ assigneeId: string | null; serviceStatus: string; lunaAutonomousEnabled: number; latestMessageId: string | null }>();
    if (!current || !current.lunaAutonomousEnabled || current.assigneeId || current.serviceStatus === "resolved" || current.latestMessageId !== message.id) {
      await setReplyStatus(env, message.id, "skipped", "AI_REPLY_SUPERSEDED");
      return;
    }

    const body = cleanText(result.analysis.replyToClient, 2_000, true)!;
    const providerId = await sendText(env, conversation.phone, body);
    const outboundId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO messages
        (id, conversation_id, sender_user_id, direction, type, body, status, zapi_message_id, created_at)
        VALUES (?1, ?2, NULL, 'outbound', 'text', ?3, 'sent', ?4, ?5)`)
        .bind(outboundId, message.conversationId, body, providerId, createdAt),
      env.DB.prepare("UPDATE conversations SET last_message_at = ?1, updated_at = ?1 WHERE id = ?2")
        .bind(createdAt, message.conversationId),
      env.DB.prepare(`UPDATE luna_autonomous_replies SET outbound_message_id = ?1, status = 'sent', error_code = NULL,
        updated_at = ?2 WHERE inbound_message_id = ?3`).bind(outboundId, createdAt, message.id),
    ]);
    const outbound: MessageRow = { id: outboundId, conversationId: message.conversationId, direction: "outbound", type: "text",
      body, mediaKey: null, fileName: null, duration: null, status: "sent", createdAt };
    await env.CHAT_ROOMS.getByName(message.conversationId).broadcast({ type: "message.new", message: outbound });
    await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId: message.conversationId });
    console.log(JSON.stringify({ event: "luna.autonomous.sent", requestId, clientId: conversation.contactId,
      conversationId: message.conversationId, inputType: input.inputType, durationMs: Date.now() - startedAt,
      model: result.model, inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }));
  } catch (reason) {
    const code = reason instanceof LunaServiceError ? reason.code : "AI_AUTONOMOUS_REPLY_FAILED";
    if (claimed) await setReplyStatus(env, message.id, "failed", code).catch(() => undefined);
    if (input && !runRecorded) await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: null, status: "failed",
      errorCode: code, durationMs: Date.now() - startedAt });
    console.error(JSON.stringify({ event: "luna.autonomous.failed", requestId, clientId: input?.clientId ?? null,
      conversationId: message.conversationId, inputType: input?.inputType ?? null, durationMs: Date.now() - startedAt, code }));
  }
}

export function scheduleAutonomousReply(env: AppEnv, ctx: ExecutionContext | undefined, message: PassiveMessage): void {
  if (!ctx || !autonomousRepliesEnabled(env) || !env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) return;
  ctx.waitUntil(processAutonomousReply(env, message));
}
