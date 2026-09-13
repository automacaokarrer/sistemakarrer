import { HttpError, json, readJson } from "./http";
import { LunaServiceError, runLunaAgent } from "./luna-agent-service";
import { assertLunaScope, findCachedAnalysis, getAuthorizedFile, saveAnalysis } from "./luna-memory";
import { recordLunaRun } from "./luna-observability";
import { lunaInputTypes, type LunaInputType, type LunaRequestInput, type ValidatedLunaRequest } from "./luna-types";
import { audit } from "./repository";
import type { AppEnv, SessionUser } from "./types";

function identifier(value: unknown, name: string, required = true): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  if (required && !result) throw new HttpError(`${name} é obrigatório.`, 422);
  if (result.length > 100 || /[\u0000-\u001f]/.test(result)) throw new HttpError(`${name} inválido.`, 422);
  return result || null;
}

export function validateLunaRequest(input: LunaRequestInput): ValidatedLunaRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError("Entrada da Luna inválida.", 422);
  const clientId = identifier(input.clientId, "clientId")!;
  const caseId = identifier(input.caseId, "caseId", false);
  const explicitConversation = identifier(input.conversationId, "conversationId", false);
  if (caseId && explicitConversation && caseId !== explicitConversation) throw new HttpError("caseId e conversationId devem identificar o mesmo atendimento.", 422);
  const inputType = typeof input.inputType === "string" ? input.inputType : "";
  if (!lunaInputTypes.includes(inputType as LunaInputType)) throw new HttpError("inputType inválido.", 422);
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (text.length > 12_000) throw new HttpError("O texto excede o limite de 12.000 caracteres.", 413);
  const fileKey = typeof input.fileKey === "string" ? input.fileKey.trim() : "";
  if (fileKey.length > 500 || /[\u0000-\u001f\\]/.test(fileKey) || fileKey.split("/").includes("..")) throw new HttpError("fileKey inválido.", 422);
  if (inputType === "text" && !text) throw new HttpError("text é obrigatório para entrada de texto.", 422);
  if (inputType !== "text" && !fileKey) throw new HttpError("fileKey é obrigatório para análise de arquivo.", 422);
  if (input.metadata != null && (!input.metadata || typeof input.metadata !== "object" || Array.isArray(input.metadata))) throw new HttpError("metadata deve ser um objeto.", 422);
  const metadata = (input.metadata ?? {}) as Record<string, unknown>;
  if (JSON.stringify(metadata).length > 4_000) throw new HttpError("metadata excede o limite permitido.", 413);
  return { clientId, conversationId: explicitConversation ?? caseId, inputType: inputType as LunaInputType, text, fileKey: fileKey || null, metadata };
}

export async function handleLunaRequest(request: Request, env: AppEnv, user: SessionUser): Promise<Response> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  let input: ValidatedLunaRequest | null = null;
  try {
    input = validateLunaRequest(await readJson<LunaRequestInput>(request, 20_000));
    if (!user.permissions.clients && !input.conversationId) throw new HttpError("Informe um atendimento autorizado para analisar este cliente.", 403);
    await assertLunaScope(env, input.clientId, input.conversationId);
    let cached = null;
    if (input.fileKey) {
      const { object, hash } = await getAuthorizedFile(env, input);
      cached = await findCachedAnalysis(env, input.clientId, input.fileKey, hash);
      if (cached) {
        await object.body.cancel();
        await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: user.id, status: "cached", durationMs: Date.now() - startedAt });
        console.log(JSON.stringify({ event: "luna.completed", requestId, clientId: input.clientId, inputType: input.inputType,
          status: "cached", durationMs: Date.now() - startedAt, toolCalls: 0 }));
        return json({ success: true, requestId, cached: true, data: cached });
      }
      await object.body.cancel();
    }
    const result = await runLunaAgent(env, user, input, requestId);
    await saveAnalysis(env, user, input, result.analysis, result.fileHash);
    await audit(env, user, "luna.analysis", "contact", input.clientId, { requestId, inputType: input.inputType,
      conversationId: input.conversationId, status: result.analysis.status, confidence: result.analysis.confidence });
    await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: user.id, status: "completed", model: result.model,
      durationMs: Date.now() - startedAt, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens,
      cachedInputTokens: result.usage.cachedInputTokens, totalTokens: result.usage.totalTokens, toolCalls: result.toolCalls });
    console.log(JSON.stringify({ event: "luna.completed", requestId, clientId: input.clientId, inputType: input.inputType,
      status: result.analysis.status, durationMs: Date.now() - startedAt, model: result.model, toolCalls: result.toolCalls,
      inputTokens: result.usage.inputTokens, cachedInputTokens: result.usage.cachedInputTokens,
      outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens }));
    return json({ success: true, requestId, cached: false, data: result.analysis });
  } catch (reason) {
    const serviceError = reason instanceof LunaServiceError ? reason : reason instanceof HttpError
      ? new LunaServiceError("AI_INVALID_INPUT", reason.message, reason.status)
      : new LunaServiceError("AI_TEMPORARILY_UNAVAILABLE", "Não foi possível concluir a análise neste momento.", 503);
    if (input) await recordLunaRun(env, { id: crypto.randomUUID(), requestId, input, userId: user.id, status: "failed",
      errorCode: serviceError.code, durationMs: Date.now() - startedAt });
    console.error(JSON.stringify({ event: "luna.failed", requestId, clientId: input?.clientId ?? null,
      inputType: input?.inputType ?? null, durationMs: Date.now() - startedAt, code: serviceError.code }));
    return json({ success: false, requestId, code: serviceError.code, message: serviceError.message }, { status: serviceError.status });
  }
}
