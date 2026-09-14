import { INBOX_ROOM } from "./realtime";
import type { AppEnv } from "./types";

export type AutomaticClassification = "hot" | "warm" | "cold";

export interface ClassificationMessage {
  direction: string;
  type: string;
  body: string | null;
  status?: string;
}

export interface AutomaticClassificationResult {
  classification: AutomaticClassification;
  score: number;
}

function normalized(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function matchesAny(value: string, expressions: RegExp[]): boolean {
  return expressions.some((expression) => expression.test(value));
}

const strongIntent = [
  /\b(quero|vamos|podemos) (contratar|fechar|prosseguir|seguir|iniciar|comecar)\b/,
  /\b(dar entrada|entrar com (a|o) (acao|processo)|assinar (o )?contrato)\b/,
  /\b(como (faco|fazemos) para contratar)\b/,
  /\b(quero (um|uma) advogado|preciso (de )?(um|uma) advogado)\b/,
  /\b(agendar|marcar) (uma )?(consulta|reuniao)\b/,
  /\b(pode (dar entrada|iniciar|comecar|prosseguir))\b/,
];

const interestSignals = [
  /\b(tenho interesse|gostaria de saber|preciso de ajuda|meu caso|minha situacao)\b/,
  /\b(advogad|processo|acao judicial|direito|indenizacao)\w*/,
  /\b(emprestimo|consignado|financiamento|banco|desconto indevido|divida)\w*/,
  /\b(documento|contrato|comprovante|extrato|holerite|beneficio)\w*/,
  /\b(valor|honorario|consulta|prazo|quanto custa)\w*/,
];

const negativeSignals = [
  /\b(nao tenho interesse|nao quero|nao preciso mais|foi engano)\b/,
  /\b(pare de (mandar|enviar)|remova meu contato|nao me (mande|envie)|encerrar atendimento)\b/,
];

const hesitationSignals = [
  /\b(so estou pesquisando|vou pensar|depois eu vejo|talvez depois|agora nao)\b/,
];

export function calculateAutomaticClassification(messages: ClassificationMessage[]): AutomaticClassificationResult {
  const inbound = messages.filter((message) => message.direction === "inbound" && message.status !== "failed");
  if (!inbound.length) return { classification: "cold", score: 20 };

  const texts = inbound.map((message) => normalized(message.body ?? ""));
  let latestStrong = -1;
  let latestNegative = -1;
  let interestCount = 0;
  let questions = 0;
  for (const [index, text] of texts.entries()) {
    if (matchesAny(text, strongIntent)) latestStrong = index;
    if (matchesAny(text, negativeSignals)) latestNegative = index;
    interestCount += interestSignals.filter((expression) => expression.test(text)).length;
    questions += (text.match(/\?/g) ?? []).length;
  }

  if (latestNegative > latestStrong) return { classification: "cold", score: 5 };

  const characters = texts.reduce((total, text) => total + text.length, 0);
  const documents = inbound.filter((message) => message.type === "document").length;
  const otherMedia = inbound.filter((message) => message.type === "image" || message.type === "audio").length;
  let score = 20;
  score += Math.min(16, inbound.length * 4);
  if (characters >= 30) score += 5;
  if (characters >= 120) score += 7;
  if (characters >= 300) score += 6;
  score += Math.min(32, interestCount * 16);
  score += Math.min(8, questions * 4);
  score += Math.min(25, documents * 25);
  score += Math.min(10, otherMedia * 5);
  if (latestStrong >= 0) score += 50;
  if (texts.some((text) => matchesAny(text, hesitationSignals)) && latestStrong < 0) score = Math.min(score, 35);
  score = Math.max(0, Math.min(100, score));

  return { classification: score >= 70 ? "hot" : score >= 40 ? "warm" : "cold", score };
}

export async function refreshAutomaticLeadClassification(env: AppEnv, conversationId: string): Promise<void> {
  const messages = await env.DB.prepare(`SELECT direction, type, body, status FROM messages
    WHERE conversation_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 30`)
    .bind(conversationId).all<ClassificationMessage>();
  const result = calculateAutomaticClassification([...messages.results].reverse());
  const updated = await env.DB.prepare(`UPDATE conversations SET classification = ?1, score = ?2,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = ?3 AND classification_source = 'automatic'
      AND (classification <> ?1 OR score <> ?2)`)
    .bind(result.classification, result.score, conversationId).run();
  if (updated.meta.changes) {
    await env.CHAT_ROOMS.getByName(INBOX_ROOM).broadcast({ type: "conversation.updated", conversationId });
  }
}

export function scheduleAutomaticLeadClassification(env: AppEnv, ctx: ExecutionContext | undefined, conversationId: string): void {
  if (!ctx) return;
  ctx.waitUntil(refreshAutomaticLeadClassification(env, conversationId).catch((reason) => {
    console.error(JSON.stringify({ event: "lead.classification.failed", conversationId,
      message: reason instanceof Error ? reason.message : "unknown" }));
  }));
}
