import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { leadSummary, listConversations } from "./repository";

describe("tempo da primeira resposta", () => {
  it("mede apenas o primeiro envio válido após a entrada e atribui ao autor da resposta", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT);
        CREATE TABLE contacts (id TEXT PRIMARY KEY, name TEXT, phone TEXT, bank TEXT);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, contact_id TEXT, assignee_id TEXT, created_at TEXT,
          last_message_at TEXT, unread_count INTEGER, online INTEGER, last_seen_at TEXT, waiting_since TEXT,
          service_status TEXT, stage TEXT, classification TEXT, score INTEGER, luna_autonomous_enabled INTEGER NOT NULL DEFAULT 0);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT, sender_user_id TEXT, direction TEXT,
          type TEXT, body TEXT, status TEXT, created_at TEXT, deleted_at TEXT);
      `);
      const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
      const insertConversation = db.prepare(`INSERT INTO conversations
        (id, contact_id, assignee_id, created_at, last_message_at, unread_count, online, last_seen_at, waiting_since, service_status, stage, classification, score)
        VALUES (?, ?, ?, ?, NULL, 0, 0, NULL, NULL, 'in_progress', 'Primeiro contato', 'warm', 50)`);
      const insertMessage = db.prepare("INSERT INTO messages (id, conversation_id, sender_user_id, direction, type, body, status, created_at) VALUES (?, ?, ?, ?, 'text', NULL, ?, ?)");
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("user-1", "Ana");
      db.prepare("INSERT INTO users (id, name) VALUES (?, ?)").run("user-2", "João");
      for (const id of ["one", "two", "three"]) db.prepare("INSERT INTO contacts (id, name, phone, bank) VALUES (?, ?, ?, NULL)").run(id, id, `559299999000${id.length}`);
      insertConversation.run("one", "one", "user-1", at(120));
      insertConversation.run("two", "two", "user-1", at(180));
      insertConversation.run("three", "three", null, at(100));
      insertMessage.run("one-in", "one", null, "inbound", "received", at(120));
      insertMessage.run("one-failed", "one", "user-1", "outbound", "failed", at(118));
      insertMessage.run("one-reply", "one", "user-1", "outbound", "sent", at(115));
      insertMessage.run("two-in", "two", null, "inbound", "received", at(180));
      insertMessage.run("two-reply", "two", "user-2", "outbound", "sent", at(165));
      insertMessage.run("three-before", "three", "user-1", "outbound", "sent", at(100));
      insertMessage.run("three-in", "three", null, "inbound", "received", at(90));

      const env = { DB: { prepare: (sql: string) => {
        const statement = db.prepare(sql);
        return { all: async () => ({ results: statement.all() }), first: async () => statement.get() ?? null };
      } } } as never;
      const conversations = await (await listConversations(env, new URL("https://crm.test/api/conversations"))).json<{ conversations: Array<{
        id: string; assigneeId: string | null; firstResponderId: string | null; firstResponseMinutes: number | null;
      }> }>();
      const byId = new Map(conversations.conversations.map((item) => [item.id, item]));
      expect(byId.get("one")).toMatchObject({ firstResponderId: "user-1", firstResponseMinutes: 5 });
      expect(byId.get("two")).toMatchObject({ assigneeId: "user-1", firstResponderId: "user-2", firstResponseMinutes: 15 });
      expect(byId.get("three")).toMatchObject({ firstResponderId: null, firstResponseMinutes: null });
      const summary = await (await leadSummary(env)).json<{ averageFirstResponseMinutes: number | null }>();
      expect(summary.averageFirstResponseMinutes).toBe(10);
    } finally {
      db.close();
    }
  });
});
