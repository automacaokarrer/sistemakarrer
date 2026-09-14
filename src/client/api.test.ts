import { describe, expect, it } from "vitest";
import { formatResponseDuration } from "./api";

describe("formatação do tempo de primeira resposta", () => {
  it("mantém minutos abaixo de uma hora", () => {
    expect(formatResponseDuration(14.9)).toBe("14,9 min");
  });

  it("mostra horas e minutos a partir de uma hora", () => {
    expect(formatResponseDuration(60)).toBe("1h 0min");
    expect(formatResponseDuration(279)).toBe("4h 39min");
  });

  it("trata ausência e respostas inferiores a seis segundos", () => {
    expect(formatResponseDuration(null)).toBe("—");
    expect(formatResponseDuration(0.05)).toBe("< 0,1 min");
  });
});
