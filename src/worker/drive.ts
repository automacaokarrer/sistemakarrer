import { HttpError, json } from "./http";
import { audit } from "./repository";
import type { AppEnv, SessionUser } from "./types";

const MAX_DOCUMENTS_SIZE = 16 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD = 1024 * 1024;

function base64Url(value: Uint8Array | string): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function accessToken(env: AppEnv): Promise<string> {
  if (!env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || !env.GOOGLE_DRIVE_FOLDER_ID) {
    throw new HttpError("O Google Drive ainda não foi configurado pelo administrador.", 503);
  }
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL, scope: "https://www.googleapis.com/auth/drive.file", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const pem = env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const binary = atob(pem);
  const keyBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", keyBytes, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}` }),
  });
  const result = await response.json() as { access_token?: string };
  if (!response.ok || !result.access_token) throw new HttpError("Não foi possível autenticar no Google Drive.", 502);
  return result.access_token;
}

async function uploadFile(token: string, folderId: string, file: File): Promise<string> {
  const boundary = `karrer-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const metadata = JSON.stringify({ name: file.name, parents: [folderId] });
  const prefix = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n--${boundary}\r\nContent-Type: ${file.type || "application/octet-stream"}\r\n\r\n`);
  const suffix = encoder.encode(`\r\n--${boundary}--`);
  const contents = new Uint8Array(await file.arrayBuffer());
  const body = new Uint8Array(prefix.length + contents.length + suffix.length);
  body.set(prefix); body.set(contents, prefix.length); body.set(suffix, prefix.length + contents.length);
  const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
    body,
  });
  const result = await response.json() as { id?: string };
  if (!response.ok || !result.id) throw new HttpError(`O Google Drive recusou o arquivo ${file.name}.`, 502);
  return result.id;
}

export function validateContactDocumentFiles(files: Array<Pick<File, "size">>): void {
  const totalSize = files.reduce((total, file) => total + file.size, 0);
  if (files.length > 10) throw new HttpError("Envie no máximo 10 arquivos.", 413);
  if (files.some((file) => file.size > 10 * 1024 * 1024)) throw new HttpError("Cada arquivo deve ter no máximo 10 MB.", 413);
  if (totalSize > MAX_DOCUMENTS_SIZE) throw new HttpError("Os documentos devem totalizar no máximo 16 MB.", 413);
}

export async function uploadContactDocuments(request: Request, env: AppEnv, user: SessionUser, contactId: string): Promise<Response> {
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  // Content-Length inclui boundaries e cabeçalhos multipart. Reserve espaço para
  // esse envelope e valide abaixo o tamanho real dos arquivos, que é o limite
  // apresentado ao usuário.
  if (declaredSize > MAX_DOCUMENTS_SIZE + MAX_MULTIPART_OVERHEAD) {
    throw new HttpError("Os documentos devem totalizar no máximo 16 MB.", 413);
  }
  const contact = await env.DB.prepare("SELECT id FROM contacts WHERE id = ?1").bind(contactId).first();
  if (!contact) throw new HttpError("Cliente não encontrado.", 404);
  const form = await request.formData();
  const files = form.getAll("documents").filter((item): item is File => item instanceof File && item.size > 0);
  if (!files.length) throw new HttpError("Selecione ao menos um documento.", 422);
  validateContactDocumentFiles(files);
  const token = await accessToken(env);
  const uploaded: Array<{ id: string; name: string }> = [];
  for (const file of files) {
    const driveId = await uploadFile(token, env.GOOGLE_DRIVE_FOLDER_ID!, file);
    await env.DB.prepare("INSERT INTO contact_documents (id, contact_id, drive_file_id, file_name, mime_type, uploaded_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(crypto.randomUUID(), contactId, driveId, file.name.slice(0, 240), file.type || "application/octet-stream", user.id).run();
    uploaded.push({ id: driveId, name: file.name });
  }
  await audit(env, user, "contact.documents.upload", "contact", contactId, { count: uploaded.length });
  return json({ documents: uploaded }, { status: 201 });
}
