import { HttpError, cleanText, json, normalizePhone, readJson } from "./http";
import type { AppEnv, SessionUser } from "./types";
import { sendText } from "./zapi";

type Classification = "hot" | "warm" | "cold";

interface ConversationRow {
  id: string;
  contactId: string;
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

const conversationSelect = `SELECT c.id, c.contact_id AS contactId, COALESCE(ct.name, ct.phone) AS name,
  ct.phone, ct.bank, c.stage, c.classification, c.score, c.last_message_at AS lastMessageAt,
  c.unread_count AS unreadCount, c.online, c.last_seen_at AS lastSeenAt, u.name AS assigneeName,
  (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessage,
  (SELECT m.type FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1) AS lastMessageType
  FROM conversations c JOIN contacts ct ON ct.id = c.contact_id LEFT JOIN users u ON u.id = c.assignee_id`;

export const messageSelect = `SELECT id, conversation_id AS conversationId, direction, type, body,
  media_key AS mediaKey, file_name AS fileName, duration, status, created_at AS createdAt FROM messages`;

export function classification(value: unknown): Classification {
  if (value === "hot" || value === "warm" || value === "cold") return value;
  throw new HttpError("Classificação inválida.", 422);
}

export async function audit(env: AppEnv, user: SessionUser | null, action: string, entityType: string, entityId: string | null, metadata?: unknown): Promise<void> {
  await env.DB.prepare("INSERT INTO audit_logs (id, actor_id, action, entity_type, entity_id, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(crypto.randomUUID(), user?.id ?? null, action, entityType, entityId, metadata ? JSON.stringify(metadata) : null).run();
}

export async function listConversations(env: AppEnv, url: URL): Promise<Response> {
  const search = (url.searchParams.get("search") ?? "").trim();
  const kind = url.searchParams.get("classification");
  const bindings: Array<string | number> = [];
  let query = `${conversationSelect} WHERE 1 = 1`;
  if (search) {
    query += " AND (ct.name LIKE ? OR ct.phone LIKE ?)";
    bindings.push(`%${search}%`, `%${search}%`);
  }
  if (kind) {
    query += " AND c.classification = ?";
    bindings.push(classification(kind));
  }
  if (url.searchParams.get("unread") === "true") query += " AND c.unread_count > 0";
  query += " ORDER BY COALESCE(c.last_message_at, c.created_at) DESC LIMIT 200";
  const prepared = env.DB.prepare(query);
  const result = await (bindings.length ? prepared.bind(...bindings) : prepared).all<ConversationRow>();
  return json({ conversations: result.results.map((row) => ({ ...row, name: row.name ?? row.phone, online: Boolean(row.online) })) });
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

export async function sendMessage(request: Request, env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const input = await readJson<{ body?: unknown }>(request);
  const body = cleanText(input.body, 10_000, true)!;
  const conversation = await env.DB.prepare("SELECT ct.phone FROM conversations c JOIN contacts ct ON ct.id = c.contact_id WHERE c.id = ?1")
    .bind(conversationId).first<{ phone: string }>();
  if (!conversation) throw new HttpError("Conversa não encontrada.", 404);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO messages (id, conversation_id, sender_user_id, direction, type, body, status, created_at) VALUES (?1, ?2, ?3, 'outbound', 'text', ?4, 'sending', ?5)").bind(id, conversationId, user.id, body, createdAt),
    env.DB.prepare("UPDATE conversations SET last_message_at = ?1, updated_at = ?1 WHERE id = ?2").bind(createdAt, conversationId),
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
  await audit(env, user, "message.send", "conversation", conversationId, { messageId: id, status });
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
  return json({ total: Number(counts?.total ?? 0), hot: Number(counts?.hot ?? 0), warm: Number(counts?.warm ?? 0), cold: Number(counts?.cold ?? 0), averageFirstResponseMinutes: 0, daily: daily.results });
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
    created_at AS createdAt FROM contacts ORDER BY created_at DESC LIMIT 300`).all<Record<string, unknown>>();
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

export async function createContact(request: Request, env: AppEnv, user: SessionUser): Promise<Response> {
  const input = await readJson<Record<string, unknown>>(request);
  const name = cleanText(input.name, 120, true)!;
  const phone = normalizePhone(input.phone);
  const cpf = String(input.cpf ?? "").replace(/\D/g, "");
  if (!validCpf(cpf)) throw new HttpError("CPF inválido.", 422);
  const id = crypto.randomUUID();
  const conversationId = crypto.randomUUID();
  const kind = classification(input.classification ?? "warm");
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO contacts (id, phone, name, cpf, rg, birth_date, email, address_line, city, state, postal_code, bank, ccb, profile_complete)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1)`)
      .bind(id, phone, name, cpf, cleanText(input.rg, 40), cleanText(input.birthDate, 20), cleanText(input.email, 180), cleanText(input.addressLine, 240), cleanText(input.city, 100), cleanText(input.state, 2), cleanText(input.postalCode, 12), cleanText(input.bank, 120), cleanText(input.ccb, 80)),
    env.DB.prepare("INSERT INTO conversations (id, contact_id, assignee_id, classification, classification_source, score) VALUES (?1, ?2, ?3, ?4, 'manual', ?5)")
      .bind(conversationId, id, user.id, kind, kind === "hot" ? 75 : kind === "warm" ? 50 : 25),
  ]);
  await audit(env, user, "contact.create", "contact", id);
  return json({ id, conversationId }, { status: 201 });
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
