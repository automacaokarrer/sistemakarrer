import { activateUser, authStatus, bootstrap, changePassword, login, logout, requireAdmin, requireAnyPermission, requirePermission, requireUser, resetPassword, touchPresence } from "./auth";
export { ChatRoom } from "./chat-room";
import { HttpError, error, json, routeMatch } from "./http";
import {
  addNote,
  createContact,
  updateContact,
  getContactAvatar,
  getMedia,
  leadSummary,
  listContacts,
  listConversations,
  listMessages,
  markConversationRead,
  updateConversationAssignee,
  updateConversationStatus,
  sendMessage,
  sendMediaMessage,
  updateClassification,
  uploadMedia,
} from "./repository";
import type { AppEnv } from "./types";
import { handleZApiWebhook } from "./webhook";
import { createUser, deleteUser, getUserAvatar, listLeadAttendants, listUsers, registerUser, sendPasswordReset, updateUserAccess } from "./settings";
import { uploadContactDocuments } from "./drive";
import { INBOX_ROOM } from "./realtime";

function withCookie(payload: unknown, cookie: string, status = 200): Response {
  return json(payload, { status, headers: { "Set-Cookie": cookie } });
}

async function routeApi(request: Request, env: AppEnv): Promise<Response> {
  const url = new URL(request.url);
  const { pathname } = url;
  const method = request.method.toUpperCase();

  if (method === "GET" && pathname === "/api/health") {
    return json({ ok: true, app: env.APP_NAME, environment: env.ENVIRONMENT });
  }
  if (method === "GET" && pathname === "/api/auth/status") return json(await authStatus(request, env));
  if (method === "POST" && pathname === "/api/auth/bootstrap") {
    const result = await bootstrap(request, env);
    return withCookie({ user: result.user }, result.cookie, 201);
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const result = await login(request, env);
    return withCookie({ user: result.user }, result.cookie);
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    return withCookie({ ok: true }, await logout(request, env));
  }
  if (method === "POST" && pathname === "/api/auth/reset-password") {
    await resetPassword(request, env);
    return json({ ok: true });
  }
  if (method === "POST" && pathname === "/api/auth/activate") {
    await activateUser(request, env);
    return json({ ok: true });
  }
  if (method === "POST" && pathname === "/api/auth/register") return registerUser(request, env);

  const webhook = routeMatch(pathname, /^\/api\/webhooks\/zapi\/([^/]+)$/);
  if (method === "POST" && webhook) return handleZApiWebhook(request, env, decodeURIComponent(webhook[1]));

  const user = await requireUser(request, env);
  if (method === "POST" && pathname === "/api/auth/presence") {
    await touchPresence(request, env, user);
    return json({ ok: true });
  }
  if (method === "GET" && pathname === "/api/account/avatar") return getUserAvatar(env, user.id);
  if (method === "POST" && pathname === "/api/settings/change-password") {
    await changePassword(request, env, user);
    return json({ ok: true });
  }
  if (method === "GET" && pathname === "/api/settings/users") {
    requireAdmin(user);
    return listUsers(env);
  }
  if (method === "POST" && pathname === "/api/settings/users") {
    requireAdmin(user);
    return createUser(request, env, user);
  }
  if (method === "GET" && pathname === "/api/conversations") {
    requireAnyPermission(user, ["chat", "leads"]);
    return listConversations(env, url);
  }
  if (method === "GET" && pathname === "/api/leads/summary") {
    requirePermission(user, "leads");
    return leadSummary(env);
  }
  if (method === "GET" && pathname === "/api/leads/attendants") {
    requirePermission(user, "leads");
    return listLeadAttendants(env);
  }
  if (method === "GET" && pathname === "/api/contacts") {
    requirePermission(user, "clients");
    return listContacts(env);
  }
  if (method === "POST" && pathname === "/api/contacts") {
    requirePermission(user, "clients");
    return createContact(request, env, user);
  }
  const contactEdit = routeMatch(pathname, /^\/api\/contacts\/([^/]+)$/);
  if (method === "PATCH" && contactEdit) {
    requirePermission(user, "clients");
    return updateContact(request, env, user, contactEdit[1]);
  }
  if (method === "POST" && pathname === "/api/media") {
    requireAnyPermission(user, ["chat", "clients"]);
    return uploadMedia(request, env, user, url);
  }

  const media = routeMatch(pathname, /^\/api\/media\/(.+)$/);
  if (method === "GET" && media) {
    requireAnyPermission(user, ["chat", "clients"]);
    return getMedia(env, decodeURIComponent(media[1]));
  }

  const contactDocuments = routeMatch(pathname, /^\/api\/contacts\/([^/]+)\/documents$/);
  if (method === "POST" && contactDocuments) {
    requirePermission(user, "clients");
    return uploadContactDocuments(request, env, user, contactDocuments[1]);
  }

  const contactAvatar = routeMatch(pathname, /^\/api\/contacts\/([^/]+)\/avatar$/);
  if (method === "GET" && contactAvatar) {
    requireAnyPermission(user, ["chat", "leads", "clients"]);
    return getContactAvatar(env, contactAvatar[1]);
  }

  const messages = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/messages$/);
  if (messages && method === "GET") {
    requireAnyPermission(user, ["chat", "leads"]);
    return listMessages(env, messages[1], url);
  }
  if (messages && method === "POST") {
    requirePermission(user, "chat");
    return sendMessage(request, env, user, messages[1]);
  }

  const conversationMedia = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/media$/);
  if (conversationMedia && method === "POST") {
    requirePermission(user, "chat");
    return sendMediaMessage(request, env, user, conversationMedia[1]);
  }

  const conversationRead = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/read$/);
  if (conversationRead && method === "POST") {
    requirePermission(user, "chat");
    return markConversationRead(env, user, conversationRead[1]);
  }

  const conversationAssignee = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/assignee$/);
  if (conversationAssignee && method === "PATCH") {
    requireAdmin(user);
    return updateConversationAssignee(request, env, user, conversationAssignee[1]);
  }

  const conversationStatus = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/status$/);
  if (conversationStatus && method === "PATCH") {
    requirePermission(user, "chat");
    return updateConversationStatus(request, env, user, conversationStatus[1]);
  }

  if (method === "GET" && pathname === "/api/conversations/ws") {
    requireAnyPermission(user, ["chat", "leads"]);
    return env.CHAT_ROOMS.getByName(INBOX_ROOM).fetch(request);
  }

  const websocket = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/ws$/);
  if (method === "GET" && websocket) {
    requirePermission(user, "chat");
    return env.CHAT_ROOMS.getByName(websocket[1]).fetch(request);
  }

  const lead = routeMatch(pathname, /^\/api\/leads\/([^/]+)\/classification$/);
  if (method === "PATCH" && lead) {
    requirePermission(user, "leads");
    return updateClassification(request, env, user, lead[1]);
  }

  const notes = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/notes$/);
  if (method === "POST" && notes) {
    requirePermission(user, "leads");
    return addNote(request, env, user, notes[1]);
  }

  const userAccess = routeMatch(pathname, /^\/api\/settings\/users\/([^/]+)\/access$/);
  if (method === "PATCH" && userAccess) {
    requireAdmin(user);
    return updateUserAccess(request, env, user, userAccess[1]);
  }
  const userAvatar = routeMatch(pathname, /^\/api\/settings\/users\/([^/]+)\/avatar$/);
  if (method === "GET" && userAvatar) {
    requireAnyPermission(user, ["leads", "settings"]);
    return getUserAvatar(env, userAvatar[1]);
  }
  const userReset = routeMatch(pathname, /^\/api\/settings\/users\/([^/]+)\/send-password-reset$/);
  if (method === "POST" && userReset) {
    requireAdmin(user);
    return sendPasswordReset(request, env, user, userReset[1]);
  }
  const managedUser = routeMatch(pathname, /^\/api\/settings\/users\/([^/]+)$/);
  if (method === "DELETE" && managedUser) {
    requireAdmin(user);
    return deleteUser(env, user, managedUser[1]);
  }

  return error("Rota não encontrada.", 404);
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await routeApi(request, env);
    } catch (reason) {
      if (reason instanceof HttpError) return error(reason.message, reason.status);
      console.error(JSON.stringify({ event: "request.failed", path: new URL(request.url).pathname, reason }));
      return error("Erro interno do servidor.", 500);
    }
  },
} satisfies ExportedHandler<AppEnv>;
