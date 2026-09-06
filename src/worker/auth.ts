import { HttpError, cleanText, readJson } from "./http";
import type { AppEnv, SessionUser } from "./types";

const encoder = new TextEncoder();
const SESSION_COOKIE = "karrer_session";
const ITERATIONS = 210_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function digest(value: string): Promise<string> {
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function safeEqual(left: string, right: string): Promise<boolean> {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  return crypto.subtle.timingSafeEqual(leftHash, rightHash);
}

async function passwordHash(password: string, salt: Uint8Array, iterations = ITERATIONS): Promise<string> {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material, 256);
  return bytesToBase64(new Uint8Array(bits));
}

function cookieValue(request: Request, name: string): string | null {
  const cookies = request.headers.get("cookie") ?? "";
  for (const part of cookies.split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export async function currentUser(request: Request, env: AppEnv): Promise<SessionUser | null> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await digest(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.name, u.email, u.role
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.active = 1
  `).bind(tokenHash, new Date().toISOString()).first<SessionUser>();
  return row ?? null;
}

export async function requireUser(request: Request, env: AppEnv): Promise<SessionUser> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError("Sessão expirada. Entre novamente.", 401);
  return user;
}

async function createSession(userId: string, env: AppEnv): Promise<{ cookie: string }> {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), userId, tokenHash, expires).run();
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` };
}

export async function authStatus(request: Request, env: AppEnv): Promise<{ setupRequired: boolean; user: SessionUser | null }> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return { setupRequired: Number(count?.total ?? 0) === 0, user: await currentUser(request, env) };
}

export async function bootstrap(request: Request, env: AppEnv): Promise<{ user: SessionUser; cookie: string }> {
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  if (Number(count?.total ?? 0) > 0) throw new HttpError("A configuração inicial já foi concluída.", 409);
  if (!env.BOOTSTRAP_ADMIN_TOKEN) throw new HttpError("BOOTSTRAP_ADMIN_TOKEN não configurado no Worker.", 503);
  const input = await readJson<{ name?: unknown; email?: unknown; password?: unknown; bootstrapToken?: unknown }>(request);
  const supplied = cleanText(input.bootstrapToken, 256, true)!;
  if (!(await safeEqual(supplied, env.BOOTSTRAP_ADMIN_TOKEN))) throw new HttpError("Código de inicialização inválido.", 403);
  const name = cleanText(input.name, 120, true)!;
  const email = cleanText(input.email, 180, true)!.toLowerCase();
  const password = cleanText(input.password, 256, true)!;
  if (password.length < 10) throw new HttpError("A senha deve ter pelo menos 10 caracteres.", 422);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const user: SessionUser = { id: crypto.randomUUID(), name, email, role: "admin" };
  await env.DB.prepare("INSERT INTO users (id, name, email, password_hash, password_salt, password_iterations, role) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin')")
    .bind(user.id, user.name, user.email, await passwordHash(password, salt), bytesToBase64(salt), ITERATIONS).run();
  const session = await createSession(user.id, env);
  return { user, cookie: session.cookie };
}

export async function login(request: Request, env: AppEnv): Promise<{ user: SessionUser; cookie: string }> {
  const input = await readJson<{ email?: unknown; password?: unknown }>(request);
  const email = cleanText(input.email, 180, true)!.toLowerCase();
  const password = cleanText(input.password, 256, true)!;
  const row = await env.DB.prepare("SELECT id, name, email, role, password_hash, password_salt, password_iterations FROM users WHERE email = ?1 AND active = 1")
    .bind(email).first<SessionUser & { password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row) throw new HttpError("E-mail ou senha inválidos.", 401);
  const computed = await passwordHash(password, base64ToBytes(row.password_salt), row.password_iterations);
  if (!(await safeEqual(computed, row.password_hash))) throw new HttpError("E-mail ou senha inválidos.", 401);
  const user: SessionUser = { id: row.id, name: row.name, email: row.email, role: row.role };
  const session = await createSession(user.id, env);
  return { user, cookie: session.cookie };
}

export async function logout(request: Request, env: AppEnv): Promise<string> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await digest(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
