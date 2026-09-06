export type Classification = "hot" | "warm" | "cold";

export interface User {
  id: string;
  name: string;
  email: string;
  role: "admin" | "manager" | "attendant";
  permissions: Permissions;
}

export interface Permissions {
  chat: boolean;
  leads: boolean;
  clients: boolean;
  settings: boolean;
}

export interface ManagedUser extends User {
  active: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthStatus {
  setupRequired: boolean;
  user: User | null;
}

export interface Conversation {
  id: string;
  contactId: string;
  name: string;
  phone: string;
  bank: string | null;
  stage: string;
  classification: Classification;
  score: number;
  lastMessage: string | null;
  lastMessageType: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
  online: boolean;
  lastSeenAt: string | null;
  assigneeName: string | null;
}

export interface Message {
  id: string;
  conversationId: string;
  direction: "inbound" | "outbound";
  type: "text" | "image" | "audio" | "video" | "document";
  body: string | null;
  fileName: string | null;
  mediaKey: string | null;
  duration: number | null;
  status: "sending" | "sent" | "delivered" | "read" | "received" | "failed";
  createdAt: string;
}

export interface Contact {
  id: string;
  phone: string;
  name: string | null;
  cpf: string | null;
  rg: string | null;
  rgIssuer: string | null;
  birthDate: string | null;
  email: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  bank: string | null;
  ccb: string | null;
  profileComplete: boolean;
  createdAt: string;
}

export interface LeadSummary {
  total: number;
  hot: number;
  warm: number;
  cold: number;
  averageFirstResponseMinutes: number;
  daily: Array<{ day: string; total: number }>;
}
