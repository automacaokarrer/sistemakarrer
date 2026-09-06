import { safeEqual } from "./auth";
import { HttpError, json, readJson } from "./http";
import { messageSelect, type MessageRow } from "./repository";
import type { AppEnv, ZApiPayload } from "./types";
import { normalizeIncoming, storeRemoteMedia } from "./zapi";

function statusFromProvider(value: string | undefined): MessageRow["status"] | null {
  const status = value?.toLowerCase();
  if (status === "sent" || status === "delivered" || status === "read" || status === "failed") return status;
  return null;
}

function isDeliveryUpdate(payload: ZApiPayload): boolean {
  return Boolean(payload.messageId && payload.status && !payload.phone && !payload.text && !payload.image && !payload.audio && !payload.video && !payload.document);
}

export async function handleZApiWebhook(request: Request, env: AppEnv, suppliedToken: string): Promise<Response> {
  if (!env.ZAPI_WEBHOOK_TOKEN) throw new HttpError("Webhook Z-API ainda não configurado.", 503);
  if (!(await safeEqual(suppliedToken, env.ZAPI_WEBHOOK_TOKEN))) throw new HttpError("Webhook não autorizado.", 401);

  const payload = await readJson<ZApiPayload>(request, 2_000_000);
  if (isDeliveryUpdate(payload)) {
    const status = statusFromProvider(payload.status);
    if (status) {
      await env.DB.prepare("UPDATE messages SET status = ?1 WHERE zapi_message_id = ?2")
        .bind(status, payload.messageId).run();
    }
    return json({ ok: true });
  }

  const incoming = normalizeIncoming(payload);
  const existing = await env.DB.prepare("SELECT id FROM messages WHERE zapi_message_id = ?1")
    .bind(incoming.zapiMessageId).first<{ id: string }>();
  if (existing) return json({ ok: true, duplicate: true });

  let contact = await env.DB.prepare("SELECT id FROM contacts WHERE phone = ?1")
    .bind(incoming.phone).first<{ id: string }>();
  if (!contact) {
    contact = { id: crypto.randomUUID() };
    await env.DB.prepare("INSERT INTO contacts (id, phone, name) VALUES (?1, ?2, ?3)")
      .bind(contact.id, incoming.phone, incoming.name).run();
  } else if (incoming.name !== incoming.phone) {
    await env.DB.prepare("UPDATE contacts SET name = COALESCE(name, ?1), updated_at = ?2 WHERE id = ?3")
      .bind(incoming.name, new Date().toISOString(), contact.id).run();
  }

  let conversation = await env.DB.prepare("SELECT id FROM conversations WHERE contact_id = ?1")
    .bind(contact.id).first<{ id: string }>();
  if (!conversation) {
    conversation = { id: crypto.randomUUID() };
    await env.DB.prepare("INSERT INTO conversations (id, contact_id) VALUES (?1, ?2)")
      .bind(conversation.id, contact.id).run();
  }

  const messageId = crypto.randomUUID();
  let mediaKey: string | null = null;
  if (incoming.mediaUrl) {
    mediaKey = `zapi/${conversation.id}/${messageId}`;
    await storeRemoteMedia(env, incoming.mediaUrl, mediaKey, incoming.mime);
  }

  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages
      (id, conversation_id, direction, type, body, media_key, file_name, mime, duration, status, zapi_message_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(messageId, conversation.id, incoming.direction, incoming.type, incoming.body, mediaKey, incoming.fileName, incoming.mime, incoming.duration,
        incoming.direction === "inbound" ? "received" : "sent", incoming.zapiMessageId, incoming.createdAt),
    env.DB.prepare(`UPDATE conversations SET last_message_at = ?1,
      unread_count = unread_count + CASE WHEN ?2 = 'inbound' THEN 1 ELSE 0 END,
      updated_at = ?1 WHERE id = ?3`)
      .bind(incoming.createdAt, incoming.direction, conversation.id),
  ]);

  const message = await env.DB.prepare(`${messageSelect} WHERE id = ?1`).bind(messageId).first<MessageRow>();
  if (message) await env.CHAT_ROOMS.getByName(conversation.id).broadcast({ type: "message.new", message });
  return json({ ok: true }, { status: 201 });
}
