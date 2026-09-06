import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { normalizeIncoming } from "./zapi";

describe("webhook Z-API", () => {
  it("normaliza mensagem de texto recebida", () => {
    const message = normalizeIncoming({
      messageId: "za-1",
      phone: "5592999990000",
      senderName: "Maria Souza",
      momment: 1_788_700_000_000,
      text: { message: "Olá" },
    });

    expect(message).toMatchObject({
      phone: "5592999990000",
      name: "Maria Souza",
      zapiMessageId: "za-1",
      direction: "inbound",
      type: "text",
      body: "Olá",
    });
  });

  it("ignora grupos", () => {
    expect(() => normalizeIncoming({ isGroup: true, phone: "5592999990000" })).toThrow(HttpError);
  });
});
