import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";

const now = new Date().toISOString();

async function mockAnonymous(page: Page) {
  await page.route("**/api/auth/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ setupRequired: false, user: null, features: { googleDrive: false } }),
  }));
}

async function mockDashboard(page: Page, additionalConversations: () => unknown[] = () => []) {
  const permissions = { chat: true, leads: true, clients: true, settings: true };
  const user = { id: "admin-1", name: "Ana Karrer", email: "ana@karrer.test", role: "admin", avatarUrl: null, professionalRole: "Administradora", permissions };
  const conversations = [{
    id: "conversation-1", contactId: "contact-1", createdAt: now, name: "Maria Oliveira", phone: "5592999999999",
    bank: "Banco Exemplo", stage: "Documentação", classification: "hot", score: 86, lastMessage: "Enviei os documentos",
    lastMessageType: "text", lastMessageAt: now, unreadCount: 2, online: true, lastSeenAt: now, assigneeName: "Ana Karrer",
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
    const path = new URL(route.request().url()).pathname;
    let body: unknown = { ok: true };
    if (path === "/api/auth/status") body = { setupRequired: false, user, features: { googleDrive: false } };
    else if (path === "/api/conversations") body = { conversations: [...conversations, ...additionalConversations()] };
    else if (path === "/api/contacts") body = { contacts };
    else if (path === "/api/leads/summary") body = { total: 1, hot: 1, warm: 0, cold: 0, averageFirstResponseMinutes: 4, daily: [] };
    else if (path === "/api/settings/users") body = { users };
    else if (path.endsWith("/media") && route.request().method() === "POST") body = { message: { id: "message-upload", conversationId: "conversation-1", direction: "outbound", type: "image", body: "Imagem de teste", fileName: "foto.png", mediaKey: "uploads/test/foto.png", duration: null, status: "sent", createdAt: now } };
    else if (path.endsWith("/messages")) body = { messages: [] };
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

  await page.getByRole("button", { name: "Leads" }).click();
  await expect(page.getByRole("heading", { name: "Leads", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Filtrar por hora de entrada" }).click();
  await expect(page.getByRole("dialog", { name: "Hora de entrada" })).toBeVisible();
  await page.getByRole("button", { name: /Todos os horários/ }).click();
  if (testInfo.project.name === "desktop") await testInfo.attach("leads-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  if (process.env.CAPTURE_UI) await page.screenshot({ path: `tmp/${testInfo.project.name}-leads-page.png`, fullPage: true });

  await page.getByRole("button", { name: "Clientes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Cadastro de clientes" })).toBeVisible();
  await expect(page.getByText("Cadastros completos")).toBeVisible();
  await expect(page.getByText("Com banco informado")).toBeVisible();
  if (testInfo.project.name === "desktop") await testInfo.attach("clients-page", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  if (process.env.CAPTURE_UI) await page.screenshot({ path: `tmp/${testInfo.project.name}-clients-page.png`, fullPage: true });

  await page.getByRole("button", { name: "Configurações" }).click();
  await expect(page.getByRole("heading", { name: "Configurações" })).toBeVisible();
  await expect(page.getByText("Equipe online")).toBeVisible();
  await expectNoHorizontalOverflow(page);
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
    lastMessageType: "text", lastMessageAt: new Date().toISOString(), unreadCount: 1, online: false, lastSeenAt: null, assigneeName: null,
  }];
  inboxSocket!.send(JSON.stringify({ type: "conversation.updated" }));

  await expect(page.getByRole("button", { name: /Contato em tempo real/ })).toBeVisible();
});

test("ícone de imagem envia arquivo pelo compositor", async ({ page }) => {
  await page.routeWebSocket(/\/api\/conversations\/ws$/, () => undefined);
  await page.routeWebSocket(/\/api\/conversations\/[^/]+\/ws$/, () => undefined);
  await mockDashboard(page);
  await page.goto("/");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Enviar imagem" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "foto.png", mimeType: "image/png", buffer: Buffer.from("imagem") });
  await expect(page.locator('img[alt="Imagem de teste"]')).toBeVisible();
  await expect(page.getByRole("button", { name: "Anexar documento" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Gravar áudio" })).toBeEnabled();
});
