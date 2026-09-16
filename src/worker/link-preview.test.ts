import { describe, expect, it } from "vitest";
import { extractLinkPreview, safePreviewUrl } from "./link-preview";

describe("prévia segura de links", () => {
  it("extrai Open Graph independentemente da ordem dos atributos", () => {
    const preview = extractLinkPreview(`<!doctype html><html><head>
      <meta content="Documento de Wagner &amp; contrato" property="og:title">
      <meta name="description" content="Confira o documento compartilhado.">
      <meta content="Adobe Acrobat" property="og:site_name">
    </head></html>`, new URL("https://acrobat.adobe.com/id/urn:test"));
    expect(preview).toEqual({
      url: "https://acrobat.adobe.com/id/urn:test",
      title: "Documento de Wagner & contrato",
      description: "Confira o documento compartilhado.",
      siteName: "Adobe Acrobat",
    });
  });

  it("usa o título HTML e o domínio como fallback", () => {
    expect(extractLinkPreview("<title>Contrato compartilhado</title>", new URL("https://example.com/doc")).title).toBe("Contrato compartilhado");
  });

  it.each(["http://127.0.0.1/a", "http://192.168.1.2/a", "http://localhost/a", "ftp://example.com/a", "https://user:secret@example.com/a", "https://example.com:8443/a"])("bloqueia endereço inseguro %s", (value) => {
    expect(() => safePreviewUrl(value)).toThrow();
  });
});
