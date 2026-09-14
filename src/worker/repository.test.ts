import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { contactInput, conversationStatus, getMedia, mediaDownloadName, updateConversationAssignee, updateConversationLuna } from "./repository";

describe("status operacional da conversa", () => {
  it.each(["new", "in_progress", "waiting_customer", "resolved"])("aceita %s", (status) => {
    expect(conversationStatus(status)).toBe(status);
  });

  it("recusa um status desconhecido", () => {
    expect(() => conversationStatus("archived")).toThrow(HttpError);
  });
});

describe("edição de cliente", () => {
  const pending = { phone: "(92) 99999-9999", name: "", cpf: "", classification: "warm" };

  it("permite atualizar um contato incompleto sem inventar CPF", () => {
    expect(contactInput(pending, true)).toMatchObject({ phone: "92999999999", name: null, cpf: null, profileComplete: false });
  });

  it("marca a ficha completa quando nome e CPF válido são preenchidos", () => {
    expect(contactInput({ ...pending, name: "Maria", cpf: "111.444.777-35", classification: "hot" }, true))
      .toMatchObject({ cpf: "11144477735", classification: "hot", profileComplete: true });
  });

  it("recusa CPF inválido e mantém obrigatoriedade na criação", () => {
    expect(() => contactInput({ ...pending, cpf: "123" }, true)).toThrow(HttpError);
    expect(() => contactInput(pending)).toThrow(HttpError);
  });
});

describe("download de mídia privada", () => {
  it("preserva extensão segura e infere a extensão real quando ela não existe", () => {
    expect(mediaDownloadName("comprovante.png", "image/png")).toBe("comprovante.png");
    expect(mediaDownloadName("imagem da conversa", "image/webp")).toBe("imagem_da_conversa.webp");
    expect(mediaDownloadName("..", "image/jpeg")).toBe("imagem.jpg");
  });

  it("força download com nome seguro sem perder o tipo do arquivo", async () => {
    const object = {
      body: new Uint8Array([1, 2, 3]),
      httpEtag: '"etag-test"',
      writeHttpMetadata: (headers: Headers) => headers.set("Content-Type", "image/webp"),
    };
    const response = await getMedia({ MEDIA: { get: async () => object } } as never, "media-key",
      new URL("https://crm.test/api/media/media-key?download=1&filename=imagem_da_conversa"));
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="imagem_da_conversa.webp"');
    expect(response.headers.get("Content-Type")).toBe("image/webp");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});

describe("controle individual da Luna", () => {
  it("autoriza a conversa, remove o atendente e desativa a Luna quando um humano assume", async () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT, role TEXT, active INTEGER, can_chat INTEGER);
        CREATE TABLE conversations (id TEXT PRIMARY KEY, assignee_id TEXT, service_status TEXT, luna_autonomous_enabled INTEGER DEFAULT 0, luna_enabled_by TEXT, luna_enabled_at TEXT, updated_at TEXT);
        CREATE TABLE audit_logs (id TEXT, actor_id TEXT, action TEXT, entity_type TEXT, entity_id TEXT, metadata_json TEXT);
        INSERT INTO users VALUES ('human-1', 'Atendente', 'attendant', 1, 1);
        INSERT INTO conversations VALUES ('conversation-1', 'human-1', 'in_progress', 0, NULL, NULL, NULL);
      `);
      const env = {
        DB: { prepare: (sql: string) => ({ bind: (...values: SQLInputValue[]) => {
          const statement = db.prepare(sql);
          return {
            first: async () => statement.get(...values) ?? null,
            run: async () => ({ meta: { changes: Number(statement.run(...values).changes) } }),
          };
        } }) },
        CHAT_ROOMS: { getByName: () => ({ broadcast: async () => undefined }) },
      } as never;
      const admin = { id: "admin-1", name: "Admin", role: "admin" } as never;
      const request = (body: unknown) => new Request("https://crm.test", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

      await updateConversationLuna(request({ enabled: true }), env, admin, "conversation-1");
      expect(db.prepare("SELECT assignee_id, luna_autonomous_enabled, luna_enabled_by FROM conversations").get())
        .toMatchObject({ assignee_id: null, luna_autonomous_enabled: 1, luna_enabled_by: "admin-1" });

      await updateConversationAssignee(request({ userId: "human-1" }), env, admin, "conversation-1");
      expect(db.prepare("SELECT assignee_id, luna_autonomous_enabled, luna_enabled_by FROM conversations").get())
        .toMatchObject({ assignee_id: "human-1", luna_autonomous_enabled: 0, luna_enabled_by: null });
    } finally {
      db.close();
    }
  });
});
