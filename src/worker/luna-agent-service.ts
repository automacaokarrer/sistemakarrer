import OpenAI from "openai";
import type { Response, ResponseFunctionToolCall, ResponseInput, ResponseInputContent } from "openai/resources/responses/responses";
import { HttpError } from "./http";
import { getAuthorizedFile, getClientContext } from "./luna-memory";
import { executeLunaTool, toolsForLunaRequest } from "./luna-tools";
import { lunaInputTypes, lunaStatuses, type LunaAnalysis, type LunaInputType, type ValidatedLunaRequest } from "./luna-types";
import { transcribeAudio } from "./transcription-service";
import type { AppEnv, SessionUser } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOOL_ROUNDS = 4;

export class LunaServiceError extends Error {
  constructor(readonly code: string, message: string, readonly status = 502) { super(message); }
}

export interface LunaServiceResult {
  analysis: LunaAnalysis;
  model: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number };
  toolCalls: number;
  fileHash: string;
}

const analysisSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "contentType", "documentType", "summary", "extractedData", "problems", "pendingItems", "memoryUpdates", "requiresHumanReview", "confidence"],
  properties: {
    status: { type: "string", enum: [...lunaStatuses] },
    contentType: { type: "string", enum: [...lunaInputTypes] },
    documentType: { type: ["string", "null"], maxLength: 100 },
    summary: { type: "string", maxLength: 1500 },
    extractedData: { type: "object", additionalProperties: true },
    problems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20 },
    pendingItems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20 },
    memoryUpdates: { type: "array", items: { type: "string", maxLength: 800 }, maxItems: 12 },
    requiresHumanReview: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
};

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let encoded = "";
  // O tamanho é divisível por 3 para que blocos Base64 possam ser concatenados.
  const chunk = 0x6000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    encoded += btoa(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length))));
  }
  return encoded;
}

function stringArray(value: unknown, limit: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result = value.map((item) => typeof item === "string" ? item.trim() : "");
  return result.every((item) => item && item.length <= maxLength) ? result : null;
}

export function validateLunaAnalysis(value: unknown, expectedType: LunaInputType): LunaAnalysis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LunaServiceError("AI_INVALID_RESPONSE", "A Luna retornou uma resposta inválida.");
  const item = value as Record<string, unknown>;
  const problems = stringArray(item.problems, 20, 300);
  const pendingItems = stringArray(item.pendingItems, 20, 300);
  const memoryUpdates = stringArray(item.memoryUpdates, 12, 800);
  const confidence = Number(item.confidence);
  if (!lunaStatuses.includes(item.status as LunaAnalysis["status"]) || item.contentType !== expectedType ||
    (item.documentType !== null && (typeof item.documentType !== "string" || item.documentType.length > 100)) ||
    typeof item.summary !== "string" || !item.summary.trim() || item.summary.length > 1500 ||
    !item.extractedData || typeof item.extractedData !== "object" || Array.isArray(item.extractedData) ||
    !problems || !pendingItems || !memoryUpdates || typeof item.requiresHumanReview !== "boolean" ||
    !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new LunaServiceError("AI_INVALID_RESPONSE", "A Luna retornou uma resposta inválida.");
  }
  return {
    status: item.status as LunaAnalysis["status"], contentType: expectedType, documentType: item.documentType as string | null,
    summary: item.summary.trim(), extractedData: item.extractedData as Record<string, unknown>, problems, pendingItems, memoryUpdates,
    requiresHumanReview: item.requiresHumanReview || confidence < 0.7, confidence,
  };
}

function mimeAllowed(inputType: LunaInputType, mime: string): boolean {
  if (inputType === "image") return ["image/jpeg", "image/png", "image/webp"].includes(mime);
  if (inputType === "pdf") return mime === "application/pdf";
  if (inputType === "audio_transcription") return mime.startsWith("audio/");
  return false;
}

function responseCalls(response: Response): ResponseFunctionToolCall[] {
  return response.output.filter((item): item is ResponseFunctionToolCall => item.type === "function_call");
}

function mapOpenAIError(reason: unknown): LunaServiceError {
  if (reason instanceof LunaServiceError) return reason;
  if (reason instanceof HttpError) return new LunaServiceError("AI_INVALID_INPUT", reason.message, reason.status);
  if (reason instanceof OpenAI.APIError) {
    if (reason.status === 429) return new LunaServiceError("AI_RATE_LIMITED", "A Luna está temporariamente ocupada. Tente novamente em instantes.", 503);
    if (reason.status && reason.status >= 400 && reason.status < 500) return new LunaServiceError("AI_CONFIGURATION_ERROR", "Não foi possível usar a configuração atual da Luna.", 503);
  }
  if (reason instanceof Error && (reason.name === "AbortError" || reason.message.toLowerCase().includes("timeout"))) {
    return new LunaServiceError("AI_TIMEOUT", "A análise excedeu o tempo limite. Tente novamente.", 504);
  }
  return new LunaServiceError("AI_TEMPORARILY_UNAVAILABLE", "Não foi possível concluir a análise neste momento.", 503);
}

export async function runLunaAgent(env: AppEnv, user: Pick<SessionUser, "id">, input: ValidatedLunaRequest, requestId: string): Promise<LunaServiceResult> {
  if (!env.OPENAI_API_KEY || !env.OPENAI_LUNA_AGENT_ID) throw new LunaServiceError("AI_NOT_CONFIGURED", "A Luna ainda não foi configurada pelo administrador.", 503);
  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY, maxRetries: 1, timeout: 45_000 });
  try {
    const [agent, fullContext] = await Promise.all([
      client.beta.agents.retrieve(env.OPENAI_LUNA_AGENT_ID),
      getClientContext(env, input.clientId, input.conversationId),
    ]);
    const passive = input.metadata.mode === "human_passive_memory";
    const context = passive ? {
      ...fullContext,
      documents: { received: fullContext.documents.received.slice(0, 8), pending: fullContext.documents.pending.slice(0, 8) },
      importantFacts: fullContext.importantFacts.slice(0, 8),
    } : fullContext;
    const content: ResponseInputContent[] = [{
      type: "input_text",
      text: JSON.stringify({ request: { inputType: input.inputType, text: input.text, metadata: input.metadata }, context }),
    }];
    let fileHash = "";
    if (input.fileKey) {
      const { object, document, hash } = await getAuthorizedFile(env, input);
      fileHash = hash;
      if (!mimeAllowed(input.inputType, document.mime)) throw new HttpError("Tipo do arquivo incompatível com a análise solicitada.", 422);
      if (object.size > MAX_FILE_BYTES) throw new HttpError("O arquivo excede o limite de 10 MB para análise.", 413);
      if (input.inputType === "audio_transcription") {
        const transcript = await transcribeAudio(client, env, object, document.fileName, document.mime);
        content.push({ type: "input_text", text: `Transcrição do áudio:\n${transcript}` });
      } else {
        const dataUrl = `data:${document.mime};base64,${base64(await object.arrayBuffer())}`;
        if (input.inputType === "image") content.push({ type: "input_image", image_url: dataUrl, detail: "low" });
        else content.push({ type: "input_file", file_data: dataUrl, filename: document.fileName, detail: "low" });
      }
    }
    const passiveInstructions = passive
      ? " Você está em modo passivo porque um atendente humano conduz a conversa. Registre fatos, pendências e um resumo acumulado, mas jamais escreva uma mensagem para o cliente ou solicite o envio de resposta."
      : "";
    const instructions = `${agent.instructions ?? ""}\n\nVocê é Luna dentro do CRM Karrer. Use somente o contexto fornecido e as ferramentas autorizadas. Não invente dados. Retorne uma análise curta no schema exigido. A memória permanente pertence ao D1 do CRM; não solicite nem reproduza raciocínio interno.${passiveInstructions}`;
    const tools = toolsForLunaRequest(input);
    const common = {
      model: agent.model,
      instructions,
      tools,
      tool_choice: tools.length ? "auto" as const : "none" as const,
      parallel_tool_calls: false,
      max_output_tokens: passive && input.inputType === "text" ? 450 : input.inputType === "text" ? 700 : 900,
      reasoning: { effort: input.inputType === "text" ? "none" as const : "low" as const },
      store: false,
      text: { format: { type: "json_schema" as const, name: "luna_analysis", strict: false, schema: analysisSchema }, verbosity: "low" as const },
      metadata: { integration: "karrer-luna", request_id: requestId },
      prompt_cache_key: `karrer-luna-${input.clientId}`.slice(0, 64),
    };
    let response = await client.responses.create({ ...common, input: [{ role: "user", content }] });
    let toolCalls = 0;
    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const calls = responseCalls(response);
      if (!calls.length) break;
      toolCalls += calls.length;
      if (toolCalls > MAX_TOOL_ROUNDS) throw new LunaServiceError("AI_TOOL_LIMIT", "A Luna excedeu o limite seguro de ferramentas.");
      const outputs = [];
      for (const call of calls) {
        try {
          const result = await executeLunaTool(call, { env, user, request: input });
          outputs.push({ type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify(result) });
        } catch (reason) {
          const message = reason instanceof Error ? reason.message : "Falha ao executar ferramenta.";
          outputs.push({ type: "function_call_output" as const, call_id: call.call_id, output: JSON.stringify({ success: false, error: message }) });
        }
      }
      response = await client.responses.create({ ...common, input: [...response.output, ...outputs] as ResponseInput });
    }
    if (responseCalls(response).length) throw new LunaServiceError("AI_TOOL_LIMIT", "A Luna excedeu o limite seguro de ferramentas.");
    let parsed: unknown;
    try { parsed = JSON.parse(response.output_text); } catch { throw new LunaServiceError("AI_INVALID_RESPONSE", "A Luna retornou uma resposta inválida."); }
    const analysis = validateLunaAnalysis(parsed, input.inputType);
    return {
      analysis, model: response.model || agent.model, toolCalls, fileHash,
      usage: { inputTokens: response.usage?.input_tokens ?? 0,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0, totalTokens: response.usage?.total_tokens ?? 0 },
    };
  } catch (reason) {
    throw mapOpenAIError(reason);
  }
}
