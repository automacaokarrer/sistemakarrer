import type { FunctionTool, ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { HttpError } from "./http";
import { getAuthorizedFile, getClientContext, getClientDocuments, saveAnalysis, saveFact, savePendingItems } from "./luna-memory";
import { lunaStatuses, type LunaAnalysis, type LunaStatus, type ValidatedLunaRequest } from "./luna-types";
import type { AppEnv, SessionUser } from "./types";

export interface LunaToolContext {
  env: AppEnv;
  user: Pick<SessionUser, "id">;
  request: ValidatedLunaRequest;
}

const objectSchema = (properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> => ({
  type: "object", properties, required, additionalProperties: false,
});
const stringProperty = (description: string, maxLength = 500): Record<string, unknown> => ({ type: "string", description, maxLength });

export const lunaTools: FunctionTool[] = [
  { type: "function", name: "get_client_context", description: "Obtém o contexto compacto e autorizado do cliente atual.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID opcional do atendimento", 100) }, ["clientId"]) },
  { type: "function", name: "get_client_documents", description: "Lista metadados dos documentos do cliente atual, sem expor arquivos.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100) }, ["clientId"]) },
  { type: "function", name: "get_case_context", description: "Obtém o atendimento atual vinculado ao cliente.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID do atendimento", 100) }, ["clientId", "caseId"]) },
  { type: "function", name: "get_client_memory", description: "Lê os fatos relevantes já persistidos para o cliente atual.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID opcional do atendimento", 100) }, ["clientId"]) },
  { type: "function", name: "save_client_fact", description: "Salva um fato curto e relevante na memória própria do CRM.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID opcional do atendimento", 100),
      category: stringProperty("Categoria curta do fato", 60), content: stringProperty("Fato objetivo", 800), importance: { type: "integer", minimum: 1, maximum: 5 } }, ["clientId", "category", "content"]) },
  { type: "function", name: "save_document_analysis", description: "Salva a análise estruturada do arquivo atual.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), fileKey: stringProperty("Chave do arquivo atual", 500),
      status: { type: "string", enum: [...lunaStatuses] }, documentType: { type: ["string", "null"], maxLength: 100 },
      summary: stringProperty("Resumo da análise", 1500), confidence: { type: "number", minimum: 0, maximum: 1 },
      extractedData: { type: "object" }, problems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20 },
      pendingItems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 20 } },
    ["clientId", "fileKey", "status", "summary", "confidence"]) },
  { type: "function", name: "update_document_status", description: "Atualiza o status da análise já salva para o arquivo atual.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), fileKey: stringProperty("Chave do arquivo atual", 500),
      status: { type: "string", enum: [...lunaStatuses] } }, ["clientId", "fileKey", "status"]) },
  { type: "function", name: "update_pending_documents", description: "Inclui ou resolve pendências documentais do cliente atual.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID opcional do atendimento", 100),
      pendingItems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 12 },
      resolvedItems: { type: "array", items: { type: "string", maxLength: 300 }, maxItems: 12 } }, ["clientId"]) },
  { type: "function", name: "save_conversation_summary", description: "Salva um resumo curto do atendimento atual, substituindo o resumo anterior.", strict: false,
    parameters: objectSchema({ clientId: stringProperty("ID do cliente atual", 100), caseId: stringProperty("ID do atendimento", 100),
      summary: stringProperty("Resumo objetivo do atendimento", 2000) }, ["clientId", "caseId", "summary"]) },
];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError("Argumentos de ferramenta inválidos.", 422);
  return value as Record<string, unknown>;
}

function textArg(args: Record<string, unknown>, name: string, max: number, required = true): string | null {
  const value = typeof args[name] === "string" ? args[name].trim() : "";
  if (required && !value) throw new HttpError(`Ferramenta sem ${name}.`, 422);
  if (value.length > max) throw new HttpError(`Argumento ${name} excede o limite.`, 422);
  return value || null;
}

function stringList(args: Record<string, unknown>, name: string): string[] {
  const value = args[name];
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 20 || value.some((item) => typeof item !== "string" || !item.trim() || item.length > 300)) {
    throw new HttpError(`Argumento ${name} inválido.`, 422);
  }
  return value.map((item) => String(item).trim());
}

function assertToolScope(args: Record<string, unknown>, request: ValidatedLunaRequest): void {
  const clientId = textArg(args, "clientId", 100);
  const caseId = textArg(args, "caseId", 100, false);
  if (clientId !== request.clientId || (caseId && caseId !== request.conversationId)) throw new HttpError("A ferramenta tentou acessar outro cliente ou atendimento.", 403);
}

function statusArg(args: Record<string, unknown>): LunaStatus {
  const value = textArg(args, "status", 30);
  if (!lunaStatuses.includes(value as LunaStatus)) throw new HttpError("Status de análise inválido.", 422);
  return value as LunaStatus;
}

export async function executeLunaTool(call: ResponseFunctionToolCall, context: LunaToolContext): Promise<unknown> {
  let parsed: unknown;
  try { parsed = JSON.parse(call.arguments); } catch { throw new HttpError("JSON da ferramenta inválido.", 422); }
  const args = record(parsed);
  assertToolScope(args, context.request);
  const { env, user, request } = context;
  switch (call.name) {
    case "get_client_context": return getClientContext(env, request.clientId, request.conversationId);
    case "get_client_documents": return { documents: await getClientDocuments(env, request.clientId) };
    case "get_case_context": return { case: (await getClientContext(env, request.clientId, request.conversationId)).case };
    case "get_client_memory": return { memories: (await getClientContext(env, request.clientId, request.conversationId)).importantFacts };
    case "save_client_fact": {
      const importance = Number(args.importance ?? 3);
      if (!Number.isInteger(importance) || importance < 1 || importance > 5) throw new HttpError("Importância inválida.", 422);
      await saveFact(env, user, request.clientId, request.conversationId, textArg(args, "category", 60)!, textArg(args, "content", 800)!, importance);
      return { saved: true };
    }
    case "save_document_analysis": {
      if (!request.fileKey || textArg(args, "fileKey", 500) !== request.fileKey) throw new HttpError("Arquivo da ferramenta não autorizado.", 403);
      const confidence = Number(args.confidence);
      if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new HttpError("Confiança inválida.", 422);
      const { hash } = await getAuthorizedFile(env, request);
      const analysis: LunaAnalysis = {
        status: statusArg(args), contentType: request.inputType, documentType: textArg(args, "documentType", 100, false),
        summary: textArg(args, "summary", 1500)!, extractedData: record(args.extractedData ?? {}), problems: stringList(args, "problems"),
        pendingItems: stringList(args, "pendingItems"), memoryUpdates: [], requiresHumanReview: confidence < 0.7, confidence,
      };
      await saveAnalysis(env, user, request, analysis, hash);
      return { saved: true };
    }
    case "update_document_status": {
      if (!request.fileKey || textArg(args, "fileKey", 500) !== request.fileKey) throw new HttpError("Arquivo da ferramenta não autorizado.", 403);
      const result = await env.DB.prepare(`UPDATE luna_document_analyses SET status = ?1,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE contact_id = ?2 AND file_key = ?3`)
        .bind(statusArg(args), request.clientId, request.fileKey).run();
      return { updated: result.meta.changes > 0 };
    }
    case "update_pending_documents": {
      await savePendingItems(env, request.clientId, request.conversationId, stringList(args, "pendingItems"));
      for (const description of stringList(args, "resolvedItems")) await env.DB.prepare(`UPDATE luna_pending_items SET status = 'resolved',
        resolved_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE contact_id = ?1 AND COALESCE(conversation_id, '') = COALESCE(?2, '') AND description = ?3 AND status = 'open'`)
        .bind(request.clientId, request.conversationId, description).run();
      return { updated: true };
    }
    case "save_conversation_summary": {
      if (!request.conversationId) throw new HttpError("Atendimento obrigatório para salvar resumo.", 422);
      if (request.metadata.mode === "human_passive_memory") {
        return { saved: false, reason: "O resumo passivo é persistido pelo CRM com controle de ordem." };
      }
      await env.DB.prepare(`INSERT INTO luna_conversation_summaries (conversation_id, contact_id, summary)
        VALUES (?1, ?2, ?3) ON CONFLICT(conversation_id) DO UPDATE SET summary = excluded.summary,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
        .bind(request.conversationId, request.clientId, textArg(args, "summary", 2000)!).run();
      return { saved: true };
    }
    default: throw new HttpError("Ferramenta da Luna não permitida.", 422);
  }
}
