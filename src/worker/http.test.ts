import { describe, expect, it } from "vitest";
import { HttpError, cleanText, normalizePhone } from "./http";

describe("normalização de entrada", () => {
  it("mantém somente os dígitos do WhatsApp", () => {
    expect(normalizePhone("+55 (92) 99999-0000")).toBe("5592999990000");
  });

  it("rejeita um telefone incompleto", () => {
    expect(() => normalizePhone("123")).toThrow(HttpError);
  });

  it("limita textos antes de persistir", () => {
    expect(cleanText("  Karrer  ", 20, true)).toBe("Karrer");
    expect(() => cleanText("texto longo", 3)).toThrow(HttpError);
  });
});
