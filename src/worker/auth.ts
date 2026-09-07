import { HttpError, cleanText, readJson } from "./http";
import type { AppEnv, Permissions, SessionUser } from "./types";

const encoder = new TextEncoder();
const SESSION_COOKIE = "karrer_session";
const ITERATIONS = 100_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64ToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

export async function digest(value: string): Promise<string> {
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

type UserRow = Omit<SessionUser, "permissions"> & {
  avatarKey: string | null;
  canChat: number;
  canLeads: number;
  canClients: number;
  canSettings: number;
};

function sessionUser(row: UserRow): SessionUser {
  const elevated = row.role === "admin";
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    avatarUrl: row.avatarKey ? "/api/account/avatar" : null,
    professionalRole: row.professionalRole,
    permissions: {
      chat: elevated || Boolean(row.canChat),
      leads: elevated || Boolean(row.canLeads),
      clients: elevated || Boolean(row.canClients),
      settings: elevated || Boolean(row.canSettings),
    },
  };
}

export async function passwordRecord(passwordValue: unknown): Promise<{ hash: string; salt: string; iterations: number }> {
  const password = cleanText(passwordValue, 256, true)!;
  if (password.length < 10) throw new HttpError("A senha deve ter pelo menos 10 caracteres.", 422);
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  return { hash: await passwordHash(password, saltBytes), salt: bytesToBase64(saltBytes), iterations: ITERATIONS };
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
    SELECT u.id, u.name, u.email, u.role, u.avatar_key AS avatarKey, u.professional_role AS professionalRole, u.can_chat AS canChat, u.can_leads AS canLeads,
      u.can_clients AS canClients, u.can_settings AS canSettings
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND u.active = 1 AND u.email_verified = 1
  `).bind(tokenHash, new Date().toISOString()).first<UserRow>();
  return row ? sessionUser(row) : null;
}

export async function requireUser(request: Request, env: AppEnv): Promise<SessionUser> {
  const user = await currentUser(request, env);
  if (!user) throw new HttpError("Sessão expirada. Entre novamente.", 401);
  return user;
}

export function requirePermission(user: SessionUser, permission: keyof Permissions): void {
  if (!user.permissions[permission]) throw new HttpError("Você não tem acesso a esta área.", 403);
}

export function requireAnyPermission(user: SessionUser, permissions: Array<keyof Permissions>): void {
  if (!permissions.some((permission) => user.permissions[permission])) throw new HttpError("Você não tem acesso a esta área.", 403);
}

export function requireAdmin(user: SessionUser): void {
  if (user.role !== "admin") throw new HttpError("Acesso exclusivo do administrador.", 403);
}

async function createSession(userId: string, env: AppEnv): Promise<{ cookie: string }> {
  const token = bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
  const tokenHash = await digest(token);
  const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)")
    .bind(crypto.randomUUID(), userId, tokenHash, expires).run();
  return { cookie: `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200` };
}

export async function authStatus(request: Request, env: AppEnv) {
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return {
    setupRequired: Number(count?.total ?? 0) === 0,
    user: await currentUser(request, env),
    features: { googleDrive: Boolean(env.GOOGLE_SERVICE_ACCOUNT_EMAIL && env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY && env.GOOGLE_DRIVE_FOLDER_ID) },
  };
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
  const password = await passwordRecord(input.password);
  const user: SessionUser = { id: crypto.randomUUID(), name, email, role: "admin", avatarUrl: null, professionalRole: "Administrador", permissions: { chat: true, leads: true, clients: true, settings: true } };
  await env.DB.prepare(`INSERT INTO users
    (id, name, email, password_hash, password_salt, password_iterations, role, can_chat, can_leads, can_clients, can_settings, email_verified)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'admin', 1, 1, 1, 1, 1)`)
    .bind(user.id, user.name, user.email, password.hash, password.salt, password.iterations).run();
  const session = await createSession(user.id, env);
  return { user, cookie: session.cookie };
}

export async function login(request: Request, env: AppEnv): Promise<{ user: SessionUser; cookie: string }> {
  const input = await readJson<{ email?: unknown; password?: unknown }>(request);
  const email = cleanText(input.email, 180, true)!.toLowerCase();
  const password = cleanText(input.password, 256, true)!;
  const row = await env.DB.prepare(`SELECT id, name, email, role, avatar_key AS avatarKey, professional_role AS professionalRole, password_hash, password_salt, password_iterations,
    can_chat AS canChat, can_leads AS canLeads, can_clients AS canClients, can_settings AS canSettings
    FROM users WHERE email = ?1 AND active = 1 AND email_verified = 1`)
    .bind(email).first<UserRow & { password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row) throw new HttpError("E-mail ou senha inválidos.", 401);
  const computed = await passwordHash(password, base64ToBytes(row.password_salt), row.password_iterations);
  if (!(await safeEqual(computed, row.password_hash))) throw new HttpError("E-mail ou senha inválidos.", 401);
  const user = sessionUser(row);
  const session = await createSession(user.id, env);
  return { user, cookie: session.cookie };
}

export async function logout(request: Request, env: AppEnv): Promise<string> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(await digest(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export async function changePassword(request: Request, env: AppEnv, user: SessionUser): Promise<void> {
  const input = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(request);
  const currentPassword = cleanText(input.currentPassword, 256, true)!;
  const row = await env.DB.prepare("SELECT password_hash, password_salt, password_iterations FROM users WHERE id = ?1")
    .bind(user.id).first<{ password_hash: string; password_salt: string; password_iterations: number }>();
  if (!row) throw new HttpError("Usuário não encontrado.", 404);
  const computed = await passwordHash(currentPassword, base64ToBytes(row.password_salt), row.password_iterations);
  if (!(await safeEqual(computed, row.password_hash))) throw new HttpError("Senha atual incorreta.", 401);
  const next = await passwordRecord(input.newPassword);
  const currentToken = cookieValue(request, SESSION_COOKIE);
  const statements = [
    env.DB.prepare("UPDATE users SET password_hash = ?1, password_salt = ?2, password_iterations = ?3, updated_at = ?4 WHERE id = ?5")
      .bind(next.hash, next.salt, next.iterations, new Date().toISOString(), user.id),
  ];
  if (currentToken) {
    statements.push(env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1 AND token_hash <> ?2").bind(user.id, await digest(currentToken)));
  }
  await env.DB.batch(statements);
}

export async function resetPassword(request: Request, env: AppEnv): Promise<void> {
  const input = await readJson<{ token?: unknown; password?: unknown }>(request);
  const token = cleanText(input.token, 256, true)!;
  const row = await env.DB.prepare(`SELECT id, user_id AS userId FROM password_reset_tokens
    WHERE token_hash = ?1 AND used_at IS NULL AND expires_at > ?2`)
    .bind(await digest(token), new Date().toISOString()).first<{ id: string; userId: string }>();
  if (!row) throw new HttpError("Link inválido ou expirado.", 422);
  const password = await passwordRecord(input.password);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE users SET password_hash = ?1, password_salt = ?2, password_iterations = ?3, updated_at = ?4 WHERE id = ?5")
      .bind(password.hash, password.salt, password.iterations, now, row.userId),
    env.DB.prepare("UPDATE password_reset_tokens SET used_at = ?1 WHERE id = ?2").bind(now, row.id),
    env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(row.userId),
  ]);
}

export async function activateUser(request: Request, env: AppEnv): Promise<void> {
  const input = await readJson<{ email?: unknown; code?: unknown; password?: unknown }>(request);
  const email = cleanText(input.email, 180, true)!.toLowerCase();
  const code = cleanText(input.code, 6, true)!;
  if (!/^\d{6}$/.test(code)) throw new HttpError("Informe o código de 6 dígitos.", 422);
  const row = await env.DB.prepare(`SELECT c.id, c.user_id AS userId, c.code_hash AS codeHash, c.attempts,
      u.registration_source AS registrationSource
    FROM user_access_codes c JOIN users u ON u.id = c.user_id
    WHERE u.email = ?1 AND u.email_verified = 0 AND c.used_at IS NULL AND c.expires_at > ?2
    ORDER BY c.created_at DESC LIMIT 1`)
    .bind(email, new Date().toISOString()).first<{ id: string; userId: string; codeHash: string; attempts: number; registrationSource: "admin" | "self" }>();
  if (!row || row.attempts >= 5) throw new HttpError("Código inválido ou expirado.", 422);
  if (!(await safeEqual(await digest(code), row.codeHash))) {
    await env.DB.prepare("UPDATE user_access_codes SET attempts = attempts + 1 WHERE id = ?1").bind(row.id).run();
    throw new HttpError("Código inválido ou expirado.", 422);
  }
  const now = new Date().toISOString();
  const userUpdate = row.registrationSource === "admin"
    ? await passwordRecord(input.password)
    : null;
  await env.DB.batch([
    userUpdate
      ? env.DB.prepare(`UPDATE users SET password_hash = ?1, password_salt = ?2, password_iterations = ?3,
          email_verified = 1, active = 1, updated_at = ?4 WHERE id = ?5`)
        .bind(userUpdate.hash, userUpdate.salt, userUpdate.iterations, now, row.userId)
      : env.DB.prepare("UPDATE users SET email_verified = 1, active = 1, updated_at = ?1 WHERE id = ?2").bind(now, row.userId),
    env.DB.prepare("UPDATE user_access_codes SET used_at = ?1 WHERE id = ?2").bind(now, row.id),
  ]);
}

export async function touchPresence(request: Request, env: AppEnv, user: SessionUser): Promise<void> {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return;
  await env.DB.prepare("UPDATE sessions SET last_seen_at = ?1 WHERE user_id = ?2 AND token_hash = ?3")
    .bind(new Date().toISOString(), user.id, await digest(token)).run();
}
