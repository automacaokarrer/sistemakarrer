import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listConversationTags, updateConversationTag } from "./tags";
import type { AppEnv, SessionUser } from "./types";

describe("etiquetas da conversa", () => {
  it("registra inclusão e remoção, sem duplicar eventos idempotentes", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", "0001_initial.sql"), "utf8"));
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", "0013_conversation_tags.sql"), "utf8"));
      sqlite.prepare("INSERT INTO users (id, name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)")
        .run("user-1", "Ana", "ana@example.test", "hash", "salt");
      sqlite.prepare("INSERT INTO contacts (id, phone) VALUES (?, ?)").run("contact-1", "5592999999999");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("conversation-1", "contact-1");
      let broadcasts = 0;
      const env = {
        DB: { prepare: (query: string) => ({
          bind: (...values: unknown[]) => ({
            first: async () => sqlite.prepare(query).get(...values as []) ?? null,
            all: async () => ({ results: sqlite.prepare(query).all(...values as []) }),
            run: async () => {
              const result = sqlite.prepare(query).run(...values as []);
              return { meta: { changes: Number(result.changes) } };
            },
          }),
        }) },
        CHAT_ROOMS: { getByName: () => ({ broadcast: async () => { broadcasts += 1; } }) },
      } as unknown as AppEnv;
      const user = { id: "user-1" } as SessionUser;
      const patch = (active: boolean) => new Request("https://crm.test/api/conversations/conversation-1/tags", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tagId: "tag-waiting-contract", active }),
      });

      await updateConversationTag(patch(true), env, user, "conversation-1");
      await updateConversationTag(patch(true), env, user, "conversation-1");
      let data = await (await listConversationTags(env, "conversation-1")).json() as { tags: Array<{ id: string; selected: boolean }>; history: Array<{ action: string; actorName: string }> };
      expect(data.tags.find((tag) => tag.id === "tag-waiting-contract")?.selected).toBe(true);
      expect(data.history).toEqual([{ action: "added", actorName: "Ana", createdAt: expect.any(String), id: expect.any(String), tagId: "tag-waiting-contract", name: "Aguardando contrato", color: "#9b6a35" }]);

      await updateConversationTag(patch(false), env, user, "conversation-1");
      data = await (await listConversationTags(env, "conversation-1")).json() as typeof data;
      expect(data.tags.find((tag) => tag.id === "tag-waiting-contract")?.selected).toBe(false);
      expect(data.history.map((entry) => entry.action)).toEqual(["removed", "added"]);
      expect(broadcasts).toBe(4);
      expect(sqlite.prepare("SELECT COUNT(*) AS total FROM audit_logs WHERE entity_id = ?").get("conversation-1"))
        .toEqual({ total: 2 });
    } finally { sqlite.close(); }
  });
});
