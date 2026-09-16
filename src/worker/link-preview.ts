import { HttpError, json } from "./http";

const MAX_HTML_BYTES = 512_000;
const MAX_REDIRECTS = 3;

export interface LinkPreviewData {
  url: string;
  title: string;
  description: string | null;
  siteName: string;
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

export function safePreviewUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new HttpError("Link inválido.", 422); }
  const hostname = url.hostname.toLowerCase();
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) throw new HttpError("Link não permitido.", 422);
  if ((url.protocol === "https:" && url.port && url.port !== "443") || (url.protocol === "http:" && url.port && url.port !== "80")) throw new HttpError("Porta do link não permitida.", 422);
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local") || hostname.endsWith(".internal") || hostname.includes(":") || isPrivateIpv4(hostname)) {
    throw new HttpError("Endereço do link não permitido.", 422);
  }
  return url;
}

function decodeHtml(value: string): string {
  const named: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " };
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity: string) => {
    if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
    const hex = entity[1].toLowerCase() === "x";
    const point = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    return Number.isFinite(point) ? String.fromCodePoint(point) : match;
  }).replace(/\s+/g, " ").trim();
}

function attribute(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return match ? decodeHtml(match[1] ?? match[2] ?? match[3] ?? "") : null;
}

export function extractLinkPreview(html: string, finalUrl: URL): LinkPreviewData {
  const metadata = new Map<string, string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = (attribute(tag, "property") ?? attribute(tag, "name"))?.toLowerCase();
    const content = attribute(tag, "content");
    if (key && content && !metadata.has(key)) metadata.set(key, content);
  }
  const titleTag = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const rawTitle = metadata.get("og:title") ?? metadata.get("twitter:title") ?? (titleTag ? decodeHtml(titleTag.replace(/<[^>]*>/g, "")) : "");
  const title = rawTitle.slice(0, 180).trim() || finalUrl.hostname.replace(/^www\./, "");
  const description = (metadata.get("og:description") ?? metadata.get("twitter:description") ?? metadata.get("description"))?.slice(0, 320).trim() || null;
  const siteName = (metadata.get("og:site_name") ?? finalUrl.hostname.replace(/^www\./, "")).slice(0, 100);
  return { url: finalUrl.href, title, description, siteName };
}

async function readLimitedHtml(response: Response): Promise<string> {
  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_HTML_BYTES) throw new HttpError("Página muito grande para gerar prévia.", 422);
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTML_BYTES) { await reader.cancel(); throw new HttpError("Página muito grande para gerar prévia.", 422); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function getLinkPreview(url: URL): Promise<Response> {
  let target = safePreviewUrl(url.searchParams.get("url") ?? "");
  let response: Response | null = null;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    response = await fetch(target, {
      redirect: "manual",
      headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "KarrerCRM-LinkPreview/1.0" },
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    const location = response.headers.get("location");
    if (!location || redirects === MAX_REDIRECTS) throw new HttpError("O link redirecionou muitas vezes.", 422);
    target = safePreviewUrl(new URL(location, target).href);
  }
  if (!response?.ok) throw new HttpError("Não foi possível abrir o link.", 422);
  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) throw new HttpError("O link não aponta para uma página com prévia.", 422);
  return json(extractLinkPreview(await readLimitedHtml(response), target));
}
