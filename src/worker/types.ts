export interface SecretBindings {
  BOOTSTRAP_ADMIN_TOKEN?: string;
  ZAPI_INSTANCE_ID?: string;
  ZAPI_INSTANCE_TOKEN?: string;
  ZAPI_CLIENT_TOKEN?: string;
  ZAPI_WEBHOOK_TOKEN?: string;
  RESEND_API_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_LUNA_AGENT_ID?: string;
  OPENAI_TRANSCRIPTION_MODEL?: string;
  EMAIL_FROM?: string;
  APP_BASE_URL?: string;
  GOOGLE_SERVICE_ACCOUNT_EMAIL?: string;
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  GOOGLE_DRIVE_FOLDER_ID?: string;
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
  avatarUrl: string | null;
  professionalRole: string | null;
  permissions: Permissions;
}

export interface Permissions {
  chat: boolean;
  leads: boolean;
  clients: boolean;
  settings: boolean;
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
  lastSeen?: number | null;
  ids?: string[];
  error?: string;
}
