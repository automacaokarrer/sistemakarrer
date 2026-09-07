import { digest, passwordRecord } from "./auth";
import { HttpError, cleanText, json, readJson } from "./http";
import { audit } from "./repository";
import type { AppEnv, Permissions, SessionUser } from "./types";

interface ManagedUserRow {
  id: string;
  name: string;
  email: string;
  role: SessionUser["role"];
  active: number;
  canChat: number;
  canLeads: number;
  canClients: number;
  canSettings: number;
  emailVerified: number;
  avatarKey: string | null;
  instagram: string | null;
  professionalRole: string | null;
  online?: number;
  lastSeenAt?: string | null;
  createdAt: string;
}

const userSelect = `SELECT id, name, email, role, active, can_chat AS canChat, can_leads AS canLeads,
  can_clients AS canClients, can_settings AS canSettings, email_verified AS emailVerified, avatar_key AS avatarKey,
  instagram, professional_role AS professionalRole, created_at AS createdAt FROM users`;

function managedUser(row: ManagedUserRow) {
  const elevated = row.role === "admin";
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: Boolean(row.active),
    emailVerified: Boolean(row.emailVerified),
    avatarUrl: row.avatarKey ? `/api/settings/users/${row.id}/avatar` : null,
    instagram: row.instagram,
    professionalRole: row.professionalRole,
    online: Boolean(row.online),
    lastSeenAt: row.lastSeenAt ?? null,
    createdAt: row.createdAt,
    permissions: {
      chat: elevated || Boolean(row.canChat),
      leads: elevated || Boolean(row.canLeads),
      clients: elevated || Boolean(row.canClients),
      settings: elevated || Boolean(row.canSettings),
    },
  };
}

function permissions(value: unknown): Permissions {
  const input = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    chat: input.chat === true,
    leads: input.leads === true,
    clients: input.clients === true,
    settings: input.settings === true,
  };
}

export async function listUsers(env: AppEnv): Promise<Response> {
  const onlineSince = new Date(Date.now() - 6 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(`SELECT u.id, u.name, u.email, u.role, u.active, u.can_chat AS canChat,
    u.can_leads AS canLeads, u.can_clients AS canClients, u.can_settings AS canSettings,
    u.email_verified AS emailVerified, u.avatar_key AS avatarKey, u.instagram, u.professional_role AS professionalRole, u.created_at AS createdAt,
    MAX(s.last_seen_at) AS lastSeenAt,
    MAX(CASE WHEN s.last_seen_at > ?1 AND s.expires_at > ?2 THEN 1 ELSE 0 END) AS online
    FROM users u LEFT JOIN sessions s ON s.user_id = u.id
    GROUP BY u.id ORDER BY u.role = 'admin' DESC, u.name COLLATE NOCASE`)
    .bind(onlineSince, new Date().toISOString()).all<ManagedUserRow>();
  return json({ users: result.results.map(managedUser) });
}

function normalizedInstagram(value: unknown): string {
  let profile = cleanText(value, 160, true)!;
  profile = profile.replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "").replace(/^@/, "").split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9._]{1,30}$/.test(profile)) throw new HttpError("Informe um perfil válido do Instagram.", 422);
  return `@${profile}`;
}

const professionalAccess = {
  advogado: { label: "Advogado", chat: true, leads: true, clients: true },
  advogada: { label: "Advogada", chat: true, leads: true, clients: true },
  estagiario: { label: "Estagiário", chat: true, leads: true, clients: false },
  secretaria: { label: "Secretaria", chat: false, leads: true, clients: true },
  atendente_chat: { label: "Atendente de chat", chat: true, leads: false, clients: false },
} as const;

function professionalRole(value: unknown) {
  const key = String(value ?? "") as keyof typeof professionalAccess;
  const access = professionalAccess[key];
  if (!access) throw new HttpError("Selecione sua função profissional.", 422);
  return access;
}

export async function registerUser(request: Request, env: AppEnv): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new HttpError("O envio de confirmação está indisponível.", 503);
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > 4 * 1024 * 1024) throw new HttpError("O cadastro excede o limite de 4 MB.", 413);
  const form = await request.formData();
  const name = cleanText(form.get("name"), 120, true)!;
  const email = cleanText(form.get("email"), 180, true)!.toLowerCase();
  const instagram = normalizedInstagram(form.get("instagram"));
  const profession = professionalRole(form.get("professionalRole"));
  const avatar = form.get("avatar");
  if (!(avatar instanceof File) || avatar.size === 0) throw new HttpError("Selecione uma foto de perfil.", 422);
  if (avatar.size > 3 * 1024 * 1024) throw new HttpError("A foto deve ter no máximo 3 MB.", 413);
  const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  const extension = extensions[avatar.type];
  if (!extension) throw new HttpError("Use uma foto JPG, PNG ou WebP.", 422);
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1 OR instagram = ?2").bind(email, instagram).first<{ id: string }>();
  if (existing) throw new HttpError("E-mail ou Instagram já cadastrado.", 409);
  const password = await passwordRecord(form.get("password"));
  const id = crypto.randomUUID();
  const avatarKey = `users/${id}/avatar.${extension}`;
  await env.MEDIA.put(avatarKey, avatar.stream(), { httpMetadata: { contentType: avatar.type } });
  try {
    await env.DB.prepare(`INSERT INTO users
      (id, name, email, password_hash, password_salt, password_iterations, role, active, email_verified,
       can_chat, can_leads, can_clients, can_settings, avatar_key, instagram, professional_role, registration_source)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'attendant', 0, 0, ?7, ?8, ?9, 0, ?10, ?11, ?12, 'self')`)
      .bind(id, name, email, password.hash, password.salt, password.iterations, Number(profession.chat), Number(profession.leads), Number(profession.clients), avatarKey, instagram, profession.label).run();
    await sendAccessCode(request, env, id, name, email, false);
  } catch (reason) {
    await Promise.all([
      env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(id).run(),
      env.MEDIA.delete(avatarKey),
    ]);
    throw reason;
  }
  return json({ email }, { status: 201 });
}

export async function createUser(request: Request, env: AppEnv, actor: SessionUser): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new HttpError("Configure RESEND_API_KEY e EMAIL_FROM antes de convidar usuários.", 503);
  const input = await readJson<{ name?: unknown; email?: unknown; permissions?: unknown }>(request);
  const name = cleanText(input.name, 120, true)!;
  const email = cleanText(input.email, 180, true)!.toLowerCase();
  const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?1").bind(email).first<{ id: string }>();
  if (existing) throw new HttpError("Já existe um usuário com este e-mail.", 409);
  const temporarySecret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const password = await passwordRecord(temporarySecret);
  const access = permissions(input.permissions);
  if (!access.chat && !access.leads && !access.clients && !access.settings) throw new HttpError("Selecione pelo menos um acesso.", 422);
  const id = crypto.randomUUID();
  await env.DB.prepare(`INSERT INTO users
    (id, name, email, password_hash, password_salt, password_iterations, role, can_chat, can_leads, can_clients, can_settings, email_verified)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'attendant', ?7, ?8, ?9, ?10, 0)`)
    .bind(id, name, email, password.hash, password.salt, password.iterations, Number(access.chat), Number(access.leads), Number(access.clients), Number(access.settings)).run();
  try {
    await sendAccessCode(request, env, id, name, email, true);
  } catch (reason) {
    await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(id).run();
    throw reason;
  }
  await audit(env, actor, "user.create", "user", id, { permissions: access });
  const row = await env.DB.prepare(`${userSelect} WHERE id = ?1`).bind(id).first<ManagedUserRow>();
  if (!row) throw new HttpError("Não foi possível carregar o usuário criado.", 500);
  return json({ user: managedUser(row) }, { status: 201 });
}

export async function updateUserAccess(request: Request, env: AppEnv, actor: SessionUser, userId: string): Promise<Response> {
  const target = await env.DB.prepare("SELECT role FROM users WHERE id = ?1").bind(userId).first<{ role: SessionUser["role"] }>();
  if (!target) throw new HttpError("Usuário não encontrado.", 404);
  if (target.role === "admin") throw new HttpError("O administrador mestre sempre possui acesso total.", 422);
  const input = await readJson<{ active?: unknown; permissions?: unknown }>(request);
  const access = permissions(input.permissions);
  const active = input.active === true;
  if (active && !access.chat && !access.leads && !access.clients && !access.settings) throw new HttpError("Selecione pelo menos um acesso.", 422);
  await env.DB.batch([
    env.DB.prepare(`UPDATE users SET active = ?1, can_chat = ?2, can_leads = ?3, can_clients = ?4,
      can_settings = ?5, updated_at = ?6 WHERE id = ?7`)
      .bind(Number(active), Number(access.chat), Number(access.leads), Number(access.clients), Number(access.settings), new Date().toISOString(), userId),
    ...(active ? [] : [env.DB.prepare("DELETE FROM sessions WHERE user_id = ?1").bind(userId)]),
  ]);
  await audit(env, actor, "user.access.update", "user", userId, { active, permissions: access });
  return json({ ok: true });
}

export async function deleteUser(env: AppEnv, actor: SessionUser, userId: string): Promise<Response> {
  if (userId === actor.id) throw new HttpError("Você não pode excluir sua própria conta.", 422);
  const target = await env.DB.prepare("SELECT role, avatar_key AS avatarKey FROM users WHERE id = ?1").bind(userId).first<{ role: SessionUser["role"]; avatarKey: string | null }>();
  if (!target) throw new HttpError("Usuário não encontrado.", 404);
  if (target.role === "admin") throw new HttpError("O administrador mestre não pode ser excluído.", 422);
  await audit(env, actor, "user.delete", "user", userId);
  await env.DB.prepare("DELETE FROM users WHERE id = ?1").bind(userId).run();
  if (target.avatarKey) await env.MEDIA.delete(target.avatarKey);
  return json({ ok: true });
}

export async function getUserAvatar(env: AppEnv, userId: string): Promise<Response> {
  const target = await env.DB.prepare("SELECT avatar_key AS avatarKey FROM users WHERE id = ?1").bind(userId).first<{ avatarKey: string | null }>();
  if (!target?.avatarKey) throw new HttpError("Foto não encontrada.", 404);
  const object = await env.MEDIA.get(target.avatarKey);
  if (!object) throw new HttpError("Foto não encontrada.", 404);
  const headers = new Headers({ "Cache-Control": "private, max-age=300", ETag: object.httpEtag, "Content-Disposition": "inline" });
  object.writeHttpMetadata(headers);
  return new Response(object.body, { headers });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]!);
}

function accessCode(): string {
  const limit = 4_290_000_000;
  let value = limit;
  while (value >= limit) value = crypto.getRandomValues(new Uint32Array(1))[0];
  return String(value % 1_000_000).padStart(6, "0");
}

async function deliverEmail(env: AppEnv, idempotencyKey: string, to: string, subject: string, html: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "User-Agent": "Karrer-Atendimento/1.0",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html }),
  });
  if (!response.ok) throw new HttpError("O provedor de e-mail recusou o envio.", 502);
  await response.body?.cancel();
}

async function sendAccessCode(request: Request, env: AppEnv, userId: string, name: string, email: string, requiresPassword: boolean): Promise<void> {
  const code = accessCode();
  const codeId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const origin = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const activationUrl = `${origin}/?activate=${encodeURIComponent(email)}${requiresPassword ? "&invite=1" : ""}`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_access_codes WHERE user_id = ?1 AND used_at IS NULL").bind(userId),
    env.DB.prepare("INSERT INTO user_access_codes (id, user_id, code_hash, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(codeId, userId, await digest(code), expiresAt),
  ]);
  await deliverEmail(env, codeId, email, "Seu código de acesso — Karrer Atendimento",
    `<div style="font-family:Arial,sans-serif;color:#252525"><h2>Karrer &amp; Advogados</h2><p>Olá, ${escapeHtml(name)}.</p><p>${requiresPassword ? "Confirme seu e-mail e crie sua senha" : "Confirme seu e-mail"} usando este código:</p><p style="font-size:30px;font-weight:700;letter-spacing:6px">${code}</p><p><a href="${escapeHtml(activationUrl)}" style="background:#252525;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Confirmar meu acesso</a></p><p>O código expira em 30 minutos.</p></div>`);
}

export async function sendPasswordReset(request: Request, env: AppEnv, actor: SessionUser, userId: string): Promise<Response> {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new HttpError("Configure RESEND_API_KEY e EMAIL_FROM para enviar e-mails.", 503);
  const target = await env.DB.prepare("SELECT name, email FROM users WHERE id = ?1 AND active = 1")
    .bind(userId).first<{ name: string; email: string }>();
  if (!target) throw new HttpError("Usuário ativo não encontrado.", 404);
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  const tokenHash = await digest(token);
  const resetId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  const origin = (env.APP_BASE_URL || new URL(request.url).origin).replace(/\/$/, "");
  const resetUrl = `${origin}/?reset=${encodeURIComponent(token)}`;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?1 AND used_at IS NULL").bind(userId),
    env.DB.prepare("INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(resetId, userId, tokenHash, expiresAt),
  ]);
  try {
    await deliverEmail(env, resetId, target.email, "Redefinição de senha — Karrer Atendimento",
      `<div style="font-family:Arial,sans-serif;color:#252525"><h2>Karrer &amp; Advogados</h2><p>Olá, ${escapeHtml(target.name)}.</p><p>Use o botão abaixo para criar uma nova senha. O link expira em 30 minutos.</p><p><a href="${escapeHtml(resetUrl)}" style="background:#252525;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none">Redefinir senha</a></p><p>Se você não solicitou esta alteração, ignore este e-mail.</p></div>`);
  } catch (reason) {
    await env.DB.prepare("DELETE FROM password_reset_tokens WHERE id = ?1").bind(resetId).run();
    throw reason;
  }
  await audit(env, actor, "user.password_reset.send", "user", userId);
  return json({ ok: true });
}
