import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "./http";
import { normalizeIncoming, normalizeStatusUpdate, sendMedia, sendText } from "./zapi";

afterEach(() => vi.restoreAllMocks());

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

  it("repete o envio com o número canônico devolvido pela Z-API", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 400 }))
      .mockResolvedValueOnce(Response.json([{ exists: true, phone: "559284078295" }]))
      .mockResolvedValueOnce(Response.json({ messageId: "za-canonical" }));

    const providerId = await sendText({
      ENVIRONMENT: "production",
      ZAPI_INSTANCE_ID: "instance",
      ZAPI_INSTANCE_TOKEN: "token",
      ZAPI_CLIENT_TOKEN: "client",
    } as never, "5592984078295", "Teste");

    expect(providerId).toBe("za-canonical");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({ phone: "559284078295" });
  });

  it("envia imagem em Base64 pelo endpoint oficial", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ messageId: "za-image" }));
    const providerId = await sendMedia({
      ENVIRONMENT: "production", ZAPI_INSTANCE_ID: "instance", ZAPI_INSTANCE_TOKEN: "token", ZAPI_CLIENT_TOKEN: "client",
    } as never, "5592999990000", "image", "data:image/png;base64,AAAA", "foto.png", "Legenda");

    expect(providerId).toBe("za-image");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/send-image");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ phone: "5592999990000", image: "data:image/png;base64,AAAA", caption: "Legenda" });
  });

  it("envia documento com extensão e nome corretos", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ id: "za-document" }));
    await sendMedia({
      ENVIRONMENT: "production", ZAPI_INSTANCE_ID: "instance", ZAPI_INSTANCE_TOKEN: "token", ZAPI_CLIENT_TOKEN: "client",
    } as never, "5592999990000", "document", "data:application/pdf;base64,AAAA", "contrato.pdf", null);

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/send-document/pdf");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ fileName: "contrato.pdf" });
  });
});
