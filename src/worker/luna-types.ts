export const lunaStatuses = ["APPROVED", "INCOMPLETE", "UNREADABLE", "REVIEW_REQUIRED", "NOT_RELEVANT"] as const;
export const lunaInputTypes = ["text", "image", "pdf", "audio_transcription"] as const;

export type LunaStatus = typeof lunaStatuses[number];
export type LunaInputType = typeof lunaInputTypes[number];

export interface LunaRequestInput {
  clientId?: unknown;
  caseId?: unknown;
  conversationId?: unknown;
  inputType?: unknown;
  text?: unknown;
  fileKey?: unknown;
  metadata?: unknown;
}

export interface LunaAnalysis {
  status: LunaStatus;
  contentType: LunaInputType;
  documentType: string | null;
  summary: string;
  extractedData: Record<string, unknown>;
  problems: string[];
  pendingItems: string[];
  memoryUpdates: string[];
  requiresHumanReview: boolean;
  confidence: number;
}

export interface ValidatedLunaRequest {
  clientId: string;
  conversationId: string | null;
  inputType: LunaInputType;
  text: string | null;
  fileKey: string | null;
  metadata: Record<string, unknown>;
}

export interface LunaUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  toolCalls: number;
}

export interface LunaClientContext {
  client: { id: string; name: string | null; cpf: string | null; bank: string | null; profileComplete: boolean };
  case: { id: string; stage: string; status: string; classification: string } | null;
  documents: { received: string[]; pending: string[] };
  importantFacts: Array<{ category: string; content: string; importance: number }>;
  recentSummary: string | null;
}
