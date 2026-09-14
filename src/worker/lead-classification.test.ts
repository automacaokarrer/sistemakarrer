import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { calculateAutomaticClassification, refreshAutomaticLeadClassification } from "./lead-classification";
import type { AppEnv } from "./types";

const inbound = (body: string, type = "text") => ({ direction: "inbound", type, body, status: "received" });

describe("classificação automática de leads", () => {
  it("mantém uma saudação sem interesse como lead frio", () => {
    expect(calculateAutomaticClassification([inbound("Oi, bom dia")])).toMatchObject({ classification: "cold" });
  });

  it("classifica como morno quando o cliente relata o caso e pede informações", () => {
    expect(calculateAutomaticClassification([
      inbound("Preciso de ajuda com um desconto indevido do banco. Gostaria de saber como funciona?"),
    ])).toMatchObject({ classification: "warm" });
  });

  it("classifica como quente quando há intenção explícita de contratar", () => {
    expect(calculateAutomaticClassification([
      inbound("Entendi"), inbound("Quero contratar um advogado e dar entrada no processo"),
    ])).toMatchObject({ classification: "hot" });
  });

  it("volta para frio quando a última intenção é encerrar o contato", () => {
    expect(calculateAutomaticClassification([
      inbound("Quero contratar e iniciar o processo"), inbound("Não tenho interesse, pode encerrar atendimento"),
    ])).toEqual({ classification: "cold", score: 5 });
  });

  it("considera o envio de documento como sinal de interesse", () => {
    expect(calculateAutomaticClassification([inbound("Segue", "document")])).toMatchObject({ classification: "warm" });
  });

  it("atualiza o banco e nunca sobrescreve uma classificação manual", async () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", "0001_initial.sql"), "utf8"));
      sqlite.prepare("INSERT INTO contacts (id, phone) VALUES (?, ?), (?, ?)")
        .run("contact-auto", "5592000000001", "contact-manual", "5592000000002");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("auto", "contact-auto");
      sqlite.prepare("INSERT INTO conversations (id, contact_id, classification, classification_source, score) VALUES (?, ?, 'cold', 'manual', 25)")
        .run("manual", "contact-manual");
      const insert = sqlite.prepare("INSERT INTO messages (id, conversation_id, direction, type, body, status) VALUES (?, ?, 'inbound', 'text', ?, 'received')");
      insert.run("message-auto", "auto", "Quero contratar e dar entrada no processo");
      insert.run("message-manual", "manual", "Quero contratar e dar entrada no processo");
      let broadcasts = 0;
      const prepare = (query: string) => ({
        bind: (...values: unknown[]) => ({
          all: async () => ({ results: sqlite.prepare(query).all(...values as []) }),
          run: async () => {
            const result = sqlite.prepare(query).run(...values as []);
            return { meta: { changes: Number(result.changes) } };
          },
        }),
      });
      const env = { DB: { prepare }, CHAT_ROOMS: { getByName: () => ({ broadcast: async () => { broadcasts += 1; } }) } } as unknown as AppEnv;

      await refreshAutomaticLeadClassification(env, "auto");
      await refreshAutomaticLeadClassification(env, "manual");

      expect(sqlite.prepare("SELECT classification, classification_source, score FROM conversations WHERE id = ?").get("auto"))
        .toMatchObject({ classification: "hot", classification_source: "automatic" });
      expect(sqlite.prepare("SELECT classification, classification_source, score FROM conversations WHERE id = ?").get("manual"))
        .toEqual({ classification: "cold", classification_source: "manual", score: 25 });
      expect(broadcasts).toBe(1);
    } finally { sqlite.close(); }
  });

  it("a migração corrige os leads automáticos já existentes", () => {
    const sqlite = new DatabaseSync(":memory:");
    try {
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", "0001_initial.sql"), "utf8"));
      sqlite.prepare("INSERT INTO contacts (id, phone) VALUES (?, ?)").run("contact-1", "5592000000001");
      sqlite.prepare("INSERT INTO conversations (id, contact_id) VALUES (?, ?)").run("conversation-1", "contact-1");
      sqlite.prepare("INSERT INTO messages (id, conversation_id, direction, type, body, status) VALUES (?, ?, 'inbound', 'text', ?, 'received')")
        .run("message-1", "conversation-1", "Quero contratar e dar entrada no processo");
      sqlite.exec(readFileSync(join(process.cwd(), "migrations", "0012_backfill_automatic_lead_classification.sql"), "utf8"));
      expect(sqlite.prepare("SELECT classification, classification_source, score FROM conversations").get())
        .toEqual({ classification: "hot", classification_source: "automatic", score: 80 });
    } finally { sqlite.close(); }
  });
});
