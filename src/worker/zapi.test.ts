import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { normalizeIncoming, normalizeStatusUpdate } from "./zapi";

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

  it("normaliza confirmação de envio", () => {
    expect(normalizeStatusUpdate({
      type: "DeliveryCallback",
      messageId: "za-1",
      phone: "5592999990000",
    })).toEqual([{ messageId: "za-1", status: "sent" }]);
    expect(normalizeStatusUpdate({
      type: "DeliveryCallback",
      messageId: "za-2",
      error: "PHONE_NOT_EXISTS",
    })).toEqual([{ messageId: "za-2", status: "failed" }]);
  });

  it("normaliza atualizações de status em lote", () => {
    expect(normalizeStatusUpdate({
      type: "MessageStatusCallback",
      status: "RECEIVED",
      ids: ["za-1", "za-2"],
      phone: "5592999990000",
    })).toEqual([
      { messageId: "za-1", status: "delivered" },
      { messageId: "za-2", status: "delivered" },
    ]);
    expect(normalizeStatusUpdate({
      type: "MessageStatusCallback",
      status: "PLAYED",
      ids: ["za-3"],
    })).toEqual([{ messageId: "za-3", status: "read" }]);
  });
});
