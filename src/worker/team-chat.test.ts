import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { getTeamImage, listTeamMessages, markTeamRead, postTeamMessage, teamChatSummary, validTeamImage } from "./team-chat";
import type { AppEnv, SessionUser } from "./types";

function setup() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of ["0001_initial.sql", "0002_user_access.sql", "0003_email_confirmation.sql", "0015_team_chat.sql"]) {
    sqlite.exec(readFileSync(join(process.cwd(), "migrations", name), "utf8"));
  }
  sqlite.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,email_verified) VALUES (?,?,?,?,?,1)")
    .run("ana", "Ana Karrer", "ana@example.test", "hash", "salt");
  sqlite.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,email_verified) VALUES (?,?,?,?,?,1)")
    .run("joao", "João Lima", "joao@example.test", "hash", "salt");
  sqlite.prepare("INSERT INTO sessions (id,user_id,token_hash,expires_at,last_seen_at) VALUES (?,?,?,?,?)")
    .run("session-ana", "ana", "hash-ana", new Date(Date.now() + 60_000).toISOString(), new Date().toISOString());
  const events: unknown[] = [];
  const media = new Map<string, Uint8Array>();
  const env = {
    DB: {
      prepare: (query: string) => ({
        bind: (...values: unknown[]) => ({
          first: async () => sqlite.prepare(query).get(...values as []) ?? null,
          all: async () => ({ results: sqlite.prepare(query).all(...values as []) }),
          run: async () => { const result = sqlite.prepare(query).run(...values as []); return { meta: { changes: Number(result.changes) } }; },
        }),
      }),
      batch: async (statements: Array<{ run: () => Promise<unknown> }>) => Promise.all(statements.map((statement) => statement.run())),
    },
    CHAT_ROOMS: { getByName: () => ({ broadcast: async (event: unknown) => { events.push(event); } }) },
    MEDIA: { put: async (key: string, value: Uint8Array) => { media.set(key, value); },
      get: async (key: string) => media.has(key) ? { body: new Response(media.get(key)).body } : null,
      delete: async (key: string) => { media.delete(key); } },
  } as unknown as AppEnv;
  const ana = { id: "ana", name: "Ana Karrer" } as SessionUser;
  const joao = { id: "joao", name: "João Lima" } as SessionUser;
  function request(body: string, mentions: string[] = [], all = false) {
    const form = new FormData();
    form.set("body", body);
    form.set("mentionUserIds", JSON.stringify(mentions));
    form.set("mentionAll", String(all));
    return new Request("https://crm.test/api/team-chat/messages", { method: "POST", body: form });
  }
  return { sqlite, env, ana, joao, events, media, request };
}

describe("chat interno", () => {
  it("persiste menções individuais e para todos, conta não lidas e atualiza leitura", async () => {
    const { sqlite, env, ana, joao, events, request } = setup();
    try {
      const first = await postTeamMessage(request("Preciso de ajuda", ["joao"]), env, ana);
      expect(first.status).toBe(201);
      expect((await first.json() as { message: { mentions: Array<{ id: string }> } }).message.mentions).toEqual([{ id: "joao", name: "João Lima" }]);
      const second = await postTeamMessage(request("Reunião agora", [], true), env, ana);
      expect((await second.json() as { message: { mentionAll: boolean } }).message.mentionAll).toBe(true);
      expect(events).toHaveLength(2);

      const summary = await teamChatSummary(env, joao);
      const data = await summary.json() as { unreadCount: number; mentionCount: number; members: Array<{ id: string; online: boolean }> };
      expect(data.unreadCount).toBe(2);
      expect(data.mentionCount).toBe(2);
      expect(data.members.find((member) => member.id === "ana")?.online).toBe(true);
      expect(data.members.find((member) => member.id === "joao")?.online).toBe(false);

      const page = await listTeamMessages(env, new URL("https://crm.test/api/team-chat/messages"));
      const messages = (await page.json() as { messages: Array<{ id: number; body: string }> }).messages;
      expect(messages.map((message) => message.body)).toEqual(["Preciso de ajuda", "Reunião agora"]);
      await markTeamRead(new Request("https://crm.test/api/team-chat/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messageId: messages[1].id }) }), env, joao);
      expect((await (await teamChatSummary(env, joao)).json() as { unreadCount: number }).unreadCount).toBe(0);
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM team_messages").get()).toEqual({ total: 2 });
    } finally { sqlite.close(); }
  });

  it("recusa menção a usuário inexistente e arquivo com assinatura falsa", async () => {
    const { sqlite, env, ana, request } = setup();
    try {
      await expect(postTeamMessage(request("Aviso", ["inexistente"]), env, ana)).rejects.toThrow("não está ativa");
      const form = new FormData();
      form.set("image", new File(["falso"], "print.png", { type: "image/png" }));
      await expect(postTeamMessage(new Request("https://crm.test/api/team-chat/messages", { method: "POST", body: form }), env, ana)).rejects.toThrow("válido");
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM team_messages").get()).toEqual({ total: 0 });
      expect(validTeamImage(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), "image/png")).toBe(true);
    } finally { sqlite.close(); }
  });

  it("guarda print válido em mídia privada e o serve apenas pela rota da mensagem", async () => {
    const { sqlite, env, ana, media } = setup();
    try {
      const form = new FormData();
      form.set("image", new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], "print.png", { type: "image/png" }));
      const response = await postTeamMessage(new Request("https://crm.test/api/team-chat/messages", { method: "POST", body: form }), env, ana);
      const message = (await response.json() as { message: { id: number; imageUrl: string } }).message;
      expect(message.imageUrl).toBe(`/api/team-chat/messages/${message.id}/image`);
      expect([...media.keys()][0]).toMatch(/^team-chat\//);
      const image = await getTeamImage(env, String(message.id));
      expect(image.headers.get("content-type")).toBe("image/png");
      expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      await expect(getTeamImage(env, "9999")).rejects.toThrow("não encontrado");
    } finally { sqlite.close(); }
  });
});
