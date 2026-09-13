import { HttpError, cleanText, json, normalizePhone, readJson } from "./http";
import type { AppEnv, SessionUser } from "./types";
import { fetchContactProfilePicture, sendMedia, sendText } from "./zapi";
import { INBOX_ROOM } from "./realtime";
import { scheduleHumanConversationMemory, scheduleHumanConversationMemoryFlush } from "./luna-passive";

type Classification = "hot" | "warm" | "cold";
export type ServiceStatus = "new" | "in_progress" | "waiting_customer" | "resolved";

interface ConversationRow {
  id: string;
  contactId: string;
  createdAt: string;
  name: string | null;
  phone: string;
  bank: string | null;
  stage: string;
  classification: Classification;
  score: number;
  lastMessage: string | null;
  lastMessageType: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  online: number;
  lastSeenAt: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  avatarUrl: string;
  waitingSince: string | null;
  serviceStatus: ServiceStatus;
  firstResponseMinutes: number | null;
  firstResponderId: string | null;
  firstResponderName: string | null;
}

export interface MessageRow {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "audio" | "video" | "document";
  body: string | null;
  mediaKey: string | null;
  fileName: string | null;
  duration: number | null;
  status: "sending" | "sent" | "delivered" | "read" | "received" | "failed";
  createdAt: string;
}

const firstResponseJoins = `LEFT JOIN messages firstInbound ON firstInbound.id = (
    SELECT id FROM messages WHERE conversation_id = c.id AND direction = 'inbound' ORDER BY created_at, id LIMIT 1)
  LEFT JOIN messages firstReply ON firstReply.id = (
    SELECT id FROM messages WHERE conversation_id = c.id AND direction = 'outbound'
      AND sender_user_id IS NOT NULL AND status IN ('sent', 'delivered', 'read')
      AND created_at > firstInbound.created_at ORDER BY created_at, id LIMIT 1)`;

const conversationSelect = `SELECT c.id, c.contact_id AS contactId, c.created_at AS createdAt, COALESCE(ct.name, ct.phone) AS name,
  ct.phone, ct.bank, c.stage, c.classification, c.score, c.last_message_at AS lastMessageAt,
  c.unread_count AS unreadCount, c.online, c.last_seen_at AS lastSeenAt, c.waiting_since AS waitingSince, c.service_status AS serviceStatus, c.assignee_id AS assigneeId, u.name AS assigneeName,
  ROUND((julianday(firstReply.created_at) - julianday(firstInbound.created_at)) * 1440, 2) AS firstResponseMinutes,
  firstReply.sender_user_id AS firstResponderId, responder.name AS firstResponderName,
  (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
  (SELECT m.type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageType
  FROM conversations c JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.assignee_id
  ${firstResponseJoins} LEFT JOIN users responder ON responder.id = firstReply.sender_user_id`;

export const messageSelect = `SELECT id, conversation_id AS conversationId, direction, type, body,
  media_key AS mediaKey, file_name AS fileName, duration, status, created_at AS createdAt FROM messages`;

export function classification(value: unknown): Classification {
  if (value === "hot" || value === "warm" || value === "cold") return value;
  throw new HttpError("Classificação inválida.", 422);
}

export function conversationStatus(value: unknown): ServiceStatus {
  if (value === "new" || value === "in_progress" || value === "waiting_customer" || value === "resolved") return value;
  throw new HttpError("Status de atendimento inválido.", 422);
}

export async function audit(env: AppEnv, user: SessionUser | null, action: string, entityType: string, entityId: string | null, metadata?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(crypto.randomUUID(), user?.id ?? null, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null).run();
}

export async function listConversations(env: AppEnv, url: URL): Promise<Response> {
  const search = (url.searchParams.get("search") ?? "").trim();
  const kind = url.searchParams.get("classification");
  const bindings: Array<string | number> = [];
  let selected = "SELECT c.id FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE 1 = 1";
  if (search) {
    selected += " AND (ct.name LIKE ? OR ct.phone LIKE ?)";
    bindings.push(`%${search}%`, `%${search}%`);
  }
  if (kind) {
    selected += " AND c.classification = ?";
    bindings.push(classification(kind));
  }
  if (url.searchParams.get("unread") === "true") selected += " AND c.unread_count > 0";
  selected += " ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200";
  const query = `${conversationSelect} WHERE c.id IN (${selected}) ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`;
  const prepared = env.DB.prepare(query);
  const result = await (bindings.length ? prepared.bind(...bindings) : prepared).all<ConversationRow>();
  return json({ conversations: result.results.map((row) => ({ ...row, name: row.name ?? row.phone, online: Boolean(row.online), avatarUrl: `/api/contacts/${row.contactId}/avatar` })) });
}

export async function getContactAvatar(env: AppEnv, contactId: string): Promise<Response> {
  const contact = await env.DB.prepare("SELECT phone, avatar_key AS avatarKey, avatar_checked_at AS avatarCheckedAt FROM contacts WHERE id = ?1")
    .bind(contactId).first<{ phone: string; avatarKey: string | null; avatarCheckedAt: string | null }>();
  if (!contact) throw new HttpError("Contato não encontrado.", 404);
  const cacheFresh = contact.avatarCheckedAt && Date.now() - new Date(contact.avatarCheckedAt).getTime() < 7 * 24 * 60 * 60 * 1000;
  let avatarKey = contact.avatarKey;
  if (!cacheFresh) {
    const checkedAt = new Date().toISOString();
    try {
      const picture = await fetchContactProfilePicture(env, contact.phone);
      if (picture) {
        avatarKey = `contact-avatars/${contactId}`;
        await env.MEDIA.put(avatarKey, picture.body, { httpMetadata: { contentType: picture.mime } });
        await env.DB.prepare("UPDATE contacts SET avatar_key = ?1, avatar_checked_at = ?2 WHERE id = ?3").bind(avatarKey, checkedAt, contactId).run();
      } else {
        await env.DB.prepare("UPDATE contacts SET avatar_checked_at = ?1 WHERE id = ?2").bind(checkedAt, contactId).run();
      }
    } catch {
      await env.DB.prepare("UPDATE contacts SET avatar_checked_at = ?1 WHERE id = ?2").bind(checkedAt, contactId).run();
    }
  }
  if (!avatarKey) throw new HttpError("Foto do contato indisponível.", 404);
  const object = await env.MEDIA.get(avatarKey);
  if (!object) throw new HttpError("Foto do contato indisponível.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

export async function listMessages(env: AppEnv, conversationId: string, url: URL): Promise<Response> {
  const requested = Number(url.searchParams.get("limit") ?? 40);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 100) : 40;
  const before = url.searchParams.get("before");
  let statement: D1PreparedStatement;
  if (before) {
    const separator = before.lastIndexOf("|");
    if (separator < 1) throw new HttpError("Cursor inválido.", 422);
    const createdAt = before.slice(0, separator);
    const id = before.slice(separator + 1);
    statement = env.DB.prepare(`${messageSelect} WHERE conversation_id = ?1 AND (created_at < ?2 OR (created_at = ?2 AND id < ?3)) ORDER BY created_at DESC, id DESC LIMIT ?4`)
      .bind(conversationId, createdAt, id, limit + 1);
  } else {
    statement = env.DB.prepare(`${messageSelect} WHERE conversation_id = ?1 ORDER BY created_at DESC, id DESC LIMIT ?2`).bind(conversationId, limit + 1);
  }
  const result = await statement.all<MessageRow>();
  const hasMore = result.results.length > limit;
  const messages = result.results.slice(0, limit).reverse();
  const oldest = messages[0];
  return json({ messages, hasMore, nextCursor: hasMore && oldest ? `${oldest.createdAt}|${oldest.id}` : null });
}

export async function markConversationRead(env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const updatedAt = new Date().toISOString();
  const readResult = await env.DB.prepare("UPDATE conversations SET unread_count = 0, waiting_since = NULL, service_status = CASE WHEN service_status = 'new' THEN 'in_progress' ELSE service_status END, updated_at = ?1 WHERE id = ?2")
    .bind(updatedAt, conversationId).run();
  if (!readResult.meta.changes) throw new HttpError("Conversa não encontrada.", 404);
  const assignmentResult = await env.DB.prepare("UPDATE conversations SET assignee_id = ?1, updated_at = ?2 WHERE id = ?3 AND assignee_id IS NULL")
    .bind(user.id, updatedAt, conversationId).run();
  const assignment = await env.DB.prepare("SELECT c.assignee_id AS assigneeId, c.service_status AS serviceStatus, u.name AS assigneeName FROM conversations c LEFT JOIN users u ON u.id = c.assignee_id WHERE c.id = ?1")
    .bind(conversationId).first<{ assigneeId: string; assigneeName: string | null; serviceStatus: ServiceStatus }>();
  if (assignmentResult.meta.changes) await audit(env, user, "conversation.assign", "conversation", conversationId, { assigneeId: user.id });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  return json({ ok: true, unreadCount: 0, assigneeId: assignment?.assigneeId ?? user.id, assigneeName: assignment?.assigneeName ?? user.name, serviceStatus: assignment?.serviceStatus ?? "in_progress" });
}

export async function updateConversationAssignee(request: Request, env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const input = await readJson<{ userId?: unknown }>(request);
  const assigneeId = input.userId === null || input.userId === "" ? null : cleanText(input.userId, 100, true);
  let assigneeName: string | null = null;
  if (assigneeId) {
    const assignee = await env.DB.prepare("SELECT name FROM users WHERE id = ?1 AND active = 1 AND (role = 'admin' OR can_chat = 1)")
      .bind(assigneeId).first<{ name: string }>();
    if (!assignee) throw new HttpError("Selecione um atendente ativo com acesso ao chat.", 422);
    assigneeName = assignee.name;
  }
  const result = await env.DB.prepare("UPDATE conversations SET assignee_id = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(assigneeId, new Date().toISOString(), conversationId).run();
  if (!result.meta.changes) throw new HttpError("Conversa não encontrada.", 404);
  await audit(env, user, "conversation.assign", "conversation", conversationId, { assigneeId });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  return json({ ok: true, assigneeName });
}

export async function updateConversationStatus(request: Request, env: AppEnv, user: SessionUser, conversationId: string,
  ctx?: ExecutionContext): Promise<Response> {
  const input = await readJson<{ status?: unknown }>(request);
  const status = conversationStatus(input.status);
  const result = await env.DB.prepare("UPDATE conversations SET service_status = ?1, updated_at = ?2 WHERE id = ?3")
    .bind(status, new Date().toISOString(), conversationId).run();
  if (!result.meta.changes) throw new HttpError("Conversa não encontrada.", 404);
  await audit(env, user, "conversation.status.update", "conversation", conversationId, { status });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  if (status === "waiting_customer" || status === "resolved") scheduleHumanConversationMemoryFlush(env, ctx, conversationId);
  return json({ ok: true, status });
}

export async function sendMessage(request: Request, env: AppEnv, user: SessionUser, conversationId: string,
  ctx?: ExecutionContext): Promise<Response> {
  const input = await readJson<{ body?: unknown }>(request);
  const body = cleanText(input.body, 10_000, true)!;
  const conversation = await env.DB.prepare("SELECT ct.phone FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ?1")
    .bind(conversationId).first<{ phone: string }>();
  if (!conversation) throw new HttpError("Conversa não encontrada.", 404);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_user_id, direction, type, body, status, created_at) VALUES (?1, ?2, ?3, 'outbound', 'text', ?4, 'sending', ?5)").bind(id, conversationId, user.id, body, createdAt),
    env.DB.prepare("UPDATE conversations SET last_message_at = ?1, service_status = CASE WHEN service_status IN ('new', 'resolved') THEN 'in_progress' ELSE service_status END, updated_at = ?1 WHERE id = ?2").bind(createdAt, conversationId),
  ]);
  let status: MessageRow["status"] = "sent";
  let providerId: string | null = null;
  let failure: string | null = null;
  try {
    providerId = await sendText(env, conversation.phone, body);
  } catch (reason) {
    status = "failed";
    failure = reason instanceof Error ? reason.message : "Falha no envio";
  }
  await env.DB.prepare("UPDATE messages SET status = ?1, zapi_message_id = ?2, error_message = ?3 WHERE id = ?4").bind(status, providerId, failure, id).run();
  const message: MessageRow = { id, conversationId, direction: "outbound", type: "text", body, mediaKey: null, fileName: null, duration: null, status, createdAt };
  await env.CHAT_ROOMS.getByName(conversationId).broadcast({ type: "message.new", message });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  await audit(env, user, "message.send", "conversation", conversationId, { messageId: id, status });
  if (status !== "failed") scheduleHumanConversationMemory(env, ctx, { id, conversationId, direction: "outbound", type: "text",
    body, mediaKey: null, fileName: null, mime: null, createdAt });
  return json({ message }, { status: status === "failed" ? 502 : 201 });
}

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 32_768, bytes.length)));
  }
  return btoa(binary);
}

export async function sendMediaMessage(request: Request, env: AppEnv, user: SessionUser, conversationId: string,
  ctx?: ExecutionContext): Promise<Response> {
  const form = await request.formData();
  const file = form.get("file");
  const kind = form.get("kind");
  if (!(file instanceof File) || !file.size) throw new HttpError("Selecione um arquivo válido.", 422);
  if (kind !== "image" && kind !== "audio" && kind !== "document") throw new HttpError("Tipo de arquivo inválido.", 422);
  if (file.size > 10 * 1024 * 1024) throw new HttpError("O arquivo deve ter no máximo 10 MB.", 413);
  if (kind === "image" && !["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new HttpError("Use uma imagem JPG, PNG ou WebP.", 422);
  if (kind === "audio" && !file.type.startsWith("audio/")) throw new HttpError("Formato de áudio inválido.", 422);
  const safeName = (file.name || `${kind}.bin`).replace(/[^a-zA-Z0-9._-]/g, "_");
  const caption = cleanText(form.get("caption"), 2_000);
  const durationValue = Number(form.get("duration") ?? 0);
  const duration = kind === "audio" && Number.isFinite(durationValue) ? Math.max(0, Math.min(Math.round(durationValue), 3_600)) : null;
  const conversation = await env.DB.prepare("SELECT ct.phone FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ?1")
    .bind(conversationId).first<{ phone: string }>();
  if (!conversation) throw new HttpError("Conversa não encontrada.", 404);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const mediaKey = `uploads/${createdAt.slice(0, 10)}/${id}-${safeName}`;
  const buffer = await file.arrayBuffer();
  await env.MEDIA.put(mediaKey, buffer, { httpMetadata: { contentType: file.type || "application/octet-stream" }, customMetadata: { uploadedBy: user.id } });
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO messages (id, conversation_id, sender_user_id, direction, type, body, media_key, file_name, mime, size, duration, status, created_at)
      VALUES (?1, ?2, ?3, 'outbound', ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'sending', ?11)`)
      .bind(id, conversationId, user.id, kind, caption, mediaKey, safeName, file.type || "application/octet-stream", file.size, duration, createdAt),
    env.DB.prepare("UPDATE conversations SET last_message_at = ?1, service_status = CASE WHEN service_status IN ('new', 'resolved') THEN 'in_progress' ELSE service_status END, updated_at = ?1 WHERE id = ?2").bind(createdAt, conversationId),
  ]);
  let status: MessageRow["status"] = "sent";
  let providerId: string | null = null;
  let failure: string | null = null;
  try {
    providerId = await sendMedia(env, conversation.phone, kind, `data:${file.type || "application/octet-stream"};base64,${base64(buffer)}`, safeName, caption);
  } catch (reason) {
    status = "failed";
    failure = reason instanceof Error ? reason.message : "Falha no envio";
  }
  await env.DB.prepare("UPDATE messages SET status = ?1, zapi_message_id = ?2, error_message = ?3 WHERE id = ?4").bind(status, providerId, failure, id).run();
  const message: MessageRow = { id, conversationId, direction: "outbound", type: kind, body: caption, mediaKey, fileName: safeName, duration, status, createdAt };
  await env.CHAT_ROOMS.getByName(conversationId).broadcast({ type: "message.new", message });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  await audit(env, user, "message.send", "conversation", conversationId, { messageId: id, type: kind, status });
  if (status !== "failed") scheduleHumanConversationMemory(env, ctx, { id, conversationId, direction: "outbound", type: kind,
    body: caption, mediaKey, fileName: safeName, mime: file.type || "application/octet-stream", createdAt });
  return json({ message }, { status: status === "failed" ? 502 : 201 });
}

export async function leadSummary(env: AppEnv): Promise<Response> {
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS total,
    SUM(CASE WHEN classification = 'hot' THEN 1 ELSE 0 END) AS hot,
    SUM(CASE WHEN classification = 'warm' THEN 1 ELSE 0 END) AS warm,
    SUM(CASE WHEN classification = 'cold' THEN 1 ELSE 0 END) AS cold FROM conversations`)
    .first<{ total: number; hot: number; warm: number; cold: number }>();
  const daily = await env.DB.prepare("SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS total FROM conversations WHERE created_at >= datetime('now', '-30 days') GROUP BY day ORDER BY day")
    .all<{ day: string; total: number }>();
  const responseTime = await env.DB.prepare(`SELECT ROUND(AVG((julianday(firstReply.created_at) - julianday(firstInbound.created_at)) * 1440), 1) AS averageFirstResponseMinutes
    FROM conversations c ${firstResponseJoins} WHERE firstReply.id IS NOT NULL`).first<{ averageFirstResponseMinutes: number | null }>();
  return json({ total: Number(counts?.total ?? 0), hot: Number(counts?.hot ?? 0), warm: Number(counts?.warm ?? 0), cold: Number(counts?.cold ?? 0), averageFirstResponseMinutes: responseTime?.averageFirstResponseMinutes ?? null, daily: daily.results });
}

export async function updateClassification(request: Request, env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const input = await readJson<{ classification?: unknown }>(request);
  const value = classification(input.classification);
  const score = value === "hot" ? 75 : value === "warm" ? 50 : 25;
  const result = await env.DB.prepare("UPDATE conversations SET classification = ?1, classification_source = 'manual', score = ?2, updated_at = ?3 WHERE id = ?4")
    .bind(value, score, new Date().toISOString(), conversationId).run();
  if (!result.meta.changes) throw new HttpError("Lead não encontrado.", 404);
  await audit(env, user, "lead.classification.update", "conversation", conversationId, { classification: value });
  return json({ ok: true });
}

export async function listContacts(env: AppEnv): Promise<Response> {
  const result = await env.DB.prepare(`SELECT id, phone, name, cpf, rg, rg_issuer AS rgIssuer, birth_date AS birthDate, email,
    address_line AS addressLine, city, state, postal_code AS postalCode, bank, ccb, profile_complete AS profileComplete,
    created_at AS createdAt, (SELECT classification FROM conversations WHERE contact_id = contacts.id) AS classification
    FROM contacts ORDER BY created_at DESC LIMIT 300`).all<Record<string, unknown>>();
  return json({ contacts: result.results.map((row) => ({ ...row, profileComplete: Boolean(row.profileComplete) })) });
}

function validCpf(raw: string): boolean {
  const cpf = raw.replace(/\D/g, "");
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  for (let digit = 9; digit < 11; digit++) {
    let sum = 0;
    for (let index = 0; index < digit; index++) sum += Number(cpf[index]) * (digit + 1 - index);
    if (((sum * 10) % 11) % 10 !== Number(cpf[digit])) return false;
  }
  return true;
}

export function contactInput(input: Record<string, unknown>, editing = false) {
  const name = cleanText(input.name, 120, !editing);
  const phone = normalizePhone(input.phone);
  const cpf = String(input.cpf ?? "").replace(/\D/g, "");
  if ((!editing || cpf) && !validCpf(cpf)) throw new HttpError("CPF inválido.", 422);
  const email = cleanText(input.email, 180);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError("E-mail inválido.", 422);
  const birthDate = cleanText(input.birthDate, 20);
  if (birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(Date.parse(birthDate)))) throw new HttpError("Data de nascimento inválida.", 422);
  const state = cleanText(input.state, 2);
  if (state && !/^[a-zA-Z]{2}$/.test(state)) throw new HttpError("UF inválida.", 422);
  return {
    name, phone, cpf: cpf || null, rg: cleanText(input.rg, 40), rgIssuer: cleanText(input.rgIssuer, 40), birthDate, email,
    addressLine: cleanText(input.addressLine, 240), city: cleanText(input.city, 100), state: state?.toUpperCase() ?? null,
    postalCode: cleanText(input.postalCode, 12), bank: cleanText(input.bank, 120), ccb: cleanText(input.ccb, 80),
    classification: classification(input.classification ?? "warm"), profileComplete: Boolean(name && cpf),
  };
}

export async function createContact(request: Request, env: AppEnv, user: SessionUser): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  const data = contactInput(input);
  const id = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const duplicate = await env.DB.prepare("SELECT id FROM contacts WHERE phone = ?1 OR cpf = ?2 LIMIT 1").bind(data.phone, data.cpf).first();
  if (duplicate) throw new HttpError("WhatsApp ou CPF já cadastrado.", 409);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contacts (id, phone, name, cpf, rg, rg_issuer, birth_date, email, address_line, city, state, postal_code, bank, ccb, profile_complete)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1)`)
      .bind(id, data.phone, data.name, data.cpf, data.rg, data.rgIssuer, data.birthDate, data.email, data.addressLine, data.city, data.state, data.postalCode, data.bank, data.ccb),
    env.DB.prepare("INSERT INTO conversations (id, contact_id, assignee_id, classification, classification_source, score) VALUES (?1, ?2, ?3, ?4, 'manual', ?5)")
      .bind(conversationId, id, user.id, data.classification, data.classification === "hot" ? 75 : data.classification === "warm" ? 50 : 25),
  ]);
  await audit(env, user, "contact.create", "contact", id);
  return json({ id, conversationId }, { status: 201 });
}

export async function updateContact(request: Request, env: AppEnv, user: SessionUser, contactId: string): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  const data = contactInput(input, true);
  const existing = await env.DB.prepare("SELECT id FROM contacts WHERE id = ?1").bind(contactId).first();
  if (!existing) throw new HttpError("Cliente não encontrado.", 404);
  const duplicate = await env.DB.prepare("SELECT id FROM contacts WHERE id <> ?1 AND (phone = ?2 OR cpf = ?3) LIMIT 1")
    .bind(contactId, data.phone, data.cpf).first();
  if (duplicate) throw new HttpError("WhatsApp ou CPF já cadastrado em outro cliente.", 409);
  const updatedAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(`UPDATE contacts SET phone = ?1, name = ?2, cpf = ?3, rg = ?4, rg_issuer = ?5, birth_date = ?6, email = ?7,
      address_line = ?8, city = ?9, state = ?10, postal_code = ?11, bank = ?12, ccb = ?13, profile_complete = ?14, updated_at = ?15,
      avatar_key = CASE WHEN phone <> ?1 THEN NULL ELSE avatar_key END,
      avatar_checked_at = CASE WHEN phone <> ?1 THEN NULL ELSE avatar_checked_at END WHERE id = ?16`)
      .bind(data.phone, data.name, data.cpf, data.rg, data.rgIssuer, data.birthDate, data.email, data.addressLine,
        data.city, data.state, data.postalCode, data.bank, data.ccb, data.profileComplete ? 1 : 0, updatedAt, contactId),
    env.DB.prepare(`UPDATE conversations SET classification = ?1, classification_source = 'manual', score = ?2, updated_at = ?3 WHERE contact_id = ?4`)
      .bind(data.classification, data.classification === "hot" ? 75 : data.classification === "warm" ? 50 : 25, updatedAt, contactId),
  ]);
  await audit(env, user, "contact.update", "contact", contactId, { profileComplete: data.profileComplete });
  await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated" });
  return json({ ok: true, id: contactId, profileComplete: data.profileComplete });
}

export async function addNote(request: Request, env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const input = await readJson<{ body?: unknown }>(request);
  const body = cleanText(input.body, 5_000, true)!;
  const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO notes (id, conversation_id, author_id, body) VALUES (?1, ?2, ?3, ?4)").bind(id, conversationId, user.id, body).run();
  await audit(env, user, "note.create", "conversation", conversationId, { noteId: id });
  return json({ id }, { status: 201 });
}

export async function uploadMedia(request: Request, env: AppEnv, user: SessionUser, url: URL): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (!request.body || length <= 0) throw new HttpError("Arquivo não enviado.", 422);
  if (length > 20 * 1024 * 1024) throw new HttpError("O arquivo deve ter no máximo 20 MB.", 413);
  const original = cleanText(url.searchParams.get("filename"), 240, true)!;
  const safeName = original.replace(/[^a-zA-Z0-9._-]/g, "_");
  const key = `uploads/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
  const mime = request.headers.get("content-type") ?? "application/octet-stream";
  await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: mime }, customMetadata: { uploadedBy: user.id } });
  await audit(env, user, "media.upload", "r2_object", key, { mime, size: length });
  return json({ key, fileName: original, mime, size: length }, { status: 201 });
}

export async function getMedia(env: AppEnv, key: string): Promise<Response> {
  const object = await env.MEDIA.get(key);
  if (!object) throw new HttpError("Arquivo não encontrado.", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "private, max-age=300");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(object.body, { headers });
}
