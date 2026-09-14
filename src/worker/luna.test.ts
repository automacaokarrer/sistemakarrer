import { describe, expect, it } from "vitest";
import { HttpError } from "./http";
import { runLunaAgent, validateLunaAnalysis } from "./luna-agent-service";
import { validateLunaRequest } from "./luna";
import { executeLunaTool, toolsForLunaRequest } from "./luna-tools";
import { buildPassiveLunaInput, isHumanAttending, shouldAnalyzePassiveMessage } from "./luna-passive";
import { autonomousRepliesEnabled, buildAutonomousLunaInput, shouldReplyAutonomously } from "./luna-autonomous";

describe("entrada da Luna", () => {
  it("aceita texto e usa caseId como atendimento", () => {
    expect(validateLunaRequest({ clientId: "client-1", caseId: "conversation-1", inputType: "text", text: "Enviar contrato amanhã." }))
      .toMatchObject({ clientId: "client-1", conversationId: "conversation-1", inputType: "text", fileKey: null });
  });

  it("exige arquivo para entradas multimodais", () => {
    expect(() => validateLunaRequest({ clientId: "client-1", inputType: "pdf" })).toThrow(HttpError);
  });

  it("recusa atendimentos divergentes e tentativa de path traversal", () => {
    expect(() => validateLunaRequest({ clientId: "client-1", caseId: "one", conversationId: "two", inputType: "text", text: "x" })).toThrow(HttpError);
    expect(() => validateLunaRequest({ clientId: "client-1", inputType: "image", fileKey: "uploads/../secret" })).toThrow(HttpError);
  });
});

describe("saída estruturada da Luna", () => {
  const valid = {
    status: "APPROVED", contentType: "text", documentType: null, summary: "Cliente enviará o contrato.",
    extractedData: {}, problems: [], pendingItems: ["contrato"], memoryUpdates: ["Cliente enviará o contrato."],
    requiresHumanReview: false, confidence: 0.96, replyToClient: null,
  };

  it("valida a resposta e força revisão abaixo de 0,70", () => {
    expect(validateLunaAnalysis({ ...valid, confidence: 0.69 }, "text").requiresHumanReview).toBe(true);
  });

  it("recusa tipo de conteúdo divergente e JSON incompleto", () => {
    expect(() => validateLunaAnalysis({ ...valid, contentType: "pdf" }, "text")).toThrow("resposta inválida");
    expect(() => validateLunaAnalysis({ status: "APPROVED" }, "text")).toThrow("resposta inválida");
  });

  it("exige texto de resposta apenas no modo autônomo", () => {
    expect(() => validateLunaAnalysis(valid, "text", true)).toThrow("resposta inválida");
    expect(validateLunaAnalysis({ ...valid, replyToClient: "Olá! Como posso ajudar?" }, "text", true).replyToClient)
      .toBe("Olá! Como posso ajudar?");
    expect(validateLunaAnalysis({ ...valid, requiresHumanReview: true }, "text", true).replyToClient).toBeNull();
    expect(() => validateLunaAnalysis({ ...valid, replyToClient: "Não deveria responder." }, "text"))
      .toThrow("resposta inválida");
  });
});

describe("escopo das ferramentas da Luna", () => {
  it("impede que uma tool call troque o cliente", async () => {
    const call = { type: "function_call" as const, call_id: "call-1", name: "get_client_context", arguments: JSON.stringify({ clientId: "client-2" }) };
    const context = {
      env: {} as never,
      user: { id: "user-1" } as never,
      request: { clientId: "client-1", conversationId: null, inputType: "text" as const, text: "x", fileKey: null, metadata: {} },
    };
    await expect(executeLunaTool(call, context)).rejects.toThrow("outro cliente");
  });
});

describe("configuração da Luna", () => {
  it("falha de forma estruturada sem chave ou Agent ID", async () => {
    const input = validateLunaRequest({ clientId: "client-1", inputType: "text", text: "teste" });
    await expect(runLunaAgent({} as never, { id: "user-1" } as never, input, "request-1"))
      .rejects.toMatchObject({ code: "AI_NOT_CONFIGURED", status: 503 });
  });
});

describe("memória passiva durante atendimento humano", () => {
  const baseMessage = {
    id: "message-1", conversationId: "conversation-1", direction: "inbound" as const, type: "text",
    body: "Vou enviar o contrato amanhã.", mediaKey: null, fileName: null, mime: null,
    createdAt: "2026-09-13T12:00:00.000Z",
  };

  it("só considera atendimento humano quando há responsável e a conversa não está finalizada", () => {
    expect(isHumanAttending("user-1", "in_progress")).toBe(true);
    expect(isHumanAttending("user-1", "waiting_customer")).toBe(true);
    expect(isHumanAttending(null, "in_progress")).toBe(false);
    expect(isHumanAttending("user-1", "resolved")).toBe(false);
  });

  it("monta contexto recente e marca explicitamente que não deve responder ao cliente", () => {
    const input = buildPassiveLunaInput(baseMessage, "client-1", [
      { direction: "outbound", type: "text", body: "Pode enviar o contrato?", fileName: null, createdAt: "2026-09-13T11:59:00.000Z" },
      { direction: "inbound", type: "text", body: baseMessage.body, fileName: null, createdAt: baseMessage.createdAt },
    ]);
    expect(input).toMatchObject({ clientId: "client-1", conversationId: "conversation-1", inputType: "text", fileKey: null,
      metadata: { mode: "human_passive_memory", direction: "inbound" } });
    expect(input.text).toContain("Atendente: Pode enviar o contrato?");
    expect(input.text).toContain("Cliente: Vou enviar o contrato amanhã.");
    expect(input.text).toContain("nunca responda ao cliente");
  });

  it("analisa PDF e transforma anexos não suportados em memória textual", () => {
    const pdf = buildPassiveLunaInput({ ...baseMessage, type: "document", body: null, mediaKey: "zapi/file-1",
      fileName: "contrato.pdf", mime: "application/pdf" }, "client-1", []);
    expect(pdf).toMatchObject({ inputType: "pdf", fileKey: "zapi/file-1" });

    const office = buildPassiveLunaInput({ ...baseMessage, type: "document", body: null, mediaKey: "zapi/file-2",
      fileName: "planilha.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, "client-1", []);
    expect(office).toMatchObject({ inputType: "text", fileKey: null, metadata: { unsupportedAttachment: true } });
  });

  it("impede que uma tool call grave o resumo passivo sem o controle de ordem do CRM", async () => {
    const call = { type: "function_call" as const, call_id: "call-summary", name: "save_conversation_summary",
      arguments: JSON.stringify({ clientId: "client-1", caseId: "conversation-1", summary: "Resumo antigo" }) };
    const context = {
      env: { DB: { prepare: () => { throw new Error("não deveria gravar diretamente"); } } } as never,
      user: { id: "user-1" },
      request: { clientId: "client-1", conversationId: "conversation-1", inputType: "text" as const, text: "x", fileKey: null,
        metadata: { mode: "human_passive_memory" } },
    };
    await expect(executeLunaTool(call, context)).resolves.toMatchObject({ saved: false });
  });

  it("agrupa texto em blocos de três e mantém anexos e encerramentos imediatos", () => {
    expect(shouldAnalyzePassiveMessage(1, false)).toBe(false);
    expect(shouldAnalyzePassiveMessage(2, false)).toBe(false);
    expect(shouldAnalyzePassiveMessage(3, false)).toBe(true);
    expect(shouldAnalyzePassiveMessage(4, false)).toBe(false);
    expect(shouldAnalyzePassiveMessage(1, true)).toBe(true);
    expect(shouldAnalyzePassiveMessage(1, false, true)).toBe(true);
    expect(shouldAnalyzePassiveMessage(0, false, true)).toBe(false);
  });

  it("não envia schemas de ferramentas por padrão e libera o perfil CRM somente sob demanda", () => {
    const request = { clientId: "client-1", conversationId: "conversation-1", inputType: "text" as const,
      text: "x", fileKey: null, metadata: {} };
    expect(toolsForLunaRequest(request)).toHaveLength(0);
    expect(toolsForLunaRequest({ ...request, metadata: { toolMode: "crm" } }).length).toBeGreaterThan(0);
    expect(toolsForLunaRequest({ ...request, metadata: { toolMode: "crm", mode: "human_passive_memory" } })).toHaveLength(0);
  });
});

describe("atendimento autônomo da Luna", () => {
  const message = {
    id: "message-auto-1", conversationId: "conversation-1", direction: "inbound" as const, type: "text",
    body: "Quero entender como funciona o atendimento.", mediaKey: null, fileName: null, mime: null,
    createdAt: "2026-09-14T12:00:00.000Z",
  };

  it("permanece desligado por padrão e exige ativação explícita", () => {
    expect(autonomousRepliesEnabled({})).toBe(false);
    expect(autonomousRepliesEnabled({ LUNA_AUTONOMOUS_ENABLED: "false" })).toBe(false);
    expect(autonomousRepliesEnabled({ LUNA_AUTONOMOUS_ENABLED: " TRUE " })).toBe(true);
  });

  it("responde apenas a mensagem recebida em conversa sem responsável", () => {
    expect(shouldReplyAutonomously(message, { assigneeId: null, serviceStatus: "new" })).toBe(true);
    expect(shouldReplyAutonomously(message, { assigneeId: "user-1", serviceStatus: "in_progress" })).toBe(false);
    expect(shouldReplyAutonomously(message, { assigneeId: null, serviceStatus: "resolved" })).toBe(false);
    expect(shouldReplyAutonomously({ ...message, direction: "outbound" }, { assigneeId: null, serviceStatus: "new" })).toBe(false);
  });

  it("monta uma resposta identificada, limitada e sem ferramentas por padrão", () => {
    const input = buildAutonomousLunaInput(message, "client-1", [
      { direction: "inbound", type: "text", body: message.body, fileName: null, createdAt: message.createdAt },
    ], true);
    expect(input).toMatchObject({ clientId: "client-1", conversationId: "conversation-1", inputType: "text", fileKey: null,
      metadata: { mode: "autonomous_reply", messageId: "message-auto-1", firstReply: true } });
    expect(input.text).toContain("assistente virtual da Karrer");
    expect(input.text).toContain("Não dê parecer jurídico");
    expect(toolsForLunaRequest(input)).toHaveLength(0);
  });
});
