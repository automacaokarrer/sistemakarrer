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

interface CaptureOptions {
  force?: boolean;
  allowResolved?: boolean;
}

export function isHumanAttending(assigneeId: string | null, serviceStatus: string): boolean {
  return Boolean(assigneeId) && serviceStatus !== "resolved";
}

export function shouldAnalyzePassiveMessage(pendingCount: number, immediateAttachment: boolean, force = false): boolean {
  if (pendingCount <= 0) return false;
  return force || immediateAttachment || (pendingCount >= 3 && pendingCount % 3 === 0);
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
  return `${speaker}: ${content.slice(0, 500)}`;
}

export function buildPassiveLunaInput(message: PassiveMessage, clientId: string, recentMessages: RecentMessageRow[]): ValidatedLunaRequest {
  const attachmentType = mediaInputType(message);
  const transcript = recentMessages.slice(-8).map(transcriptLine).join("\n").slice(-5_000);
  const direction = message.direction === "inbound" ? "cliente" : "atendente humano";
  const text = [
    "Memória passiva do atendimento humano.",
    `A última mensagem foi enviada por: ${direction}.`,
    "Atualize fatos, pendências e resumo. Uso interno; nunca responda ao cliente.",
    "Conversa recente:",
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

async function captureHumanConversationMemory(env: AppEnv, message: PassiveMessage, options: CaptureOptions = {}): Promise<void> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) return;
  const startedAt = Date.now();
  const requestId = `passive-${message.id}`;
  let input: ValidatedLunaRequest | null = null;
  let actorId: string | null = null;
  try {
    const conversation = await env.DB.prepare(`SELECT contact_id AS contactId, assignee_id AS assigneeId,
      service_status AS serviceStatus FROM conversations WHERE id = ?1`)
      .bind(message.conversationId).first<HumanConversationRow>();
    if (!conversation || !conversation.assigneeId || (!options.allowResolved && !isHumanAttending(conversation.assigneeId, conversation.serviceStatus))) return;
    actorId = conversation.assigneeId!;
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS count FROM messages m
      LEFT JOIN luna_conversation_summaries s ON s.conversation_id = m.conversation_id
      WHERE m.conversation_id = ?1 AND m.created_at <= ?2
        AND (s.through_message_at IS NULL OR m.created_at > s.through_message_at)`)
      .bind(message.conversationId, message.createdAt).first<{ count: number }>();
    const pendingCount = Number(pending?.count ?? 0);
    const immediateAttachment = Boolean(mediaInputType(message));
    if (!shouldAnalyzePassiveMessage(pendingCount, immediateAttachment, options.force)) return;
    const recent = await env.DB.prepare(`SELECT direction, type, body, file_name AS fileName, created_at AS createdAt
      FROM messages WHERE conversation_id = ?1 AND created_at <= ?2 ORDER BY created_at DESC LIMIT 8`)
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
      cachedInputTokens: result.usage.cachedInputTokens, totalTokens: result.usage.totalTokens, toolCalls: result.toolCalls });
    console.log(JSON.stringify({ event: "luna.passive.completed", requestId, clientId: input.clientId,
      inputType: input.inputType, durationMs: Date.now() - startedAt, model: result.model, toolCalls: result.toolCalls,
      inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }));
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

async function flushHumanConversationMemory(env: AppEnv, conversationId: string): Promise<void> {
  const message = await env.DB.prepare(`SELECT id, conversation_id AS conversationId, direction, type, body,
    media_key AS mediaKey, file_name AS fileName, mime, created_at AS createdAt
    FROM messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 1`)
    .bind(conversationId).first<PassiveMessage>();
  if (message) await captureHumanConversationMemory(env, message, { force: true, allowResolved: true });
}

export function scheduleHumanConversationMemoryFlush(env: AppEnv, ctx: ExecutionContext | undefined, conversationId: string): void {
  if (!ctx || !env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) return;
  ctx.waitUntil(flushHumanConversationMemory(env, conversationId));
}
