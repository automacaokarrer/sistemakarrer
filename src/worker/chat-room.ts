import { DurableObject } from "cloudflare:workers";
import type { AppEnv } from "./types";

export class ChatRoom extends DurableObject<AppEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket esperado", { status: 426 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.serializeAttachment({ connectedAt: Date.now() });
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(event: unknown): Promise<void> {
    const payload = JSON.stringify(event);
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.send(payload); } catch { socket.close(1011, "broadcast failed"); }
    }
  }

  async webSocketMessage(socket: WebSocket, message: ArrayBuffer | string): Promise<void> {
    if (typeof message !== "string") return;
    if (message === "ping") { socket.send("pong"); return; }
    // Application events are sent only by authenticated Worker routes.
    // Clients may send heartbeat pings, never arbitrary events to peers.
    if (message.length > 2_000) socket.close(1009, "message too large");
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    socket.close(code, reason);
  }
}
