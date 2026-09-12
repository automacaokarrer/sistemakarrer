import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { listContacts, updateContact } from "./repository";
import type { AppEnv, SessionUser } from "./types";

describe("persistência da edição do cliente", () => {
  it("atualiza contato incompleto e classificação nas tabelas reais do esquema", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      for (const migration of ["0001_initial.sql", "0005_contact_avatar_cache.sql", "0006_conversation_waiting.sql"]) {
        sqlite.exec(readFileSync(join(process.cwd(), "migrations", migration), "utf8"));
      }
      sqlite.prepare("INSERT INTO users (id, name, email, password_hash, password_salt) VALUES (?, ?, ?, ?, ?)")
        .run("user-1", "Usuário de teste", "test@example.test", "test-hash", "test-salt");
      sqlite.prepare("INSERT INTO contacts (id, phone) VALUES (?, ?)").run("contact-1", "5592999999999");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("conversation-1", "contact-1");

      const prepare = (query: string) => ({
        all: async () => ({ results: sqlite.prepare(query).all() }),
        bind: (...values: unknown[]) => ({
          query, values,
          first: async () => sqlite.prepare(query).get(...values as []),
          all: async () => ({ results: sqlite.prepare(query).all(...values as []) }),
          run: async () => sqlite.prepare(query).run(...values as []),
        }),
      });
      let broadcasts = 0;
      const env = {
        DB: {
          prepare,
          batch: async (statements: Array<{ query: string; values: unknown[] }>) => {
            sqlite.exec("BEGIN");
            try {
              for (const statement of statements) sqlite.prepare(statement.query).run(...statement.values as []);
              sqlite.exec("COMMIT");
            } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
          },
        },
        CHAT_ROOMS: { getByName: () => ({ broadcast: async () => { broadcasts += 1; } }) },
      } as unknown as AppEnv;
      const user = { id: "user-1" } as SessionUser;
      const request = new Request("https://example.test/api/contacts/contact-1", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: "5592999999999", name: "Maria", cpf: "111.444.777-35", bank: "Banco Karrer", classification: "cold", rgIssuer: "SSP-AM" }),
      });

      const response = await updateContact(request, env, user, "contact-1");
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ id: "contact-1", profileComplete: true });
      const saved = await (await listContacts(env)).json() as { contacts: Array<Record<string, unknown>> };
      expect(saved.contacts[0]).toMatchObject({ id: "contact-1", name: "Maria", cpf: "11144477735", bank: "Banco Karrer", rgIssuer: "SSP-AM", classification: "cold", profileComplete: true });
      expect(sqlite.prepare("SELECT classification_source, score FROM conversations WHERE contact_id = ?").get("contact-1"))
        .toMatchObject({ classification_source: "manual", score: 25 });
      expect(sqlite.prepare("SELECT action FROM audit_logs WHERE entity_id = ?").get("contact-1"))
        .toMatchObject({ action: "contact.update" });
      expect(broadcasts).toBe(1);
    } finally { sqlite.close(); }
  });
});
