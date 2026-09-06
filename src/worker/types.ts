export interface SecretBindings {
  BOOTSTRAP_ADMIN_TOKEN?: string;
  ZAPI_INSTANCE_ID?: string;
  ZAPI_INSTANCE_TOKEN?: string;
  ZAPI_CLIENT_TOKEN?: string;
  ZAPI_WEBHOOK_TOKEN?: string;
}

export interface AppEnv extends SecretBindings {
  DB: D1Database;
  MEDIA: R2Bucket;
  CHAT_ROOMS: DurableObjectNamespace<import("./chat-room").ChatRoom>;
  ASSETS: Fetcher;
  APP_NAME: string;
  ENVIRONMENT: string;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "attendant";
}

export interface ZApiPayload {
  type?: string;
  instanceId?: string;
  messageId?: string;
  phone?: string;
  fromMe?: boolean;
  isGroup?: boolean;
  isNewsletter?: boolean;
  momment?: number;
  senderName?: string;
  chatName?: string;
  text?: { message?: string };
  image?: { imageUrl?: string; thumbnailUrl?: string; caption?: string; mimeType?: string };
  audio?: { audioUrl?: string; seconds?: number; mimeType?: string };
  video?: { videoUrl?: string; caption?: string; mimeType?: string };
  document?: { documentUrl?: string; fileName?: string; mimeType?: string; pageCount?: number };
  status?: string;
}
