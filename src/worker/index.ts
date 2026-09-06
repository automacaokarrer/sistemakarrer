import { authStatus, bootstrap, login, logout, requireUser } from "./auth";
export { ChatRoom } from "./chat-room";
import { HttpError, error, json, routeMatch } from "./http";
import {
  addNote,
  createContact,
  getMedia,
  leadSummary,
  listContacts,
  listConversations,
  listMessages,
  sendMessage,
  updateClassification,
  uploadMedia,
} from "./repository";
import type { AppEnv } from "./types";
import { handleZApiWebhook } from "./webhook";

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

  const webhook = routeMatch(pathname, /^\/api\/webhooks\/zapi\/([^/]+)$/);
  if (method === "POST" && webhook) return handleZApiWebhook(request, env, decodeURIComponent(webhook[1]));

  const user = await requireUser(request, env);
  if (method === "GET" && pathname === "/api/conversations") return listConversations(env, url);
  if (method === "GET" && pathname === "/api/leads/summary") return leadSummary(env);
  if (method === "GET" && pathname === "/api/contacts") return listContacts(env);
  if (method === "POST" && pathname === "/api/contacts") return createContact(request, env, user);
  if (method === "POST" && pathname === "/api/media") return uploadMedia(request, env, user, url);

  const media = routeMatch(pathname, /^\/api\/media\/(.+)$/);
  if (method === "GET" && media) return getMedia(env, decodeURIComponent(media[1]));

  const messages = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/messages$/);
  if (messages && method === "GET") return listMessages(env, messages[1], url);
  if (messages && method === "POST") return sendMessage(request, env, user, messages[1]);

  const websocket = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/ws$/);
  if (method === "GET" && websocket) return env.CHAT_ROOMS.getByName(websocket[1]).fetch(request);

  const lead = routeMatch(pathname, /^\/api\/leads\/([^/]+)\/classification$/);
  if (method === "PATCH" && lead) return updateClassification(request, env, user, lead[1]);

  const notes = routeMatch(pathname, /^\/api\/conversations\/([^/]+)\/notes$/);
  if (method === "POST" && notes) return addNote(request, env, user, notes[1]);

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
