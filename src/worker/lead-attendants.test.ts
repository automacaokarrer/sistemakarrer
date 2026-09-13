import { DatabaseSync } from "node:sqlite";
import { expect, it } from "vitest";
import { listLeadAttendants } from "./settings";

it("mostra presença válida e apenas atendimentos em andamento por usuário", async () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, avatar_key TEXT);
      CREATE TABLE sessions (user_id TEXT, last_seen_at TEXT, expires_at TEXT);
      CREATE TABLE conversations (assignee_id TEXT, service_status TEXT);`);
    const now = Date.now();
    const at = (minutes: number) => new Date(now + minutes * 60_000).toISOString();
    const user = db.prepare("INSERT INTO users (id, name, avatar_key) VALUES (?, ?, ?)");
    user.run("ana", "Ana", "avatar/ana");
    user.run("joao", "João", null);
    user.run("lia", "Lia", null);
    const session = db.prepare("INSERT INTO sessions (user_id, last_seen_at, expires_at) VALUES (?, ?, ?)");
    session.run("ana", at(-1), at(60));
    session.run("joao", at(-10), at(60));
    const conversation = db.prepare("INSERT INTO conversations (assignee_id, service_status) VALUES (?, ?)");
    conversation.run("ana", "in_progress");
    conversation.run("ana", "waiting_customer");
    conversation.run("joao", "in_progress");
    conversation.run("joao", "resolved");
    conversation.run("lia", "new");

    const env = { DB: { prepare: (sql: string) => {
      const statement = db.prepare(sql);
      return { bind: (...values: unknown[]) => ({ all: async () => ({ results: statement.all(...values as []) }) }) };
    } } } as never;
    const result = await (await listLeadAttendants(env)).json<{ attendants: Array<{
      id: string; avatarUrl: string | null; online: boolean; activeCount: number; waitingCount: number;
    }> }>();
    expect(result.attendants).toMatchObject([
      { id: "ana", avatarUrl: "/api/settings/users/ana/avatar", online: true, activeCount: 1, waitingCount: 1 },
      { id: "joao", avatarUrl: null, online: false, activeCount: 1, waitingCount: 0 },
      { id: "lia", avatarUrl: null, online: false, activeCount: 0, waitingCount: 0 },
    ]);
  } finally {
    db.close();
  }
});
