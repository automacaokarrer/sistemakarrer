import { HttpError, cleanText, json, normalizePhone } from "./http";
import { assertSameWhatsAppRecipient, isZApiLid, normalizeZApiRecipient } from "./recipient-safety";
import type { AppEnv, ZApiPayload } from "./types";

export type ZApiMessageStatus = "sent" | "delivered" | "read" | "failed";

interface ZApiPhoneLookup {
  exists?: boolean;
  phone?: string;
}

const ZAPI_REQUEST_TIMEOUT_MS = 15_000;

type ZApiLogOutcome = "accepted" | "provider_rejected" | "timeout" | "network_error";

async function recordZApiDelivery(env: AppEnv, operation: string, httpStatus: number | null, outcome: ZApiLogOutcome,
  errorCode: string | null, latencyMs: number): Promise<void> {
  try {
    await env.DB?.prepare(`INSERT INTO zapi_delivery_logs
      (id, operation, http_status, outcome, error_code, latency_ms)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(crypto.randomUUID(), operation, httpStatus, outcome, errorCode, Math.max(0, Math.round(latencyMs))).run();
  } catch {
    // Delivery logging must never turn a successful provider call into a failed send.
  }
}

async function fetchZApi(env: AppEnv, operation: string, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ZAPI_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    await recordZApiDelivery(env, operation, response.status, response.ok ? "accepted" : "provider_rejected",
      response.ok ? null : `HTTP_${response.status}`, Date.now() - startedAt);
    return response;
  } catch (reason) {
    const timedOut = reason instanceof DOMException && reason.name === "AbortError";
    await recordZApiDelivery(env, operation, null, timedOut ? "timeout" : "network_error",
      timedOut ? "TIMEOUT" : "NETWORK_ERROR", Date.now() - startedAt);
    if (timedOut) throw new HttpError("A Z-API nÃ£o respondeu dentro do prazo de seguranÃ§a.", 504);
    throw new HttpError("NÃ£o foi possÃ­vel alcanÃ§ar a Z-API.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function providerMessageId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const result = value as Record<string, unknown>;
  for (const key of ["messageId", "id", "zaapId"]) {
    const id = result[key];
    if (typeof id === "string" && id.trim()) return id;
  }
  return null;
}

function postText(env: AppEnv, endpoint: string, clientToken: string, phone: string, message: string): Promise<Response> {
  return fetchZApi(env, "send_text", endpoint, {
    method: "POST",
    headers: { "Client-Token": clientToken, "Content-Type": "application/json" },
    body: JSON.stringify({ phone, message }),
  });
}

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

export async function sendTextDetailed(env: AppEnv, phone: string, message: string): Promise<{ messageId: string | null; recipientPhone: string }> {
  const normalizedPhone = normalizeZApiRecipient(phone);
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    if (env.ENVIRONMENT === "development") return { messageId: `local-${crypto.randomUUID()}`, recipientPhone: normalizedPhone };
    throw new HttpError("Integração Z-API ainda não configurada.", 503);
  }
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}`;
  let recipientPhone = normalizedPhone;
  let response = await postText(env, `${baseUrl}/send-text`, env.ZAPI_CLIENT_TOKEN, normalizedPhone, message);
  if (response.status === 400 && !isZApiLid(normalizedPhone)) {
    const lookupResponse = await fetchZApi(env, "phone_exists", `${baseUrl}/phone-exists/${encodeURIComponent(normalizedPhone)}`, {
      headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN },
    });
    if (lookupResponse.ok) {
      const lookupResult = await lookupResponse.json<ZApiPhoneLookup | ZApiPhoneLookup[]>();
      const lookup = Array.isArray(lookupResult) ? lookupResult[0] : lookupResult;
      const canonicalPhone = lookup?.exists && lookup.phone ? assertSameWhatsAppRecipient(normalizedPhone, lookup.phone) : normalizedPhone;
      if (canonicalPhone !== normalizedPhone) {
        response = await postText(env, `${baseUrl}/send-text`, env.ZAPI_CLIENT_TOKEN, canonicalPhone, message);
        recipientPhone = canonicalPhone;
      }
    }
  }
  if (!response.ok) throw new HttpError("A Z-API recusou o envio da mensagem.", 502);
  const result: unknown = await response.json().catch(() => null);
  return { messageId: providerMessageId(result), recipientPhone };
}

export async function sendText(env: AppEnv, phone: string, message: string): Promise<string> {
  const sent = await sendTextDetailed(env, phone, message);
  if (!sent.messageId) throw new HttpError("A Z-API aceitou o envio sem identificador. Confira o WhatsApp antes de tentar novamente.", 502);
  return sent.messageId;
}

export async function sendMedia(env: AppEnv, phone: string, kind: "image" | "audio" | "document", dataUrl: string, fileName: string | null, caption: string | null): Promise<string | null> {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    if (env.ENVIRONMENT === "development") return `local-${crypto.randomUUID()}`;
    throw new HttpError("Integração Z-API ainda não configurada.", 503);
  }
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}`;
  const normalizedPhone = normalizeZApiRecipient(phone);
  if (isZApiLid(normalizedPhone)) throw new HttpError("Envio de arquivo para identificador privado ainda não confirmado pela Z-API.", 422);
  const extension = (fileName?.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const endpoint = kind === "document" ? `${baseUrl}/send-document/${encodeURIComponent(extension)}` : `${baseUrl}/send-${kind}`;
  const payload = kind === "image"
    ? { phone: normalizedPhone, image: dataUrl, ...(caption ? { caption } : {}) }
    : kind === "audio"
      ? { phone: normalizedPhone, audio: dataUrl, waveform: true }
      : { phone: normalizedPhone, document: dataUrl, ...(fileName ? { fileName } : {}), ...(caption ? { caption } : {}) };
  const response = await fetchZApi(env, "send_media", endpoint, {
    method: "POST",
    headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new HttpError("A Z-API recusou o envio do arquivo.", 502);
  const result: unknown = await response.json().catch(() => null);
  return providerMessageId(result);
}

function messageMutationPhone(phone: string): string {
  const recipient = normalizeZApiRecipient(phone);
  if (isZApiLid(recipient)) throw new HttpError("A Z-API ainda não confirma edição ou exclusão para identificadores privados.", 422);
  return recipient;
}

export async function editTextMessage(env: AppEnv, phone: string, messageId: string, message: string): Promise<void> {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    if (env.ENVIRONMENT === "development") return;
    throw new HttpError("Integração Z-API ainda não configurada.", 503);
  }
  const recipient = messageMutationPhone(phone);
  const endpoint = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}/send-text`;
  const response = await fetchZApi(env, "edit_text", endpoint, {
    method: "POST",
    headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ phone: recipient, message, editMessageId: messageId }),
  });
  if (!response.ok) throw new HttpError("A Z-API recusou a edição da mensagem.", 502);
}

export async function deleteMessageForEveryone(env: AppEnv, phone: string, messageId: string): Promise<void> {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    if (env.ENVIRONMENT === "development") return;
    throw new HttpError("Integração Z-API ainda não configurada.", 503);
  }
  const recipient = messageMutationPhone(phone);
  const endpoint = new URL(`https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}/messages`);
  endpoint.searchParams.set("messageId", messageId);
  endpoint.searchParams.set("phone", recipient);
  endpoint.searchParams.set("owner", "true");
  const response = await fetchZApi(env, "delete_message", endpoint, { method: "DELETE", headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN } });
  if (!response.ok) throw new HttpError("A Z-API recusou apagar a mensagem para todos.", 502);
  if (response.status === 204) return;
  const result: unknown = await response.json().catch(() => null);
  if (response.status !== 200 || !result || typeof result !== "object" || (result as { value?: unknown }).value !== true) {
    throw new HttpError("A Z-API não confirmou a exclusão para todos.", 502);
  }
}

export async function getZApiHealth(env: AppEnv): Promise<Response> {
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) {
    throw new HttpError("IntegraÃ§Ã£o Z-API ainda nÃ£o configurada.", 503);
  }
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}`;
  const checkedAt = new Date().toISOString();
  let statusCode: number | null = null;
  let connected = false;
  let smartphoneConnected = false;
  let errorCode: string | null = null;
  try {
    const response = await fetchZApi(env, "status", `${baseUrl}/status`, { headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN } });
    statusCode = response.status;
    const payload = await response.json().catch(() => null) as { connected?: unknown; smartphoneConnected?: unknown } | null;
    connected = payload?.connected === true;
    smartphoneConnected = payload?.smartphoneConnected === true;
    if (!response.ok) errorCode = `HTTP_${response.status}`;
  } catch (reason) {
    errorCode = reason instanceof HttpError && reason.status === 504 ? "TIMEOUT" : "NETWORK_ERROR";
  }
  const metrics = await env.DB.prepare(`SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN outcome = 'accepted' THEN 1 ELSE 0 END) AS accepted,
      SUM(CASE WHEN outcome IN ('provider_rejected', 'timeout', 'network_error') THEN 1 ELSE 0 END) AS failures,
      SUM(CASE WHEN outcome = 'timeout' THEN 1 ELSE 0 END) AS timeouts
    FROM zapi_delivery_logs WHERE created_at >= datetime('now', '-24 hours')`)
    .first<{ total: number; accepted: number; failures: number; timeouts: number }>();
  return json({
    ok: connected && smartphoneConnected,
    checkedAt,
    connected,
    smartphoneConnected,
    statusCode,
    errorCode,
    last24h: {
      requests: Number(metrics?.total ?? 0),
      accepted: Number(metrics?.accepted ?? 0),
      failures: Number(metrics?.failures ?? 0),
      timeouts: Number(metrics?.timeouts ?? 0),
    },
  }, { status: connected && smartphoneConnected ? 200 : 503 });
}

export async function fetchContactProfilePicture(env: AppEnv, phone: string): Promise<{ body: ArrayBuffer; mime: string } | null> {
  if (isZApiLid(phone)) return null;
  if (!env.ZAPI_INSTANCE_ID || !env.ZAPI_INSTANCE_TOKEN || !env.ZAPI_CLIENT_TOKEN) return null;
  const baseUrl = `https://api.z-api.io/instances/${encodeURIComponent(env.ZAPI_INSTANCE_ID)}/token/${encodeURIComponent(env.ZAPI_INSTANCE_TOKEN)}`;
  const metadata = await fetchZApi(env, "profile_picture", `${baseUrl}/profile-picture?phone=${encodeURIComponent(normalizePhone(phone))}`, {
    headers: { "Client-Token": env.ZAPI_CLIENT_TOKEN },
  });
  if (!metadata.ok) return null;
  const result = await metadata.json<{ link?: string }>();
  if (!result.link) return null;
  const url = new URL(result.link);
  if (url.protocol !== "https:") return null;
  const image = await fetchZApi(env, "profile_picture_media", url, { redirect: "follow" });
  if (!image.ok) return null;
  const mime = image.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (!mime.startsWith("image/")) return null;
  const declaredSize = Number(image.headers.get("content-length") ?? 0);
  if (declaredSize > 5 * 1024 * 1024) return null;
  const body = await image.arrayBuffer();
  if (!body.byteLength || body.byteLength > 5 * 1024 * 1024) return null;
  return { body, mime };
}

export function normalizeIncoming(payload: ZApiPayload): {
  phone: string;
  chatLid: string | null;
  name: string | null;
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
  const phone = normalizeZApiRecipient(payload.phone);
  const chatLid = payload.chatLid === undefined || payload.chatLid === null
    ? (isZApiLid(phone) ? phone : null)
    : isZApiLid(payload.chatLid) ? payload.chatLid.trim() : null;
  if (payload.chatLid && !chatLid) throw new HttpError("LID Z-API inválido.", 422);
  if (isZApiLid(phone) && chatLid && phone !== chatLid) throw new HttpError("Identificadores Z-API divergentes.", 422);
  const suppliedName = cleanText(payload.senderName ?? payload.chatName, 120);
  const name = suppliedName && !isZApiLid(suppliedName) && suppliedName !== phone && suppliedName !== chatLid ? suppliedName : null;
  const common = {
    phone,
    chatLid,
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
  const response = await fetchZApi(env, "receive_media", url, { redirect: "follow" });
  if (!response.ok || !response.body) throw new HttpError("Não foi possível copiar a mídia recebida.", 502);
  await env.MEDIA.put(key, response.body, { httpMetadata: { contentType: mime ?? response.headers.get("content-type") ?? "application/octet-stream" } });
}
