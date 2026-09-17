import { HttpError, cleanText, json, readJson } from "./http";
import { audit, messageSelect, presentMessage, type StoredMessageRow } from "./repository";
import { INBOX_ROOM } from "./realtime";
import type { AppEnv, SessionUser } from "./types";
import { deleteMessageForEveryone, editTextMessage } from "./zapi";
import { isZApiLid } from "./recipient-safety";

type Action = "edit" | "delete";

interface ActionMessage {
  id: string;
  direction: string;
  type: string;
  body: string | null;
  mediaKey: string | null;
  status: string;
  zapiMessageId: string | null;
  recipientPhone: string | null;
  createdAt: string;
  editedAt: string | null;
  deletedAt: string | null;
  recipientMismatchAt: string | null;
  mutationToken: string | null;
}

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const DELETE_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

export function assertMessageActionAllowed(message: ActionMessage, action: Action, now = Date.now()): void {
  if (message.direction !== "outbound" || message.deletedAt) throw new HttpError("Esta mensagem não pode ser alterada.", 409);
  if (action === "edit" && message.type !== "text") throw new HttpError("Somente mensagens de texto podem ser editadas no WhatsApp.", 409);
  if (!["sent", "delivered", "read"].includes(message.status) || !message.zapiMessageId || !message.recipientPhone) {
    throw new HttpError("A mensagem não tem confirmação e destinatário original suficientes para esta ação.", 409);
  }
  if (message.recipientMismatchAt) throw new HttpError("Destinatário divergente. Verifique a mensagem no WhatsApp antes de agir.", 409);
  if (isZApiLid(message.recipientPhone)) throw new HttpError("A Z-API não confirmou esta ação para identificadores privados.", 409);
  if (message.mutationToken) throw new HttpError("Já existe uma alteração desta mensagem em andamento.", 409);
  const age = now - new Date(message.createdAt).getTime();
  if (!Number.isFinite(age) || age < 0 || age > (action === "edit" ? EDIT_WINDOW_MS : DELETE_WINDOW_MS)) {
    throw new HttpError(action === "edit" ? "O prazo de 15 minutos para editar terminou." : "O prazo de dois dias para apagar para todos terminou.", 409);
  }
}

async function loadMessage(env: AppEnv, conversationId: string, messageId: string): Promise<ActionMessage> {
  const message = await env.DB.prepare(`SELECT id, direction, type, body, media_key AS mediaKey, status,
    zapi_message_id AS zapiMessageId, recipient_phone AS recipientPhone, created_at AS createdAt,
    edited_at AS editedAt, deleted_at AS deletedAt, recipient_mismatch_at AS recipientMismatchAt, mutation_token AS mutationToken
    FROM messages WHERE conversation_id = ?1 AND id = ?2`).bind(conversationId, messageId).first<ActionMessage>();
  if (!message) throw new HttpError("Mensagem não encontrada nesta conversa.", 404);
  return message;
}

async function claimMessage(env: AppEnv, message: ActionMessage): Promise<string> {
  const token = crypto.randomUUID();
  const claimed = await env.DB.prepare(`UPDATE messages SET mutation_token = ?1 WHERE id = ?2
    AND mutation_token IS NULL AND deleted_at IS NULL AND recipient_mismatch_at IS NULL
    AND edited_at IS ?3`)
    .bind(token, message.id, message.editedAt).run();
  if (!claimed.meta.changes) throw new HttpError("A mensagem foi alterada por outra sessão. Atualize a conversa.", 409);
  return token;
}

async function releaseClaim(env: AppEnv, messageId: string, token: string): Promise<void> {
  await env.DB.prepare("UPDATE messages SET mutation_token = NULL WHERE id = ?1 AND mutation_token = ?2").bind(messageId, token).run();
}

async function broadcastUpdated(env: AppEnv, conversationId: string, messageId: string): Promise<Response> {
  const row = await env.DB.prepare(`${messageSelect} WHERE id = ?1 AND conversation_id = ?2`)
    .bind(messageId, conversationId).first<StoredMessageRow>();
  if (!row) throw new HttpError("Mensagem não encontrada nesta conversa.", 404);
  const message = presentMessage(row);
  await Promise.all([
    env.CHAT_ROOMS.getByName(conversationId).broadcast({ type: "message.updated", message }),
    env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId }),
  ]);
  return json({ message });
}

export async function editMessage(request: Request, env: AppEnv, user: SessionUser, conversationId: string, messageId: string): Promise<Response> {
  const input = await readJson<{ body?: unknown; expectedEditedAt?: unknown }>(request);
  const body = cleanText(input.body, 10_000, true)!;
  const message = await loadMessage(env, conversationId, messageId);
  assertMessageActionAllowed(message, "edit");
  if (input.expectedEditedAt !== message.editedAt) throw new HttpError("A mensagem foi alterada por outra sessão. Atualize a conversa.", 409);
  if (body === message.body) throw new HttpError("Escreva um texto diferente para editar.", 422);
  const token = await claimMessage(env, message);
  try {
    await editTextMessage(env, message.recipientPhone!, message.zapiMessageId!, body);
  } catch (reason) {
    await releaseClaim(env, message.id, token);
    throw reason;
  }
  const changed = await env.DB.prepare(`UPDATE messages SET body = ?1, edited_at = ?2, mutation_token = NULL
    WHERE id = ?3 AND mutation_token = ?4`).bind(body, new Date().toISOString(), message.id, token).run();
  if (!changed.meta.changes) throw new HttpError("A edição foi solicitada no WhatsApp, mas o CRM não conseguiu atualizar o histórico. Verifique antes de repetir.", 500);
  await audit(env, user, "message.edit", "message", message.id, { conversationId });
  return broadcastUpdated(env, conversationId, messageId);
}

export async function deleteMessage(env: AppEnv, user: SessionUser, conversationId: string, messageId: string): Promise<Response> {
  const message = await loadMessage(env, conversationId, messageId);
  assertMessageActionAllowed(message, "delete");
  const token = await claimMessage(env, message);
  try {
    await deleteMessageForEveryone(env, message.recipientPhone!, message.zapiMessageId!);
  } catch (reason) {
    await releaseClaim(env, message.id, token);
    throw reason;
  }
  const changed = await env.DB.prepare(`UPDATE messages SET body = NULL, media_key = NULL, thumbnail_key = NULL,
    file_name = NULL, mime = NULL, size = NULL, duration = NULL, deleted_at = ?1, mutation_token = NULL
    WHERE id = ?2 AND mutation_token = ?3`).bind(new Date().toISOString(), message.id, token).run();
  if (!changed.meta.changes) throw new HttpError("A exclusão foi solicitada no WhatsApp, mas o CRM não conseguiu atualizar o histórico. Verifique antes de repetir.", 500);
  await audit(env, user, "message.delete_for_everyone", "message", message.id, { conversationId });
  if (message.mediaKey) await env.MEDIA.delete(message.mediaKey).catch(() => undefined);
  return broadcastUpdated(env, conversationId, messageId);
}
