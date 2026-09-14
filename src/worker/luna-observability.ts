import type { ValidatedLunaRequest } from "./luna-types";
import type { AppEnv } from "./types";

export async function recordLunaRun(env: AppEnv, values: {
  id: string;
  requestId: string;
  input: ValidatedLunaRequest;
  userId: string | null;
  status: "completed" | "failed" | "cached";
  model?: string | null;
  errorCode?: string | null;
  durationMs: number;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  toolCalls?: number;
}): Promise<void> {
  try {
    await env.DB.prepare(`INSERT INTO luna_runs
      (id, request_id, contact_id, conversation_id, user_id, input_type, file_key, agent_id, model, status, error_code,
       duration_ms, input_tokens, cached_input_tokens, output_tokens, total_tokens, tool_calls)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)`)
      .bind(values.id, values.requestId, values.input.clientId, values.input.conversationId, values.userId, values.input.inputType,
        values.input.fileKey, env.OPENAI_LUNA_AGENT_ID ?? null, values.model ?? null, values.status, values.errorCode ?? null,
        values.durationMs, values.inputTokens ?? 0, values.cachedInputTokens ?? 0, values.outputTokens ?? 0,
        values.totalTokens ?? 0, values.toolCalls ?? 0).run();
  } catch (reason) {
    console.error(JSON.stringify({ event: "luna.metrics.failed", requestId: values.requestId, clientId: values.input.clientId,
      reason: reason instanceof Error ? reason.name : "unknown" }));
  }
}
