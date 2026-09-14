import { safeEqual } from "./auth";
import { HttpError, json, normalizePhone, readJson } from "./http";
import { messageSelect, type MessageRow } from "./repository";
import type { AppEnv, ZApiPayload } from "./types";
import { normalizeIncoming, normalizeStatusUpdate, storeRemoteMedia } from "./zapi";
import { INBOX_ROOM } from "./realtime";
import { scheduleHumanConversationMemory } from "./luna-passive";
import { scheduleAutonomousReply } from "./luna-autonomous";
import { scheduleAutomaticLeadClassification } from "./lead-classification";

export function presencePhoneCandidates(phone: string): string[] {
  if (!phone.startsWith("55")) return [phone];
  const local = phone.slice(4);
  if (phone.length === 12 && /^[6-9]/.test(local)) return [phone, `${phone.slice(0, 4)}9${local}`];
  if (phone.length === 13 && local.startsWith("9")) return [phone, `${phone.slice(0, 4)}${local.slice(1)}`];
  return [phone];
}

export async function handleZApiWebhook(request: Request, env: AppEnv, suppliedToken: string,
  ctx?: ExecutionContext): Promise<Response> {
  if (!env.ZAPI_WEBHOOK_TOKEN) throw new HttpError("Webhook Z-API ainda não configurado.", 503);
  if (!(await safeEqual(suppliedToken, env.ZAPI_WEBHOOK_TOKEN))) throw new HttpError("Webhook não autorizado.", 401);

  const payload = await readJson<ZApiPayload>(request, 2_000_000);
  if (payload.type?.toLowerCase() === "presencechatcallback") {
    const phone = normalizePhone(payload.phone);
    const presence = payload.status?.toUpperCase();
    if (presence === "PAUSED") return json({ ok: true });
    if (!presence || !["AVAILABLE", "UNAVAILABLE", "COMPOSING", "RECORDING"].includes(presence)) return json({ ok: true });
    const online = presence === "AVAILABLE" || presence === "COMPOSING" || presence === "RECORDING";
    const lastSeenValue = payload.lastSeen && payload.lastSeen > 0 ? payload.lastSeen : Date.now();
    const lastSeenAt = new Date(lastSeenValue < 1_000_000_000_000 ? lastSeenValue * 1_000 : lastSeenValue).toISOString();
    const [primary, alternate] = presencePhoneCandidates(phone);
    const conversation = await env.DB.prepare("SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE ct.phone = ?1 OR ct.phone = ?2 ORDER BY CASE WHEN ct.phone = ?1 THEN 0 ELSE 1 END LIMIT 1")
      .bind(primary, alternate ?? primary).first<{ id: string }>();
    if (conversation) {
      await env.DB.prepare("UPDATE conversations SET online = ?1, last_seen_at = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(online ? 1 : 0, lastSeenAt, new Date().toISOString(), conversation.id).run();
      await env.CHAT_ROOMS.getByName(conversation.id).broadcast({ type: "conversation.presence", online, lastSeenAt });
      await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId: conversation.id });
    }
    return json({ ok: true });
  }
  const statusUpdates = normalizeStatusUpdate(payload);
  if (statusUpdates) {
    if (statusUpdates.length) {
      const affected = await Promise.all(statusUpdates.map(({ messageId, status }) => env.DB.prepare("SELECT id, conversation_id AS conversationId FROM messages WHERE zapi_message_id = ?1")
        .bind(messageId).first<{ id: string; conversationId: string }>().then((message) => ({ message, status }))));
      await env.DB.batch(statusUpdates.map(({ messageId, status }) =>
        env.DB.prepare("UPDATE messages SET status = ?1 WHERE zapi_message_id = ?2")
          .bind(status, messageId),
      ));
      await Promise.all(affected.filter(({ message }) => Boolean(message)).map(async ({ message, status }) => {
        await env.CHAT_ROOMS.getByName(message!.conversationId).broadcast({ type: "message.status", messageId: message!.id, status });
        await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId: message!.conversationId });
      }));
    }
    return json({ ok: true, updated: statusUpdates.length });
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
      waiting_since = CASE WHEN ?2 = 'inbound' AND unread_count = 0 THEN ?1 ELSE waiting_since END,
      service_status = CASE WHEN ?2 = 'inbound' AND service_status IN ('waiting_customer', 'resolved') THEN 'new' ELSE service_status END,
      last_seen_at = CASE WHEN ?2 = 'inbound' THEN ?1 ELSE last_seen_at END,
      updated_at = ?1 WHERE id = ?3`)
      .bind(incoming.createdAt, incoming.direction, conversation.id),
  ]);

  const message = await env.DB.prepare(`${messageSelect} WHERE id = ?1`).bind(messageId).first<MessageRow>();
  if (message) await env.CHAT_ROOMS.getByName(conversation.id).broadcast({ type: "message.new", message });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId: conversation.id });
  scheduleHumanConversationMemory(env, ctx, { id: messageId, conversationId: conversation.id, direction: incoming.direction,
    type: incoming.type, body: incoming.body, mediaKey, fileName: incoming.fileName, mime: incoming.mime, createdAt: incoming.createdAt });
  scheduleAutonomousReply(env, ctx, { id: messageId, conversationId: conversation.id, direction: incoming.direction,
    type: incoming.type, body: incoming.body, mediaKey, fileName: incoming.fileName, mime: incoming.mime, createdAt: incoming.createdAt });
  if (incoming.direction === "inbound") scheduleAutomaticLeadClassification(env, ctx, conversation.id);
  return json({ ok: true }, { status: 201 });
}
