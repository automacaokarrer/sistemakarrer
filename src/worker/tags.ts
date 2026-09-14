import { HttpError, json, readJson } from "./http";
import { audit } from "./repository";
import { INBOX_ROOM } from "./realtime";
import type { AppEnv, SessionUser } from "./types";

interface TagInput { tagId?: unknown; active?: unknown }

function tagId(value: unknown): string {
  const result = typeof value === "string" ? value.trim() : "";
  if (!result || result.length > 100 || /[\u0000-\u001f]/.test(result)) throw new HttpError("Etiqueta inválida.", 422);
  return result;
}

export async function listConversationTags(env: AppEnv, conversationId: string): Promise<Response> {
  const conversation = await env.DB.prepare("SELECT id FROM conversations WHERE id = ?1").bind(conversationId).first();
  if (!conversation) throw new HttpError("Conversa não encontrada.", 404);
  const [tags, history] = await Promise.all([
    env.DB.prepare(`SELECT t.id, t.name, t.color, CASE WHEN ct.tag_id IS NULL THEN 0 ELSE 1 END AS selected,
      ct.assigned_at AS assignedAt, u.name AS assignedByName
      FROM lead_tags t LEFT JOIN conversation_tags ct ON ct.tag_id = t.id AND ct.conversation_id = ?1
      LEFT JOIN users u ON u.id = ct.assigned_by WHERE t.active = 1 ORDER BY t.sort_order, t.name`)
      .bind(conversationId).all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT h.id, h.action, h.created_at AS createdAt, t.id AS tagId, t.name, t.color,
      COALESCE(u.name, 'Sistema') AS actorName FROM conversation_tag_history h
      JOIN lead_tags t ON t.id = h.tag_id LEFT JOIN users u ON u.id = h.actor_id
      WHERE h.conversation_id = ?1 ORDER BY h.created_at DESC, h.id DESC LIMIT 100`)
      .bind(conversationId).all<Record<string, unknown>>(),
  ]);
  return json({
    tags: tags.results.map((tag) => ({ ...tag, selected: Boolean(tag.selected) })),
    history: history.results,
  });
}

export async function updateConversationTag(request: Request, env: AppEnv, user: SessionUser, conversationId: string): Promise<Response> {
  const input = await readJson<TagInput>(request);
  const id = tagId(input.tagId);
  if (typeof input.active !== "boolean") throw new HttpError("Informe se a etiqueta deve permanecer ativa.", 422);
  const [conversation, tag] = await Promise.all([
    env.DB.prepare("SELECT id FROM conversations WHERE id = ?1").bind(conversationId).first(),
    env.DB.prepare("SELECT id, name FROM lead_tags WHERE id = ?1 AND active = 1").bind(id).first<{ id: string; name: string }>(),
  ]);
  if (!conversation) throw new HttpError("Conversa não encontrada.", 404);
  if (!tag) throw new HttpError("Etiqueta não encontrada.", 404);
  const now = new Date().toISOString();
  const result = input.active
    ? await env.DB.prepare(`INSERT INTO conversation_tags (conversation_id, tag_id, assigned_by, assigned_at)
      VALUES (?1, ?2, ?3, ?4) ON CONFLICT(conversation_id, tag_id) DO NOTHING`).bind(conversationId, id, user.id, now).run()
    : await env.DB.prepare("DELETE FROM conversation_tags WHERE conversation_id = ?1 AND tag_id = ?2").bind(conversationId, id).run();
  if (result.meta.changes) {
    await env.DB.prepare(`INSERT INTO conversation_tag_history (id, conversation_id, tag_id, action, actor_id, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`).bind(crypto.randomUUID(), conversationId, id, input.active ? "added" : "removed", user.id, now).run();
    await audit(env, user, input.active ? "conversation.tag.add" : "conversation.tag.remove", "conversation", conversationId, { tagId: id });
    await Promise.all([
      env.CHAT_ROOMS.getByName(conversationId).broadcast({ type: "conversation.tags", conversationId }),
      env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId }),
    ]);
  }
  return listConversationTags(env, conversationId);
}
