import { HttpError, cleanText, json, readJson } from "./http";
import { TEAM_ROOM } from "./realtime";
import type { AppEnv, SessionUser } from "./types";

interface TeamMessageRow {
  id: number;
  authorId: string | null;
  authorName: string;
  body: string | null;
  mediaKey: string | null;
  mentionAll: number;
  mentionsJson: string;
  createdAt: string;
}

const messageSelect = `SELECT m.id, m.author_id AS authorId, m.author_name AS authorName, m.body,
  m.media_key AS mediaKey, m.mention_all AS mentionAll, m.created_at AS createdAt,
  COALESCE((SELECT json_group_array(json_object('id', u.id, 'name', u.name))
    FROM team_message_mentions mm JOIN users u ON u.id = mm.user_id WHERE mm.message_id = m.id), '[]') AS mentionsJson
  FROM team_messages m`;

function presentMessage(row: TeamMessageRow) {
  return {
    id: row.id,
    authorId: row.authorId,
    authorName: row.authorName,
    body: row.body,
    imageUrl: row.mediaKey ? `/api/team-chat/messages/${row.id}/image` : null,
    mentionAll: Boolean(row.mentionAll),
    mentions: JSON.parse(row.mentionsJson) as Array<{ id: string; name: string }>,
    createdAt: row.createdAt,
  };
}

export async function teamChatSummary(env: AppEnv, user: SessionUser): Promise<Response> {
  const onlineSince = new Date(Date.now() - 6 * 60_000).toISOString();
  const now = new Date().toISOString();
  const members = await env.DB.prepare(`SELECT u.id, u.name,
    EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = u.id AND s.last_seen_at > ?1 AND s.expires_at > ?2) AS online
    FROM users u WHERE u.active = 1 AND u.email_verified = 1 ORDER BY u.name COLLATE NOCASE`)
    .bind(onlineSince, now).all<{ id: string; name: string; online: number }>();
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS unreadCount,
    COALESCE(SUM(CASE WHEN m.mention_all = 1 OR EXISTS
      (SELECT 1 FROM team_message_mentions mm WHERE mm.message_id = m.id AND mm.user_id = ?1)
      THEN 1 ELSE 0 END), 0) AS mentionCount
    FROM team_messages m WHERE m.id > COALESCE((SELECT last_read_id FROM team_chat_reads WHERE user_id = ?1), 0)
      AND m.author_id IS NOT ?1`).bind(user.id).first<{ unreadCount: number; mentionCount: number }>();
  return json({ members: members.results.map((member) => ({ ...member, online: Boolean(member.online) })),
    unreadCount: counts?.unreadCount ?? 0, mentionCount: counts?.mentionCount ?? 0 });
}

export async function listTeamMessages(env: AppEnv, url: URL): Promise<Response> {
  const beforeValue = url.searchParams.get("before");
  const before = beforeValue === null ? null : Number(beforeValue);
  if (beforeValue !== null && (!Number.isSafeInteger(before) || before! <= 0)) throw new HttpError("Cursor inválido.", 422);
  const result = await env.DB.prepare(`${messageSelect} ${before === null ? "" : "WHERE m.id < ?1"} ORDER BY m.id DESC LIMIT 51`)
    .bind(...(before === null ? [] : [before])).all<TeamMessageRow>();
  const hasMore = result.results.length > 50;
  const rows = result.results.slice(0, 50).reverse();
  return json({ messages: rows.map(presentMessage), hasMore, nextCursor: hasMore ? rows[0]?.id ?? null : null });
}

export function validTeamImage(bytes: Uint8Array, mime: string): boolean {
  if (mime === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
  if (mime === "image/jpeg") return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === "image/webp") return bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  return false;
}

export async function postTeamMessage(request: Request, env: AppEnv, user: SessionUser): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? 0) > 9 * 1024 * 1024) throw new HttpError("Print muito grande.", 413);
  const form = await request.formData();
  const body = cleanText(form.get("body"), 4_000);
  const image = form.get("image");
  if (image !== null && (!(image instanceof File) || !image.size)) throw new HttpError("Print inválido.", 422);
  if (!body && !image) throw new HttpError("Escreva uma mensagem ou anexe um print.", 422);
  if (image && image.size > 8 * 1024 * 1024) throw new HttpError("O print deve ter no máximo 8 MB.", 413);
  const rawIds = form.get("mentionUserIds");
  let parsedIds: unknown;
  try { parsedIds = JSON.parse(typeof rawIds === "string" ? rawIds : "[]"); } catch { throw new HttpError("Menções inválidas.", 422); }
  if (!Array.isArray(parsedIds) || parsedIds.length > 30 || parsedIds.some((id) => typeof id !== "string" || id.length > 100)) {
    throw new HttpError("Menções inválidas.", 422);
  }
  const mentionIds = [...new Set(parsedIds as string[])];
  const mentionAll = form.get("mentionAll") === "true";
  if (mentionAll && mentionIds.length) throw new HttpError("Escolha pessoas ou todos.", 422);
  if (mentionIds.length) {
    const members = await env.DB.prepare(`SELECT id FROM users WHERE active = 1 AND email_verified = 1 AND id IN (${mentionIds.map(() => "?").join(",")})`)
      .bind(...mentionIds).all<{ id: string }>();
    if (members.results.length !== mentionIds.length) throw new HttpError("Uma pessoa marcada não está ativa no sistema.", 422);
  }
  const mediaKey = image ? `team-chat/${crypto.randomUUID()}` : null;
  if (image) {
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (!validTeamImage(bytes, image.type)) throw new HttpError("Use um print JPG, PNG ou WebP válido.", 422);
    await env.MEDIA.put(mediaKey!, bytes, { httpMetadata: { contentType: image.type } });
  }
  let id: number;
  try {
    const inserted = await env.DB.prepare(`INSERT INTO team_messages (author_id, author_name, body, media_key, media_mime, mention_all)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`)
      .bind(user.id, user.name, body, mediaKey, image?.type ?? null, mentionAll ? 1 : 0).first<{ id: number }>();
    if (!inserted) throw new Error("Mensagem interna não gravada.");
    id = inserted.id;
    if (mentionIds.length) await env.DB.batch(mentionIds.map((mentionedId) =>
      env.DB.prepare("INSERT INTO team_message_mentions (message_id, user_id) VALUES (?1, ?2)").bind(id, mentionedId)));
  } catch (reason) {
    if (mediaKey) await env.MEDIA.delete(mediaKey).catch(() => undefined);
    throw reason;
  }
  const row = await env.DB.prepare(`${messageSelect} WHERE m.id = ?1`).bind(id).first<TeamMessageRow>();
  if (!row) throw new HttpError("Mensagem interna não encontrada.", 500);
  const message = presentMessage(row);
  await env.CHAT_ROOMS.getByName(TEAM_ROOM).broadcast({ type: "team.message", message });
  return json({ message }, { status: 201 });
}

export async function markTeamRead(request: Request, env: AppEnv, user: SessionUser): Promise<Response> {
  const input = await readJson<{ messageId?: unknown }>(request);
  const requested = Number(input.messageId);
  if (!Number.isSafeInteger(requested) || requested < 0) throw new HttpError("Mensagem inválida.", 422);
  const latest = await env.DB.prepare("SELECT COALESCE(MAX(id), 0) AS id FROM team_messages WHERE id <= ?1")
    .bind(requested).first<{ id: number }>();
  const id = latest?.id ?? 0;
  await env.DB.prepare(`INSERT INTO team_chat_reads (user_id, last_read_id) VALUES (?1, ?2)
    ON CONFLICT(user_id) DO UPDATE SET last_read_id = MAX(last_read_id, excluded.last_read_id)`)
    .bind(user.id, id).run();
  return json({ lastReadId: id });
}

export async function getTeamImage(env: AppEnv, messageId: string): Promise<Response> {
  const id = Number(messageId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new HttpError("Print não encontrado.", 404);
  const row = await env.DB.prepare("SELECT media_key AS mediaKey, media_mime AS mediaMime FROM team_messages WHERE id = ?1")
    .bind(id).first<{ mediaKey: string | null; mediaMime: string | null }>();
  if (!row?.mediaKey) throw new HttpError("Print não encontrado.", 404);
  const object = await env.MEDIA.get(row.mediaKey);
  if (!object) throw new HttpError("Print não encontrado.", 404);
  return new Response(object.body, { headers: { "Content-Type": row.mediaMime ?? "application/octet-stream",
    "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'" } });
}
