import { HttpError } from "./http";
import type { AppEnv, LunaActor } from "./types";
import type { LunaAnalysis, LunaClientContext, LunaStatus, ValidatedLunaRequest } from "./luna-types";

type DocumentRow = { id: string; fileName: string; mime: string; mediaKey: string };

function safeJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function maskCpf(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 ? `***.***.***-${digits.slice(-2)}` : "***";
}

export async function assertLunaScope(env: AppEnv, clientId: string, conversationId: string | null): Promise<void> {
  const contact = await env.DB.prepare("SELECT id FROM contacts WHERE id = ?1").bind(clientId).first();
  if (!contact) throw new HttpError("Cliente não encontrado.", 404);
  if (!conversationId) return;
  const conversation = await env.DB.prepare("SELECT id FROM conversations WHERE id = ?1 AND contact_id = ?2")
    .bind(conversationId, clientId).first();
  if (!conversation) throw new HttpError("Atendimento não pertence ao cliente informado.", 422);
}

export async function getClientDocuments(env: AppEnv, clientId: string): Promise<Array<{ id: string; name: string; type: string; fileKey: string | null }>> {
  const [messages, uploads, drive] = await Promise.all([
    env.DB.prepare(`SELECT m.id, COALESCE(m.file_name, m.body, m.type) AS name, m.type,
      m.media_key AS fileKey FROM messages m JOIN conversations c ON c.id = m.conversation_id
      WHERE c.contact_id = ?1 AND m.type IN ('image', 'document', 'audio')
      ORDER BY m.created_at DESC LIMIT 20`).bind(clientId).all<{ id: string; name: string; type: string; fileKey: string | null }>(),
    env.DB.prepare(`SELECT id, file_name AS name, mime AS type, media_key AS fileKey
      FROM client_documents WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 20`)
      .bind(clientId).all<{ id: string; name: string; type: string; fileKey: string }>(),
    env.DB.prepare(`SELECT id, file_name AS name, mime_type AS type, NULL AS fileKey
      FROM contact_documents WHERE contact_id = ?1 ORDER BY created_at DESC LIMIT 20`)
      .bind(clientId).all<{ id: string; name: string; type: string; fileKey: null }>(),
  ]);
  return [...messages.results, ...uploads.results, ...drive.results].slice(0, 30);
}

export async function getClientContext(env: AppEnv, clientId: string, conversationId: string | null): Promise<LunaClientContext> {
  await assertLunaScope(env, clientId, conversationId);
  const [client, caseRow, documents, facts, pending, summary] = await Promise.all([
    env.DB.prepare(`SELECT id, name, cpf, bank, profile_complete AS profileComplete FROM contacts WHERE id = ?1`)
      .bind(clientId).first<{ id: string; name: string | null; cpf: string | null; bank: string | null; profileComplete: number }>(),
    conversationId ? env.DB.prepare(`SELECT id, stage, service_status AS status, classification FROM conversations WHERE id = ?1`)
      .bind(conversationId).first<{ id: string; stage: string; status: string; classification: string }>() : Promise.resolve(null),
    getClientDocuments(env, clientId),
    env.DB.prepare(`SELECT category, content, importance FROM luna_memories
      WHERE contact_id = ?1 AND (conversation_id IS NULL OR conversation_id = ?2)
      ORDER BY importance DESC, updated_at DESC LIMIT 12`).bind(clientId, conversationId).all<{ category: string; content: string; importance: number }>(),
    env.DB.prepare(`SELECT description FROM luna_pending_items WHERE contact_id = ?1
      AND (conversation_id IS NULL OR conversation_id = ?2) AND status = 'open'
      ORDER BY updated_at DESC LIMIT 12`).bind(clientId, conversationId).all<{ description: string }>(),
    conversationId ? env.DB.prepare("SELECT summary FROM luna_conversation_summaries WHERE conversation_id = ?1")
      .bind(conversationId).first<{ summary: string }>() : Promise.resolve(null),
  ]);
  if (!client) throw new HttpError("Cliente não encontrado.", 404);
  return {
    client: { ...client, cpf: maskCpf(client.cpf), profileComplete: Boolean(client.profileComplete) },
    case: caseRow,
    documents: { received: documents.map((item) => item.name).slice(0, 20), pending: pending.results.map((item) => item.description) },
    importantFacts: facts.results,
    recentSummary: summary?.summary ?? null,
  };
}

export async function getAuthorizedFile(env: AppEnv, input: ValidatedLunaRequest): Promise<{ object: R2ObjectBody; document: DocumentRow; hash: string }> {
  if (!input.fileKey) throw new HttpError("Arquivo não informado.", 422);
  const document = await env.DB.prepare(`SELECT m.id, COALESCE(m.file_name, m.body, m.type) AS fileName,
    COALESCE(m.mime, 'application/octet-stream') AS mime, m.media_key AS mediaKey
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    WHERE c.contact_id = ?1 AND m.media_key = ?2
    UNION ALL
    SELECT id, file_name AS fileName, mime, media_key AS mediaKey FROM client_documents
    WHERE contact_id = ?1 AND media_key = ?2 LIMIT 1`).bind(input.clientId, input.fileKey).first<DocumentRow>();
  if (!document) throw new HttpError("Arquivo não pertence ao cliente informado.", 403);
  const object = await env.MEDIA.get(input.fileKey);
  if (!object) throw new HttpError("Arquivo não encontrado no armazenamento.", 404);
  return { object, document, hash: object.etag };
}

export async function findCachedAnalysis(env: AppEnv, clientId: string, fileKey: string, hash: string): Promise<LunaAnalysis | null> {
  const row = await env.DB.prepare(`SELECT status, content_type AS contentType, document_type AS documentType, summary,
    extracted_data_json AS extractedData, problems_json AS problems, pending_items_json AS pendingItems, confidence
    FROM luna_document_analyses WHERE contact_id = ?1 AND file_key = ?2 AND file_hash = ?3`)
    .bind(clientId, fileKey, hash).first<Record<string, unknown>>();
  if (!row) return null;
  return {
    status: row.status as LunaStatus,
    contentType: row.contentType as LunaAnalysis["contentType"],
    documentType: typeof row.documentType === "string" ? row.documentType : null,
    summary: String(row.summary ?? ""),
    extractedData: safeJson(String(row.extractedData ?? "{}"), {}),
    problems: safeJson(String(row.problems ?? "[]"), []),
    pendingItems: safeJson(String(row.pendingItems ?? "[]"), []),
    memoryUpdates: [],
    requiresHumanReview: Number(row.confidence) < 0.7 || row.status === "REVIEW_REQUIRED",
    confidence: Number(row.confidence), replyToClient: null,
  };
}

export async function saveFact(env: AppEnv, user: LunaActor, clientId: string, conversationId: string | null,
  category: string, content: string, importance: number): Promise<void> {
  const existing = await env.DB.prepare(`SELECT id FROM luna_memories WHERE contact_id = ?1
    AND COALESCE(conversation_id, '') = COALESCE(?2, '') AND category = ?3 AND content = ?4 LIMIT 1`)
    .bind(clientId, conversationId, category, content).first();
  if (existing) return;
  await env.DB.prepare(`INSERT INTO luna_memories
    (id, contact_id, conversation_id, category, content, importance, created_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(crypto.randomUUID(), clientId, conversationId, category, content, importance, user.id).run();
}

export async function savePendingItems(env: AppEnv, clientId: string, conversationId: string | null, items: string[], analysisId: string | null = null): Promise<void> {
  for (const description of items.slice(0, 12)) {
    const existing = await env.DB.prepare(`SELECT id FROM luna_pending_items WHERE contact_id = ?1
      AND COALESCE(conversation_id, '') = COALESCE(?2, '') AND status = 'open' AND description = ?3 LIMIT 1`)
      .bind(clientId, conversationId, description).first();
    if (!existing) await env.DB.prepare(`INSERT INTO luna_pending_items
      (id, contact_id, conversation_id, type, description, source_analysis_id) VALUES (?1, ?2, ?3, 'document', ?4, ?5)`)
      .bind(crypto.randomUUID(), clientId, conversationId, description, analysisId).run();
  }
}

export async function saveAnalysis(env: AppEnv, user: LunaActor, input: ValidatedLunaRequest,
  result: LunaAnalysis, hash: string): Promise<string | null> {
  let analysisId: string | null = null;
  if (input.fileKey && input.inputType !== "text") {
    const existing = await env.DB.prepare(`SELECT id FROM luna_document_analyses
      WHERE contact_id = ?1 AND file_key = ?2 AND file_hash = ?3`)
      .bind(input.clientId, input.fileKey, hash).first<{ id: string }>();
    analysisId = existing?.id ?? crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO luna_document_analyses
      (id, contact_id, conversation_id, file_key, file_hash, content_type, document_type, status, confidence,
       summary, extracted_data_json, problems_json, pending_items_json, analyzed_by)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
      ON CONFLICT(contact_id, file_key, file_hash) DO UPDATE SET document_type = excluded.document_type,
       status = excluded.status, confidence = excluded.confidence, summary = excluded.summary,
       extracted_data_json = excluded.extracted_data_json, problems_json = excluded.problems_json,
       pending_items_json = excluded.pending_items_json, analyzed_by = excluded.analyzed_by,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`)
      .bind(analysisId, input.clientId, input.conversationId, input.fileKey, hash, input.inputType, result.documentType,
        result.status, result.confidence, result.summary, JSON.stringify(result.extractedData), JSON.stringify(result.problems),
        JSON.stringify(result.pendingItems), user.id).run();
  }
  for (const fact of result.memoryUpdates.slice(0, 12)) await saveFact(env, user, input.clientId, input.conversationId, "analysis", fact, 3);
  await savePendingItems(env, input.clientId, input.conversationId, result.pendingItems, analysisId);
  return analysisId;
}
