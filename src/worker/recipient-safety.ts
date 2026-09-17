import { HttpError, normalizePhone } from "./http";

export function isZApiLid(value: unknown): value is `${number}@lid` {
  return typeof value === "string" && /^\d{5,20}@lid$/.test(value.trim());
}

/** Z-API accepts either a telephone number or the full private @lid address. */
export function normalizeZApiRecipient(value: unknown): string {
  if (isZApiLid(value)) return value.trim();
  if (typeof value !== "string" || !/^[+()\s\d-]+$/.test(value)) {
    throw new HttpError("Identificador de WhatsApp inválido.", 422);
  }
  return normalizePhone(value);
}

function brazilianMobileIdentity(phone: string): string | null {
  if (!phone.startsWith("55")) return null;
  const ddd = phone.slice(2, 4);
  const local = phone.slice(4);
  if (!/^[1-9][0-9]$/.test(ddd)) return null;
  if (local.length === 8 && /^[6-9][0-9]{7}$/.test(local)) return `${ddd}${local}`;
  if (local.length === 9 && /^9[6-9][0-9]{7}$/.test(local)) return `${ddd}${local.slice(1)}`;
  return null;
}

/** Fail closed if a provider lookup resolves to a different recipient. */
export function assertSameWhatsAppRecipient(requested: string, resolved: unknown): string {
  const requestedPhone = normalizeZApiRecipient(requested);
  let resolvedPhone: string;
  try {
    resolvedPhone = normalizeZApiRecipient(resolved);
  } catch {
    throw new HttpError("A Z-API não confirmou o WhatsApp do destinatário. Envio interrompido.", 502);
  }

  if (requestedPhone === resolvedPhone) return resolvedPhone;
  if (isZApiLid(requestedPhone) || isZApiLid(resolvedPhone)) {
    throw new HttpError("A Z-API retornou um WhatsApp diferente do destinatário. Envio interrompido.", 502);
  }
  const requestedMobile = brazilianMobileIdentity(requestedPhone);
  if (requestedMobile && requestedMobile === brazilianMobileIdentity(resolvedPhone)) return resolvedPhone;
  throw new HttpError("A Z-API retornou um WhatsApp diferente do destinatário. Envio interrompido.", 502);
}

/** A callback may identify a known contact by its private LID instead of its number. */
export function callbackMatchesRecipient(sentTo: string, reported: unknown, contactPhone: string, contactLid: string | null): boolean {
  let callbackAddress: string;
  try {
    callbackAddress = normalizeZApiRecipient(reported);
    assertSameWhatsAppRecipient(sentTo, callbackAddress);
    return true;
  } catch {
    try {
      callbackAddress = normalizeZApiRecipient(reported);
    } catch {
      return false;
    }
  }

  if (!contactLid || !isZApiLid(contactLid)) return false;
  const sentLid = isZApiLid(sentTo);
  const callbackLid = isZApiLid(callbackAddress);
  if (sentLid === callbackLid) return false;
  try {
    return sentLid
      ? sentTo === contactLid && assertSameWhatsAppRecipient(contactPhone, callbackAddress) === callbackAddress
      : callbackAddress === contactLid && assertSameWhatsAppRecipient(contactPhone, sentTo) === sentTo;
  } catch {
    return false;
  }
}
