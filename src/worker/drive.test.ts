import { describe, expect, it } from "vitest";
import { validateContactDocumentFiles } from "./drive";
import { HttpError } from "./http";

const mb = 1024 * 1024;

describe("documentos de clientes", () => {
  it("aceita arquivos dentro dos limites", () => {
    expect(() => validateContactDocumentFiles([{ size: 6 * mb }, { size: 10 * mb }])).not.toThrow();
  });

  it("rejeita o total real mesmo sem depender de Content-Length", () => {
    expect(() => validateContactDocumentFiles([{ size: 9 * mb }, { size: 8 * mb }])).toThrow(HttpError);
  });

  it("rejeita quantidade e tamanho individual excessivos", () => {
    expect(() => validateContactDocumentFiles(Array.from({ length: 11 }, () => ({ size: 1 })))).toThrow(HttpError);
    expect(() => validateContactDocumentFiles([{ size: 10 * mb + 1 }])).toThrow(HttpError);
  });
});
