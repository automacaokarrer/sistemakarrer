import { HttpError, cleanText, normalizePhone } from "./http";
import type { AppEnv, ZApiPayload } from "./types";

export type ZApiMessageStatus = "sent" | "delivered" | "read" | "failed";

export function normalizeStatusUpdate(payload: ZApiPayload): Array<{ messageId: string; status: ZApiMessageStatus }> | null {
  const type = payload.type?.toLowerCase();
  if (type === "deliverycallback" && payload.messageId) {
    return [{ messageId: payload.messageId, status: payload.error ? "failed" : "sent" }];
  }
  if (type !== "messagestatuscallback" || !payload.ids?.length) return null;

  const providerStatus = payload.status?.toUpperCase();
  const status: ZApiMessageStatus | null = providerStatus === "SENT"
    ? "sent"
    : providerStatus === "RECEIVED"
      ? "delivered"
      : providerStatus === "READ" || providerStatus === "READ_BY_ME" || providerStatus === "PLAYED"
        ? "read"
        : null;
  if (!status) return [];
  return payload.ids.filter(Boolean).map((messageId) => ({ messageId, status }));
}

export async function sendText(env: AppEnv, phone: string, message: string): Promise<string> {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    if (env.ENVIRONMENT === "development") return `local-${crypto.randomUUID()}`;
    throw new HttpError("Integração Z-API ainda não configurada.", 503);
  }
  const endpoint = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}/send-text`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });
  if (!response.ok) throw new HttpError("A Z-API recusou o envio da mensagem.", 502);
  const result = await response.json<{ messageId?: string; id?: string }>();
  return result.messageId ?? result.id ?? crypto.randomUUID();
}

export function normalizeIncoming(payload: ZApiPayload): {
  phone: string;
  name: string;
  zapiMessageId: string;
  createdAt: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "audio" | "video" | "document";
  body: string | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  fileName: string | null;
  mime: string | null;
  duration: number | null;
} {
  if (payload.isGroup || payload.isNewsletter) throw new HttpError("Grupos e canais não são processados.", 202);
  const phone = normalizePhone(payload.phone);
  const name = cleanText(payload.senderName ?? payload.chatName, 120) ?? phone;
  const common = {
    phone,
    name,
    zapiMessageId: cleanText(payload.messageId, 200, true)!,
    createdAt: new Date(payload.momment && payload.momment > 0 ? payload.momment : Date.now()).toISOString(),
    direction: payload.fromMe ? "outbound" as const : "inbound" as const,
  };
  if (payload.text?.message) return { ...common, type: "text", body: cleanText(payload.text.message, 10_000), mediaUrl: null, thumbnailUrl: null, fileName: null, mime: null, duration: null };
  if (payload.image?.imageUrl) return { ...common, type: "image", body: cleanText(payload.image.caption, 2_000), mediaUrl: payload.image.imageUrl, thumbnailUrl: payload.image.thumbnailUrl ?? null, fileName: null, mime: payload.image.mimeType ?? "image/jpeg", duration: null };
  if (payload.audio?.audioUrl) return { ...common, type: "audio", body: null, mediaUrl: payload.audio.audioUrl, thumbnailUrl: null, fileName: null, mime: payload.audio.mimeType ?? "audio/ogg", duration: payload.audio.seconds ?? null };
  if (payload.video?.videoUrl) return { ...common, type: "video", body: cleanText(payload.video.caption, 2_000), mediaUrl: payload.video.videoUrl, thumbnailUrl: null, fileName: null, mime: payload.video.mimeType ?? "video/mp4", duration: null };
  if (payload.document?.documentUrl) return { ...common, type: "document", body: null, mediaUrl: payload.document.documentUrl, thumbnailUrl: null, fileName: cleanText(payload.document.fileName, 240) ?? "documento", mime: payload.document.mimeType ?? "application/octet-stream", duration: null };
  throw new HttpError("Tipo de mensagem Z-API não suportado.", 202);
}

export async function storeRemoteMedia(env: AppEnv, mediaUrl: string, key: string, mime: string | null): Promise<void> {
  const url = new URL(mediaUrl);
  if (url.protocol !== "https:") throw new HttpError("URL de mídia insegura.", 422);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new HttpError("Não foi possível copiar a mídia recebida.", 502);
  await env.MEDIA.put(key, response.body, { httpMetadata: { contentType: mime ?? response.headers.get("content-type") ?? "application/octet-stream" } });
}
