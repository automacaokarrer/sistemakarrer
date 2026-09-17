import { describe, expect, it } from "vitest";
import { HttpError, normalizePhone } from "./http";
import { assertSameWhatsAppRecipient, callbackMatchesRecipient, normalizeZApiRecipient } from "./recipient-safety";

describe("assertSameWhatsAppRecipient", () => {
  it("aceita o número idêntico e a troca brasileira do nono dígito", () => {
    expect(assertSameWhatsAppRecipient("5592984078295", "559284078295")).toBe("559284078295");
    expect(assertSameWhatsAppRecipient("559284078295", "5592984078295")).toBe("5592984078295");
    expect(assertSameWhatsAppRecipient("5511999990000", "+55 (11) 99999-0000")).toBe("5511999990000");
  });

  it("recusa alteração de DDD, assinante ou nono dígito fora do padrão", () => {
    for (const resolved of ["551184078295", "559284078296", "5592884078295", "559294078295"]) {
      expect(() => assertSameWhatsAppRecipient("5592984078295", resolved)).toThrow(HttpError);
    }
  });

  it("recusa retorno ausente, malformado ou de outro país", () => {
    for (const resolved of [null, "", "cliente", "1559284078295"]) {
      expect(() => assertSameWhatsAppRecipient("5592984078295", resolved)).toThrow(HttpError);
    }
  });

  it("preserva o LID completo e não confunde seus dígitos com telefone", () => {
    expect(normalizeZApiRecipient("65998849469@lid")).toBe("65998849469@lid");
    expect(assertSameWhatsAppRecipient("65998849469@lid", "65998849469@lid")).toBe("65998849469@lid");
    expect(() => normalizeZApiRecipient("65998849469@c.us")).toThrow(HttpError);
    expect(() => normalizePhone("65998849469@lid")).toThrow(HttpError);
    expect(() => assertSameWhatsAppRecipient("65998849469@lid", "65998849469")).toThrow(HttpError);
  });

  it("reconhece callback pelo LID vinculado sem aceitar outro contato", () => {
    expect(callbackMatchesRecipient("5592984078295", "65998849469@lid", "559284078295", "65998849469@lid")).toBe(true);
    expect(callbackMatchesRecipient("65998849469@lid", "5592984078295", "559284078295", "65998849469@lid")).toBe(true);
    expect(callbackMatchesRecipient("5592984078295", "12345678901@lid", "559284078295", "65998849469@lid")).toBe(false);
    expect(callbackMatchesRecipient("5592984078295", "559284078296", "559284078295", "65998849469@lid")).toBe(false);
  });
});
