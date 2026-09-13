import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const now = new Date().toISOString();

async function mockAnonymous(page: Page) {
  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ setupRequired: false, user: null, features: { googleDrive: false } }),
  }));
}

async function mockDashboard(
  page: Page,
  additionalConversations: () => unknown[] = () => [],
  messagePage: (url: URL) => unknown = () => ({ messages: [], hasMore: false, nextCursor: null }),
  permissions = { chat: true, leads: true, clients: true, settings: true },
) {
  const user = { id: "admin-1", name: "Ana Karrer", email: "ana@karrer.test", role: "admin", avatarUrl: null, professionalRole: "Administradora", permissions };
  const conversationOverrides = new Map<string, Record<string, unknown>>();
  const conversations = [{
    id: "conversation-1", contactId: "contact-1", createdAt: now, name: "Maria Oliveira", phone: "5592999999999",
    bank: "Banco Exemplo", stage: "Documentação", classification: "hot", score: 86, lastMessage: "Enviei os documentos",
    lastMessageType: "text", lastMessageAt: now, unreadCount: 2, online: false, lastSeenAt: now, waitingSince: now, serviceStatus: "new", assigneeId: "admin-1", assigneeName: "Ana Karrer", avatarUrl: "/karrer-logo.png",
    firstResponseMinutes: 5.1, firstResponderId: "admin-1", firstResponderName: "Ana Karrer",
  }];
  const contacts = [{
    id: "contact-1", phone: "5592999999999", name: "Maria Oliveira", cpf: null, rg: null, rgIssuer: null,
    birthDate: null, email: "maria@example.com", addressLine: null, city: "Manaus", state: "AM", postalCode: null,
    bank: "Banco Exemplo", ccb: null, profileComplete: true, createdAt: now,
  }];
  const users = [
    { ...user, active: true, emailVerified: true, instagram: "@anakarrer", online: true, lastSeenAt: now, createdAt: now },
    { id: "user-2", name: "João Lima", email: "joao@karrer.test", role: "attendant", avatarUrl: null, professionalRole: "Advogado", permissions: { chat: true, leads: true, clients: true, settings: false }, active: true, emailVerified: true, instagram: "@joaolima", online: false, lastSeenAt: now, createdAt: now },
  ];

  await page.route("**/api/**", async (route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.pathname;
    let body: unknown = { ok: true };
    if (path === "/api/auth/status") body = { setupRequired: false, user, features: { googleDrive: false } };
    else if (path === "/api/conversations") body = { conversations: [...conversations, ...additionalConversations()].map((conversation: any) => ({ ...conversation, ...(conversationOverrides.get(conversation.id) ?? {}) })) };
    else if (path === "/api/contacts") body = { contacts };
    else if (path === "/api/contacts/contact-1" && route.request().method() === "PATCH") {
      const input = route.request().postDataJSON() as Record<string, string>;
      Object.assign(contacts[0], input, { profileComplete: Boolean(input.name && input.cpf) });
      body = { ok: true, id: "contact-1", profileComplete: contacts[0].profileComplete };
    }
    else if (path === "/api/leads/summary") body = { total: 1, hot: 1, warm: 0, cold: 0, averageFirstResponseMinutes: 4, daily: [] };
    else if (path === "/api/settings/users") body = { users };
    else if (/\/api\/conversations\/[^/]+\/read$/.test(path) && route.request().method() === "POST") {
      const conversationId = path.split("/").at(-2)!;
      conversationOverrides.set(conversationId, { ...(conversationOverrides.get(conversationId) ?? {}), unreadCount: 0, waitingSince: null, serviceStatus: "in_progress", assigneeId: user.id, assigneeName: user.name });
      body = { ok: true, unreadCount: 0, serviceStatus: "in_progress", assigneeId: user.id, assigneeName: user.name };
    }
    else if (/\/api\/conversations\/[^/]+\/assignee$/.test(path) && route.request().method() === "PATCH") {
      const conversationId = path.split("/").at(-2)!;
      const input = route.request().postDataJSON() as { userId: string | null };
      const assignee = users.find((item) => item.id === input.userId) ?? null;
      conversationOverrides.set(conversationId, { ...(conversationOverrides.get(conversationId) ?? {}), assigneeId: assignee?.id ?? null, assigneeName: assignee?.name ?? null });
      body = { ok: true, assigneeName: assignee?.name ?? null };
    }
    else if (/\/api\/conversations\/[^/]+\/status$/.test(path) && route.request().method() === "PATCH") {
      const conversationId = path.split("/").at(-2)!;
      const input = route.request().postDataJSON() as { status: string };
      conversationOverrides.set(conversationId, { ...(conversationOverrides.get(conversationId) ?? {}), serviceStatus: input.status });
      body = { ok: true, status: input.status };
    }
    else if (path.endsWith("/media") && route.request().method() === "POST") body = { message: { id: "message-upload", conversationId: "conversation-1", direction: "outbound", type: "image", body: "Imagem de teste", fileName: "foto.png", mediaKey: "uploads/test/foto.png", duration: null, status: "sent", createdAt: now } };
    else if (path.endsWith("/messages")) body = messagePage(requestUrl);
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
  });
}

async function expectNoHorizontalOverflow(page: Page) {
  const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
}

test("login e cadastro público permanecem utilizáveis", async ({ page }) => {
  await mockAnonymous(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Entrar no sistema" })).toBeVisible();
  await page.getByRole("button", { name: "Criar conta" }).click();
  await expect(page.getByRole("heading", { name: "Cadastre-se" })).toBeVisible();
  await expect(page.getByLabel("Foto de perfil *")).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("painel principal abre todos os módulos autorizados", async ({ page }, testInfo) => {
  await mockDashboard(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Conversas", exact: true })).toBeVisible();
  await expect(page.getByAltText("Foto de Maria Oliveira").first()).toBeVisible();
  await expect(page.getByLabel("2 mensagens não lidas")).toBeVisible();
  await expect(page.getByText("Suas conversas em um só lugar")).toBeVisible();
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  await expect(page.locator(".conversation-assignee")).toContainText("Ana Karrer atendendo");
  await expect(page.getByLabel("2 mensagens não lidas")).toHaveCount(0);
  await page.getByRole("button", { name: "Direcionar atendimento" }).click();
  await page.getByRole("option", { name: "João Lima" }).click();
  await expect(page.locator(".conversation-assignee")).toContainText("João Lima atendendo");
  await page.getByRole("button", { name: "Status do atendimento" }).click();
  await page.getByRole("option", { name: "Aguardando cliente" }).click();
  await expect(page.locator(".conversation-service-status")).toContainText("Aguardando cliente");
  if (testInfo.project.name === "mobile") await page.getByRole("button", { name: "Voltar às conversas" }).click();
  await page.getByRole("button", { name: "Minhas" }).click();
  await expect(page.getByRole("button", { name: /Maria Oliveira/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Todas" }).click();

  await page.getByRole("button", { name: "Leads" }).click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect(page.getByText("(92) 99999-9999")).toBeVisible();
  await page.getByRole("button", { name: "Filtrar por hora de entrada" }).click();
  await expect(page.getByRole("dialog", { name: "Hora de entrada" })).toBeVisible();
  await page.getByRole("button", { name: /Todos os horários/ }).click();
  if (testInfo.project.name === "desktop") await testInfo.attach("leads-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  if (process.env.CAPTURE_UI) await page.screenshot({ path: `tmp/${testInfo.project.name}-leads-page.png`, fullPage: true });

  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cadastro de clientes" })).toBeVisible();
  await expect(page.getByText("Cadastros completos")).toBeVisible();
  await expect(page.getByText("Com banco informado")).toBeVisible();
  await page.getByRole("button", { name: "Editar Maria Oliveira" }).click();
  await expect(page.getByRole("heading", { name: "Editar cliente" })).toBeVisible();
  await expect(page.locator('.client-form [name="phone"]')).toHaveValue("5592999999999");
  await page.locator('.client-form [name="cpf"]').fill("11144477735");
  await page.locator('.client-form [name="bank"]').fill("Banco Atualizado");
  await page.locator('.client-form [name="rgIssuer"]').fill("SSP-AM");
  await page.locator('.client-form [name="classification"]').selectOption("cold");
  await page.getByRole("button", { name: "Salvar alterações" }).click();
  await expect(page.getByRole("status")).toContainText("Dados do cliente atualizados no banco.");
  await expect(page.locator(".recent-person.selected")).toContainText("Banco Atualizado");
  await page.getByRole("button", { name: "Novo cliente" }).click();
  await page.getByRole("button", { name: "Editar Maria Oliveira" }).click();
  await expect(page.locator('.client-form [name="cpf"]')).toHaveValue("11144477735");
  await expect(page.locator('.client-form [name="rgIssuer"]')).toHaveValue("SSP-AM");
  await expect(page.locator('.client-form [name="classification"]')).toHaveValue("cold");
  if (testInfo.project.name === "desktop") await testInfo.attach("clients-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  if (process.env.CAPTURE_UI) await page.screenshot({ path: `tmp/${testInfo.project.name}-clients-page.png`, fullPage: true });

  await page.getByRole("button", { name: "Configurações" }).click();
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
  await expect(page.getByText("Equipe online")).toBeVisible();
  await page.getByRole("button", { name: "Ver informações de João Lima" }).click();
  await expect(page.getByRole("dialog", { name: "Informações do usuário" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Informações do usuário" }).getByText("@joaolima", { exact: true })).toBeVisible();
  await expect(page.getByText("As permissões só podem ser alteradas por você, administrador mestre.")).toBeVisible();
  await page.getByRole("button", { name: "Fechar" }).click();
  await expectNoHorizontalOverflow(page);
});

test("média da primeira resposta muda conforme o atendente", async ({ page }) => {
  await mockDashboard(page, () => [{
    id: "conversation-2", contactId: "contact-2", createdAt: now, name: "Contato de João", phone: "5592888888888",
    bank: null, stage: "Primeiro contato", classification: "warm", score: 50, lastMessage: "Respondido",
    lastMessageType: "text", lastMessageAt: now, unreadCount: 0, online: false, lastSeenAt: null,
    waitingSince: null, serviceStatus: "in_progress", assigneeId: "user-2", assigneeName: "João Lima", avatarUrl: null,
    firstResponseMinutes: 14.9, firstResponderId: "user-2", firstResponderName: "João Lima",
  }]);
  await page.goto("/");
  await page.getByRole("button", { name: "Leads" }).click();
  await expect(page.locator(".response-time strong")).toContainText("10 min");
  await page.getByRole("combobox", { name: "Atendente responsável" }).selectOption("admin-1");
  await expect(page.locator(".response-time strong")).toContainText("5,1 min");
  await page.getByRole("combobox", { name: "Atendente responsável" }).selectOption("user-2");
  await expect(page.locator(".response-time strong")).toContainText("14,9 min");
  await page.getByRole("combobox", { name: "Atendente responsável" }).selectOption("unassigned");
  await expect(page.locator(".response-time strong")).toHaveText("—");
});

test("nova conversa aparece em tempo real sem recarregar a página", async ({ page }) => {
  let additionalConversations: unknown[] = [];
  let inboxSocket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/conversations\/ws$/, (socket) => { inboxSocket = socket; });
  await page.routeWebSocket(/\/api\/conversations\/[^/]+\/ws$/, () => undefined);
  await mockDashboard(page, () => additionalConversations);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Maria Oliveira/ })).toBeVisible();
  await expect.poll(() => Boolean(inboxSocket)).toBe(true);

  additionalConversations = [{
    id: "conversation-2", contactId: "contact-2", createdAt: new Date().toISOString(), name: "Contato em tempo real", phone: "5592888888888",
    bank: null, stage: "Primeiro contato", classification: "warm", score: 50, lastMessage: "Mensagem recebida agora",
    lastMessageType: "text", lastMessageAt: new Date().toISOString(), unreadCount: 1, online: false, lastSeenAt: null, waitingSince: new Date(new Date(now).getTime() - 5 * 60_000).toISOString(), serviceStatus: "new", assigneeId: null, assigneeName: null, avatarUrl: "/karrer-logo.png",
  }];
  inboxSocket!.send(JSON.stringify({ type: "conversation.updated" }));

  await expect(page.getByRole("button", { name: /Contato em tempo real/ })).toBeVisible();
  await expect(page.getByLabel("1 mensagem não lida")).toBeVisible();
  await expect(page.getByText(/Aguardando há 5 min/)).toBeVisible();
  await page.getByLabel("Ordenar conversas").selectOption("waiting");
  await expect(page.locator(".conversation-row").first()).toContainText("Contato em tempo real");
  await page.getByRole("button", { name: "Não atribuídas" }).click();
  await expect(page.getByRole("button", { name: /Maria Oliveira/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Todas" }).click();
  const mobileBack = page.getByRole("button", { name: "Voltar às conversas" });
  if (await mobileBack.isVisible()) await mobileBack.click();
  await page.getByRole("button", { name: /Contato em tempo real/ }).click();
  await expect(page.getByLabel("1 mensagem não lida")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Contato em tempo real/ }).locator(".conversation-assignee")).toContainText("Ana Karrer atendendo");
});

test("usuário somente de Leads recebe novas conversas pelo WebSocket", async ({ page }) => {
  let additionalConversations: unknown[] = [];
  let inboxSocket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/conversations\/ws$/, (socket) => { inboxSocket = socket; });
  await mockDashboard(page, () => additionalConversations, undefined, { chat: false, leads: true, clients: false, settings: false });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await expect.poll(() => Boolean(inboxSocket)).toBe(true);
  additionalConversations = [{
    id: "conversation-2", contactId: "contact-2", createdAt: now, name: "Lead novo", phone: "5592888888888",
    bank: null, stage: "Primeiro contato", classification: "warm", score: 50, lastMessage: "Olá",
    lastMessageType: "text", lastMessageAt: now, unreadCount: 1, online: false, lastSeenAt: null,
    waitingSince: now, serviceStatus: "new", assigneeId: null, assigneeName: null, avatarUrl: null,
  }];
  inboxSocket!.send(JSON.stringify({ type: "conversation.updated" }));
  await expect(page.getByText("Lead novo")).toBeVisible();
});

test("ao voltar para a aba recupera conversa e mensagem sem evento WebSocket", async ({ page }) => {
  let additionalConversations: unknown[] = [];
  let recentMessages: unknown[] = [];
  await page.routeWebSocket(/\/api\/conversations\/ws$/, () => undefined);
  await page.routeWebSocket(/\/api\/conversations\/[^/]+\/ws$/, () => undefined);
  await mockDashboard(page, () => additionalConversations, () => ({ messages: recentMessages, hasMore: false, nextCursor: null }));
  await page.goto("/");
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  additionalConversations = [{
    id: "conversation-2", contactId: "contact-2", createdAt: now, name: "Conversa recuperada", phone: "5592888888888",
    bank: null, stage: "Primeiro contato", classification: "warm", score: 50, lastMessage: "Nova mensagem",
    lastMessageType: "text", lastMessageAt: now, unreadCount: 1, online: false, lastSeenAt: null,
    waitingSince: now, serviceStatus: "new", assigneeId: null, assigneeName: null, avatarUrl: null,
  }];
  recentMessages = [{ id: "missed-1", conversationId: "conversation-1", direction: "inbound", type: "text", body: "Mensagem recuperada", fileName: null, mediaKey: null, duration: null, status: "received", createdAt: now }];
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByRole("button", { name: /Conversa recuperada/ })).toBeVisible();
  await expect(page.getByText("Mensagem recuperada")).toBeVisible();
});

test("histórico carrega 40 mensagens e busca as anteriores ao rolar", async ({ page }) => {
  let initialLimit = "";
  let olderRequested = false;
  const makeMessage = (id: string, body: string, minute: number) => ({
    id, conversationId: "conversation-1", direction: "inbound", type: "text", body,
    fileName: null, mediaKey: null, duration: null, status: "received", createdAt: new Date(Date.now() - minute * 60_000).toISOString(),
  });
  await mockDashboard(page, () => [], (url) => {
    initialLimit = url.searchParams.get("limit") ?? "";
    if (url.searchParams.has("before")) {
      olderRequested = true;
      return { messages: [makeMessage("older-1", "Mensagem mais antiga carregada", 42)], hasMore: false, nextCursor: null };
    }
    return {
      messages: Array.from({ length: 40 }, (_, index) => makeMessage(`recent-${index}`, `Mensagem recente ${index + 1}`, 40 - index)),
      hasMore: true,
      nextCursor: "cursor-40",
    };
  });
  await page.goto("/");
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  await expect(page.getByText("Mensagem recente 40")).toBeVisible();
  expect(initialLimit).toBe("40");

  await page.locator(".messages").evaluate((element) => { element.scrollTop = 0; element.dispatchEvent(new Event("scroll")); });
  await expect.poll(() => olderRequested).toBe(true);
  await expect(page.getByText("Mensagem mais antiga carregada")).toBeAttached();
});

test("ícone de imagem envia arquivo pelo compositor", async ({ page }) => {
  await page.routeWebSocket(/\/api\/conversations\/ws$/, () => undefined);
  await page.routeWebSocket(/\/api\/conversations\/[^/]+\/ws$/, () => undefined);
  await mockDashboard(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Enviar imagem" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("imagem") });
  await expect(page.getByRole("region", { name: "Prévia do arquivo" })).toBeVisible();
  await expect(page.getByAltText("Prévia da imagem")).toBeVisible();
  await page.getByLabel("Mensagem").fill("Posso continuar escrevendo durante a prévia");
  await expect(page.getByLabel("Mensagem")).toBeEditable();
  await page.getByRole("button", { name: "Enviar arquivo" }).click();
  await expect(page.locator('img[alt="Imagem de teste"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Anexar documento" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Gravar áudio" })).toBeEnabled();
});

test("áudio pode ser ouvido antes do envio sem bloquear a escrita", async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const track = { stop: () => undefined };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({ getTracks: () => [track] }) } });
    class MockMediaRecorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      start() { this.state = "recording"; }
      stop() { this.state = "inactive"; this.ondataavailable?.({ data: new Blob(["audio"], { type: this.mimeType }) }); this.onstop?.(); }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: MockMediaRecorder });
  });
  await mockDashboard(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  await page.getByRole("button", { name: "Gravar áudio" }).click();
  await expect(page.getByRole("button", { name: "Parar gravação" })).toBeVisible();
  await page.getByLabel("Mensagem").fill("Texto continua liberado");
  await expect(page.getByLabel("Mensagem")).toBeEditable();
  await page.getByRole("button", { name: "Parar gravação" }).click();
  await expect(page.getByText("Ouça antes de enviar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Ouvir prévia do áudio" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Posição da prévia do áudio" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Enviar áudio" })).toBeVisible();
  await expect(page.locator(".attachment-preview audio")).toBeAttached();
  if (process.env.CAPTURE_UI) await page.screenshot({ path: `tmp/${testInfo.project.name}-audio-preview.png`, fullPage: true });
});

test("confirmação muda de enviado para entregue e lido em tempo real", async ({ page }) => {
  let conversationSocket: WebSocketRoute | null = null;
  await page.routeWebSocket(/\/api\/conversations\/ws$/, () => undefined);
  await page.routeWebSocket(/\/api\/conversations\/conversation-1\/ws$/, (socket) => { conversationSocket = socket; });
  const message = { id: "outbound-1", conversationId: "conversation-1", direction: "outbound", type: "text", body: "Mensagem acompanhada", fileName: null, mediaKey: null, duration: null, status: "sent", createdAt: now };
  await mockDashboard(page, () => [], () => ({ messages: [message], hasMore: false, nextCursor: null }));
  await page.goto("/");
  await page.getByRole("button", { name: /Maria Oliveira/ }).click();
  await expect(page.locator(".message-status")).toContainText("Enviado");
  await expect(page.getByText(/Visto por último/)).toBeVisible();
  await expect.poll(() => Boolean(conversationSocket)).toBe(true);
  conversationSocket!.send(JSON.stringify({ type: "message.status", messageId: "outbound-1", status: "delivered" }));
  await expect(page.locator(".message-status")).toContainText("Entregue");
  conversationSocket!.send(JSON.stringify({ type: "message.status", messageId: "outbound-1", status: "read" }));
  await expect(page.locator(".message-status")).toContainText("Lido");
});
