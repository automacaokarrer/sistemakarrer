import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { handleZApiWebhook } from "./webhook";
import type { AppEnv } from "./types";

vi.mock("./auth", () => ({ safeEqual: async () => true }));

function testEnvironment() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of ["0001_initial.sql", "0006_conversation_waiting.sql", "0014_message_actions.sql"]) {
    sqlite.exec(readFileSync(join(process.cwd(), "migrations", file), "utf8"));
  }
  const events: Array<{ room: string; event: Record<string, unknown> }> = [];
  const prepare = (sql: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => sqlite.prepare(sql).get(...values as []) ?? null,
      all: async () => ({ results: sqlite.prepare(sql).all(...values as []) }),
      run: async () => {
        const result = sqlite.prepare(sql).run(...values as []);
        return { meta: { changes: Number(result.changes) } };
      },
    }),
  });
  const env = {
    ZAPI_WEBHOOK_TOKEN: "local-test-token",
    DB: { prepare, batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((statement) => statement.run())) },
    CHAT_ROOMS: { getByName: (room: string) => ({ broadcast: async (event: Record<string, unknown>) => { events.push({ room, event }); } }) },
  } as unknown as AppEnv;
  const callback = (payload: Record<string, unknown>) => handleZApiWebhook(new Request("https://crm.test/api/webhooks/zapi", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
  }), env, "local-test-token");
  return { sqlite, events, callback };
}

describe("identidade do destinatário Z-API", () => {
  it("preserva LID recebido e vincula o número real posterior à mesma conversa", async () => {
    const { sqlite, callback } = testEnvironment();
    try {
      const lid = "65998849469@lid";
      expect((await callback({ messageId: "in-1", phone: lid, chatLid: lid, text: { message: "Olá" } })).status).toBe(201);
      expect(sqlite.prepare("SELECT phone, chat_lid FROM contacts").get()).toEqual({ phone: lid, chat_lid: lid });

      expect((await callback({ messageId: "in-2", phone: "5592984078295", chatLid: lid, text: { message: "Retorno" } })).status).toBe(201);
      expect(sqlite.prepare("SELECT phone, chat_lid FROM contacts").get()).toEqual({ phone: "5592984078295", chat_lid: lid });
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM contacts").get()).toEqual({ total: 1 });
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM conversations").get()).toEqual({ total: 1 });
    } finally { sqlite.close(); }
  });

  it("recusa associar telefone e LID já vinculados a contatos diferentes", async () => {
    const { sqlite, callback } = testEnvironment();
    try {
      sqlite.prepare("INSERT INTO contacts (id, phone) VALUES (?, ?), (?, ?)")
        .run("first", "5592984078295", "second", "65998849469@lid");
      await expect(callback({ messageId: "in-conflict", phone: "5592984078295", chatLid: "65998849469@lid", text: { message: "Olá" } }))
        .rejects.toMatchObject({ status: 409 });
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM messages").get()).toEqual({ total: 0 });
    } finally { sqlite.close(); }
  });

  it("sinaliza callback de outro destinatário sem esconder o estado de entrega", async () => {
    const { sqlite, callback, events } = testEnvironment();
    try {
      sqlite.prepare("INSERT INTO contacts (id, phone, chat_lid) VALUES (?, ?, ?)")
        .run("contact-1", "5592984078295", "65998849469@lid");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("conversation-1", "contact-1");
      sqlite.prepare(`INSERT INTO messages (id, conversation_id, direction, type, body, status, zapi_message_id, recipient_phone)
        VALUES (?, ?, 'outbound', 'text', 'Teste', 'sent', ?, ?)`).run("message-1", "conversation-1", "provider-1", "5592984078295");

      expect((await callback({ type: "MessageStatusCallback", ids: ["provider-1"], status: "RECEIVED", phone: "5592984078296" })).status).toBe(200);
      expect(sqlite.prepare("SELECT status, recipient_mismatch_at IS NOT NULL AS mismatch FROM messages WHERE id = ?").get("message-1"))
        .toEqual({ status: "delivered", mismatch: 1 });
      expect(sqlite.prepare("SELECT action FROM audit_logs").get()).toEqual({ action: "message.recipient_mismatch" });
      expect(events).toContainEqual(expect.objectContaining({ room: "conversation-1", event: expect.objectContaining({ type: "message.updated", message: expect.objectContaining({ recipientMismatch: true, canEdit: false, canDelete: false }) }) }));
    } finally { sqlite.close(); }
  });

  it("aceita callback pelo LID conhecido e deixa mensagens antigas sem destinatário gravado", async () => {
    const { sqlite, callback } = testEnvironment();
    try {
      sqlite.prepare("INSERT INTO contacts (id, phone, chat_lid) VALUES (?, ?, ?)")
        .run("contact-1", "5592984078295", "65998849469@lid");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("conversation-1", "contact-1");
      sqlite.prepare(`INSERT INTO messages (id, conversation_id, direction, type, status, zapi_message_id, recipient_phone)
        VALUES (?, ?, 'outbound', 'text', 'sent', ?, ?), (?, ?, 'outbound', 'text', 'sent', ?, NULL)`)
        .run("message-1", "conversation-1", "provider-1", "5592984078295", "message-2", "conversation-1", "provider-2");
      await callback({ type: "MessageStatusCallback", ids: ["provider-1", "provider-2"], status: "READ", phone: "65998849469@lid" });
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM messages WHERE recipient_mismatch_at IS NOT NULL").get()).toEqual({ total: 0 });
      expect(sqlite.prepare("SELECT recipient_phone AS recipientPhone FROM messages WHERE id = 'message-2'").get()).toEqual({ recipientPhone: null });
    } finally { sqlite.close(); }
  });
});
