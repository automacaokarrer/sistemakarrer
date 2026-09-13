import { LunaServiceError, runLunaAgent } from "./luna-agent-service";
import { saveAnalysis } from "./luna-memory";
import { recordLunaRun } from "./luna-observability";
import type { LunaInputType, ValidatedLunaRequest } from "./luna-types";
import type { AppEnv } from "./types";

export interface PassiveMessage {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  mediaKey: string | null;
  fileName: string | null;
  mime: string | null;
  createdAt: string;
}

interface HumanConversationRow {
  contactId: string;
  assigneeId: string | null;
  serviceStatus: string;
}

interface RecentMessageRow {
  direction: string;
  type: string;
  body: string | null;
  fileName: string | null;
  createdAt: string;
}

export function isHumanAttending(assigneeId: string | null, serviceStatus: string): boolean {
  return Boolean(assigneeId) && serviceStatus !== "resolved";
}

function mediaInputType(message: PassiveMessage): LunaInputType | null {
  if (!message.mediaKey) return null;
  if (message.type === "image" && ["image/jpeg", "image/png", "image/webp"].includes(message.mime ?? "")) return "image";
  if (message.type === "audio" && (message.mime ?? "").startsWith("audio/")) return "audio_transcription";
  if (message.type === "document" && message.mime === "application/pdf") return "pdf";
  return null;
}

function transcriptLine(message: RecentMessageRow): string {
  const speaker = message.direction === "inbound" ? "Cliente" : "Atendente";
  const content = message.body?.trim() || (message.fileName ? `[${message.type}: ${message.fileName}]` : `[${message.type}]`);
  return `${speaker}: ${content.slice(0, 800)}`;
}

export function buildPassiveLunaInput(message: PassiveMessage, clientId: string, recentMessages: RecentMessageRow[]): ValidatedLunaRequest {
  const attachmentType = mediaInputType(message);
  const transcript = recentMessages.slice(-12).map(transcriptLine).join("\n").slice(-10_000);
  const direction = message.direction === "inbound" ? "cliente" : "atendente humano";
  const text = [
    "Modo passivo de memória durante atendimento humano.",
    `A última mensagem foi enviada por: ${direction}.`,
    "Atualize fatos, pendências e o resumo acumulado. A saída é exclusivamente interna e nunca deve ser enviada ao cliente.",
    "Trecho recente da conversa:",
    transcript,
  ].join("\n");
  return {
    clientId,
    conversationId: message.conversationId,
    inputType: attachmentType ?? "text",
    text,
    fileKey: attachmentType ? message.mediaKey : null,
    metadata: { mode: "human_passive_memory", direction: message.direction, messageId: message.id,
      unsupportedAttachment: message.type !== "text" && !attachmentType },
  };
}

async function captureHumanConversationMemory(env: AppEnv, message: PassiveMessage): Promise<void> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) return;
  const startedAt = Date.now();
  const requestId = `passive-${message.id}`;
  let input: ValidatedLunaRequest | null = null;
  let actorId: string | null = null;
  try {
    const conversation = await env.DB.prepare(`SELECT contact_id AS contactId, assignee_id AS assigneeId,
      service_status AS serviceStatus FROM conversations WHERE id = ?1`)
      .bind(message.conversationId).first<HumanConversationRow>();
    if (!conversation || !isHumanAttending(conversation.assigneeId, conversation.serviceStatus)) return;
    actorId = conversation.assigneeId!;
    const recent = await env.DB.prepare(`SELECT direction, type, body, file_name AS fileName, created_at AS createdAt
      FROM messages WHERE conversation_id = ?1 AND created_at <= ?2 ORDER BY created_at DESC LIMIT 12`)
      .bind(message.conversationId, message.createdAt).all<RecentMessageRow>();
    input = buildPassiveLunaInput(message, conversation.contactId, [...recent.results].reverse());
    const result = await runLunaAgent(env, { id: actorId }, input, requestId);
    await saveAnalysis(env, { id: actorId }, input, result.analysis, result.fileHash);
    await env.DB.prepare(`INSERT INTO luna_conversation_summaries
      (conversation_id, contact_id, summary, through_message_at) VALUES (?1, ?2, ?3, ?4)
      ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary,
        through_message_at = excluded.through_message_at,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE luna_conversation_summaries.through_message_at IS NULL
        OR excluded.through_message_at >= luna_conversation_summaries.through_message_at`)
      .bind(message.conversationId, conversation.contactId, result.analysis.summary, message.createdAt).run();
    await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: actorId, status: "completed", model: result.model,
      durationMs: Date.now() - startedAt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.totalTokens, toolCalls: result.toolCalls });
    console.log(JSON.stringify({ event: "luna.passive.completed", requestId, clientId: input.clientId,
      inputType: input.inputType, durationMs: Date.now() - startedAt, model: result.model, toolCalls: result.toolCalls,
      inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }));
  } catch (reason) {
    const code = reason instanceof LunaServiceError ? reason.code : "AI_PASSIVE_CAPTURE_FAILED";
    if (input && actorId) await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: actorId,
      status: "failed", errorCode: code, durationMs: Date.now() - startedAt });
    console.error(JSON.stringify({ event: "luna.passive.failed", requestId, clientId: input?.clientId ?? null,
      inputType: input?.inputType ?? null, durationMs: Date.now() - startedAt, code }));
  }
}

export function scheduleHumanConversationMemory(env: AppEnv, ctx: ExecutionContext | undefined, message: PassiveMessage): void {
  if (!ctx || !env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) return;
  ctx.waitUntil(captureHumanConversationMemory(env, message));
}
