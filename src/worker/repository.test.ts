import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { contactInput, conversationStatus } from "./repository";

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
