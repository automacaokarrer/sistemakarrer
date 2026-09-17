import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";
import { assertMessageActionAllowed, deleteMessage, editMessage } from "./message-actions";
import { deleteMessageForEveryone, editTextMessage } from "./zapi";

vi.mock("./zapi", () => ({ editTextMessage: vi.fn(), deleteMessageForEveryone: vi.fn() }));
afterEach(() => vi.resetAllMocks());

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, conversation_id TEXT, direction TEXT, type TEXT, body TEXT,
    media_key TEXT, thumbnail_key TEXT, file_name TEXT, mime TEXT, size INTEGER, duration INTEGER,
    status TEXT, zapi_message_id TEXT, recipient_phone TEXT, created_at TEXT,
    edited_at TEXT, deleted_at TEXT, recipient_mismatch_at TEXT, mutation_token TEXT);
    CREATE TABLE audit_logs (id TEXT, actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, metadata_json TEXT);`);
  const broadcast = vi.fn(async () => undefined);
  const mediaDelete = vi.fn(async () => undefined);
  const env = {
    DB: { prepare: (sql: string) => ({ bind: (...values: SQLInputValue[]) => {
      const statement = db.prepare(sql);
      return {
        first: async () => statement.get(...values) ?? null,
        run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
      };
    } }) },
    CHAT_ROOMS: { getByName: () => ({ broadcast }) },
    MEDIA: { delete: mediaDelete },
  } as never;
  const user = { id: "attendant-1" } as never;
  const insert = (overrides: Record<string, SQLInputValue> = {}) => {
    const row = { id: "message-1", conversation_id: "conversation-1", direction: "outbound", type: "text",
      body: "Texto original", media_key: null, status: "sent", zapi_message_id: "provider-1",
      recipient_phone: "5592999990000", created_at: new Date().toISOString(), ...overrides };
    db.prepare(`INSERT INTO messages (id, conversation_id, direction, type, body, media_key, status,
      zapi_message_id, recipient_phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(row.id, row.conversation_id, row.direction, row.type, row.body, row.media_key, row.status,
        row.zapi_message_id, row.recipient_phone, row.created_at);
  };
  return { db, env, user, insert, broadcast, mediaDelete };
}

describe("ações de mensagens no WhatsApp", () => {
  it("edita somente o texto da mensagem original, audita e publica a alteração", async () => {
    const { db, env, user, insert, broadcast } = fixture();
    try {
      insert();
      const request = new Request("https://crm.test", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Texto corrigido", expectedEditedAt: null }) });
      const response = await editMessage(request, env, user, "conversation-1", "message-1");
      expect(response.status).toBe(200);
      expect(editTextMessage).toHaveBeenCalledWith(env, "5592999990000", "provider-1", "Texto corrigido");
      expect(db.prepare("SELECT body, edited_at, zapi_message_id, mutation_token FROM messages").get())
        .toMatchObject({ body: "Texto corrigido", zapi_message_id: "provider-1", mutation_token: null });
      expect(db.prepare("SELECT action FROM audit_logs").get()).toMatchObject({ action: "message.edit" });
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "message.updated", message: expect.objectContaining({ body: "Texto corrigido", canEdit: true }) }));
    } finally { db.close(); }
  });

  it("apaga para todos e oculta texto e mídia do histórico depois da confirmação", async () => {
    const { db, env, user, insert, broadcast, mediaDelete } = fixture();
    try {
      insert({ type: "image", media_key: "uploads/test.png" });
      const response = await deleteMessage(env, user, "conversation-1", "message-1");
      expect(response.status).toBe(200);
      expect(deleteMessageForEveryone).toHaveBeenCalledWith(env, "5592999990000", "provider-1");
      expect(db.prepare("SELECT body, media_key, deleted_at, mutation_token FROM messages").get())
        .toMatchObject({ body: null, media_key: null, mutation_token: null });
      expect(mediaDelete).toHaveBeenCalledWith("uploads/test.png");
      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: "message.updated", message: expect.objectContaining({ deletedAt: expect.any(String), canDelete: false }) }));
    } finally { db.close(); }
  });

  it("não altera o histórico quando a Z-API recusa a edição", async () => {
    const { db, env, user, insert } = fixture();
    try {
      insert();
      vi.mocked(editTextMessage).mockRejectedValueOnce(new HttpError("Recusado", 502));
      const request = new Request("https://crm.test", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Novo texto", expectedEditedAt: null }) });
      await expect(editMessage(request, env, user, "conversation-1", "message-1")).rejects.toThrow("Recusado");
      expect(db.prepare("SELECT body, edited_at, mutation_token FROM messages").get())
        .toMatchObject({ body: "Texto original", edited_at: null, mutation_token: null });
    } finally { db.close(); }
  });

  it("recusa edição baseada numa versão antiga sem chamar a Z-API", async () => {
    const { db, env, user, insert } = fixture();
    try {
      insert();
      db.prepare("UPDATE messages SET edited_at = ? WHERE id = ?").run(new Date().toISOString(), "message-1");
      const request = new Request("https://crm.test", { method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: "Texto antigo", expectedEditedAt: null }) });
      await expect(editMessage(request, env, user, "conversation-1", "message-1")).rejects.toThrow("outra sessão");
      expect(editTextMessage).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it("bloqueia destinatário não comprovado, divergente e prazo expirado", () => {
    const base = { id: "message-1", direction: "outbound", type: "text", body: "Texto", mediaKey: null,
      status: "sent", zapiMessageId: "provider-1", recipientPhone: "5592999990000",
      createdAt: new Date().toISOString(), editedAt: null, deletedAt: null, recipientMismatchAt: null, mutationToken: null };
    expect(() => assertMessageActionAllowed({ ...base, recipientPhone: null }, "delete")).toThrow(HttpError);
    expect(() => assertMessageActionAllowed({ ...base, recipientMismatchAt: new Date().toISOString() }, "delete")).toThrow(HttpError);
    expect(() => assertMessageActionAllowed({ ...base, recipientPhone: "123456789@lid" }, "delete")).toThrow(HttpError);
    expect(() => assertMessageActionAllowed({ ...base, createdAt: new Date(Date.now() - 16 * 60_000).toISOString() }, "edit")).toThrow("15 minutos");
    expect(() => assertMessageActionAllowed({ ...base, createdAt: new Date(Date.now() - 49 * 60 * 60_000).toISOString() }, "delete")).toThrow("dois dias");
  });
});
