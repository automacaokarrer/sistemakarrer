import { beforeEach, describe, expect, it, vi } from "vitest";
import { processAutonomousReply } from "./luna-autonomous";
import { runLunaAgent } from "./luna-agent-service";
import { saveAnalysis } from "./luna-memory";
import { recordLunaRun } from "./luna-observability";
import type { PassiveMessage } from "./luna-passive";
import { sendText } from "./zapi";

vi.mock("./luna-agent-service", () => ({
  LunaServiceError: class LunaServiceError extends Error {
    constructor(readonly code: string, message: string) { super(message); }
  },
  runLunaAgent: vi.fn(),
}));
vi.mock("./luna-memory", () => ({ saveAnalysis: vi.fn() }));
vi.mock("./luna-observability", () => ({ recordLunaRun: vi.fn() }));
vi.mock("./zapi", () => ({ sendText: vi.fn() }));

const message: PassiveMessage = {
  id: "inbound-1", conversationId: "conversation-1", direction: "inbound", type: "text",
  body: "Olá", mediaKey: null, fileName: null, mime: null, createdAt: "2026-09-14T12:00:00.000Z",
};

function createEnv(options: { assigneeId?: string | null; claimChanges?: number; latestMessageId?: string; review?: boolean } = {}) {
  const broadcasts: unknown[] = [];
  const batches: unknown[][] = [];
  const statusUpdates: unknown[][] = [];
  const prepare = vi.fn((sql: string) => ({
    bind: (...values: unknown[]) => ({
      first: async () => {
        if (sql.includes("c.contact_id AS contactId")) return { contactId: "client-1", phone: "5592999990000",
          assigneeId: options.assigneeId ?? null, serviceStatus: "new" };
        if (sql.includes("COUNT(*) AS count")) return { count: 0 };
        if (sql.includes("latestMessageId")) return { assigneeId: options.assigneeId ?? null, serviceStatus: "new",
          latestMessageId: options.latestMessageId ?? message.id };
        return null;
      },
      all: async () => ({ results: [{ direction: "inbound", type: "text", body: "Olá", fileName: null, createdAt: message.createdAt }] }),
      run: async () => {
        if (sql.includes("INSERT INTO luna_autonomous_replies")) return { meta: { changes: options.claimChanges ?? 1 } };
        if (sql.includes("UPDATE luna_autonomous_replies SET status")) statusUpdates.push(values);
        return { meta: { changes: 1 } };
      },
    }),
  }));
  const env = {
    LUNA_AUTONOMOUS_ENABLED: "true", OPENAI_API_KEY: "test-key", OPENAI_LUNA_AGENT_ID: "agent-test", ENVIRONMENT: "development",
    DB: { prepare, batch: vi.fn(async (statements: unknown[]) => { batches.push(statements); return []; }) },
    CHAT_ROOMS: { getByName: vi.fn(() => ({ broadcast: async (event: unknown) => { broadcasts.push(event); } })) },
  } as never;
  vi.mocked(runLunaAgent).mockResolvedValue({
    analysis: { status: "APPROVED", contentType: "text", documentType: null, summary: "Saudação inicial.", extractedData: {},
      problems: [], pendingItems: [], memoryUpdates: [], requiresHumanReview: options.review ?? false, confidence: 0.95,
      replyToClient: options.review ? null : "Olá! Sou a Luna, assistente virtual da Karrer." },
    model: "test-model", usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, totalTokens: 15 }, toolCalls: 0, fileHash: "",
  });
  return { env, batches, broadcasts, statusUpdates };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(saveAnalysis).mockResolvedValue(null);
  vi.mocked(recordLunaRun).mockResolvedValue(undefined);
  vi.mocked(sendText).mockResolvedValue("provider-1");
});

describe("orquestração do atendimento autônomo", () => {
  it("não processa conversa que um atendente já assumiu", async () => {
    const { env } = createEnv({ assigneeId: "user-1" });
    await processAutonomousReply(env, message);
    expect(runLunaAgent).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("deduplica a mesma mensagem antes de chamar a Luna", async () => {
    const { env } = createEnv({ claimChanges: 0 });
    await processAutonomousReply(env, message);
    expect(runLunaAgent).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("mantém o atendimento para revisão humana sem enviar resposta", async () => {
    const { env, statusUpdates } = createEnv({ review: true });
    await processAutonomousReply(env, message);
    expect(runLunaAgent).toHaveBeenCalledOnce();
    expect(sendText).not.toHaveBeenCalled();
    expect(statusUpdates).toContainEqual(["skipped", "AI_HUMAN_REVIEW_REQUIRED", message.id]);
  });

  it("envia, persiste e publica uma resposta segura", async () => {
    const { env, batches, broadcasts } = createEnv();
    await processAutonomousReply(env, message);
    expect(sendText).toHaveBeenCalledWith(env, "5592999990000", "Olá! Sou a Luna, assistente virtual da Karrer.");
    expect(batches).toHaveLength(1);
    expect(broadcasts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message.new" }),
      expect.objectContaining({ type: "conversation.updated", conversationId: "conversation-1" }),
    ]));
  });
});
