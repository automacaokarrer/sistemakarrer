import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { contactInput, conversationStatus, getMedia, mediaDownloadName } from "./repository";

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
