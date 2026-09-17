const securityHeaders = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  for (const [key, value] of Object.entries(securityHeaders)) headers.set(key, value);
  return Response.json(data, { ...init, headers });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, { status });
}

export async function readJson<T>(request: Request, maxBytes = 1_000_000): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > maxBytes) throw new HttpError("Corpo da requisição muito grande.", 413);
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/json")) throw new HttpError("Use Content-Type application/json.", 415);
  try {
    return await request.json<T>();
  } catch {
    throw new HttpError("JSON inválido.", 400);
  }
}

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function normalizePhone(value: unknown): string {
  if (typeof value !== "string" || !/^[+()\s\d-]+$/.test(value)) {
    throw new HttpError("WhatsApp inválido. Use DDI, DDD e número.", 422);
  }
  const phone = value.replace(/\D/g, "");
  if (phone.length < 10 || phone.length > 15) throw new HttpError("WhatsApp inválido. Use DDI, DDD e número.", 422);
  return phone;
}

export function cleanText(value: unknown, maxLength: number, required = false): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new HttpError("Campo obrigatório não informado.", 422);
  if (text.length > maxLength) throw new HttpError(`Campo excede ${maxLength} caracteres.`, 422);
  return text || null;
}

export function routeMatch(pathname: string, pattern: RegExp): RegExpMatchArray | null {
  return pathname.match(pattern);
}
