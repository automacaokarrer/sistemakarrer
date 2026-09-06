import {
  ArrowLeft,
  CheckCheck,
  ChevronDown,
  CircleUserRound,
  Download,
  FileText,
  Image,
  LoaderCircle,
  LogOut,
  KeyRound,
  Mail,
  Menu,
  MessageCircle,
  Mic,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Trash2,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, formatTime, initials } from "./api";
import type { AuthStatus, Classification, Contact, Conversation, LeadSummary, ManagedUser, Message, Permissions, User } from "./types";

type View = "chat" | "leads" | "clients" | "lead" | "settings";
type ConversationFilter = "all" | "unread" | "hot";

const classificationLabel: Record<Classification, string> = { hot: "Quente", warm: "Morno", cold: "Frio" };
const resetToken = new URLSearchParams(location.search).get("reset");
const activationEmail = new URLSearchParams(location.search).get("activate");

function App() {
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [authError, setAuthError] = useState("");

  const loadAuth = useCallback(async () => {
    setAuthError("");
    try {
      setAuth(await api<AuthStatus>("/api/auth/status"));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "API indisponível");
    }
  }, []);

  useEffect(() => void loadAuth(), [loadAuth]);

  if (resetToken) return <ResetPasswordScreen token={resetToken} />;
  if (activationEmail) return <ActivateAccountScreen email={activationEmail} />;

  if (!auth) {
    return (
      <div className="splash">
        <Brand />
        {authError ? (
          <div className="setup-error"><p>{authError}</p><button onClick={() => void loadAuth()}>Tentar novamente</button></div>
        ) : <LoaderCircle className="spin" />}
      </div>
    );
  }

  if (!auth.user) return <AuthScreen setupRequired={auth.setupRequired} onAuthenticated={loadAuth} />;
  return <Dashboard user={auth.user} onLogout={() => setAuth({ setupRequired: false, user: null })} />;
}

function ActivateAccountScreen({ email }: { email: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) { setError("As senhas não coincidem."); return; }
    setBusy(true); setError("");
    try {
      await api("/api/auth/activate", { method: "POST", body: JSON.stringify({ email, code: data.get("code"), password }) });
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar o acesso."); }
    finally { setBusy(false); }
  }
  if (done) return <main className="auth-page"><section className="auth-brand"><Brand /><p>Seu acesso foi confirmado com segurança.</p></section><div className="auth-card"><span className="eyebrow">Conta ativada</span><h1>Tudo pronto</h1><p>Sua senha foi criada. Você já pode entrar no sistema.</p><button className="primary wide" onClick={() => { history.replaceState({}, "", "/"); location.reload(); }}>Ir para o login</button></div></main>;
  return <main className="auth-page"><section className="auth-brand"><Brand /><p>Confirme seu e-mail e escolha uma senha pessoal.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">Primeiro acesso</span><h1>Confirmar acesso</h1><p className="auth-helper">Enviamos um código para <strong>{email}</strong>.</p><Field label="Código de 6 dígitos" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required /><Field label="Criar senha" name="password" type="password" minLength={10} required /><Field label="Confirmar senha" name="confirmation" type="password" minLength={10} required />{error && <p className="form-error">{error}</p>}<button className="primary wide" disabled={busy}>{busy ? "Confirmando..." : "Confirmar e acessar"}</button></form></main>;
}

function ResetPasswordScreen({ token }: { token: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (password !== String(data.get("confirmation") ?? "")) { setError("As senhas não coincidem."); return; }
    setBusy(true); setError("");
    try {
      await api("/api/auth/reset-password", { method: "POST", body: JSON.stringify({ token, password }) });
      history.replaceState({}, "", "/");
      location.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível redefinir a senha."); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><section className="auth-brand"><Brand /><p>Crie uma nova senha para continuar com segurança.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">Recuperação de acesso</span><h1>Redefinir senha</h1><Field label="Nova senha" name="password" type="password" minLength={10} required /><Field label="Confirmar nova senha" name="confirmation" type="password" minLength={10} required />{error && <p className="form-error">{error}</p>}<button className="primary wide" disabled={busy}>{busy ? "Salvando..." : "Salvar nova senha"}</button></form></main>;
}

function AuthScreen({ setupRequired, onAuthenticated }: { setupRequired: boolean; onAuthenticated: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const payload = Object.fromEntries(data.entries());
      await api(setupRequired ? "/api/auth/bootstrap" : "/api/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      await onAuthenticated();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-brand">
        <Brand />
        <p>Atendimento jurídico, relacionamento e documentos em um só lugar.</p>
      </section>
      <form className="auth-card" onSubmit={submit}>
        <span className="eyebrow">{setupRequired ? "Configuração inicial" : "Acesso seguro"}</span>
        <h1>{setupRequired ? "Criar administrador" : "Entrar no sistema"}</h1>
        {setupRequired && <Field label="Nome completo" name="name" autoComplete="name" required />}
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        <Field label="Senha" name="password" type="password" autoComplete={setupRequired ? "new-password" : "current-password"} minLength={10} required />
        {setupRequired && <Field label="Código de inicialização" name="bootstrapToken" type="password" required />}
        {error && <p className="form-error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "Aguarde..." : setupRequired ? "Criar acesso" : "Entrar"}</button>
      </form>
    </main>
  );
}

function Dashboard({ user, onLogout }: { user: User; onLogout: () => void }) {
  const firstView: View = user.permissions.chat ? "chat" : user.permissions.leads ? "leads" : user.permissions.clients ? "clients" : "settings";
  const [view, setView] = useState<View>(firstView);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<LeadSummary>({ total: 0, hot: 0, warm: 0, cold: 0, averageFirstResponseMinutes: 0, daily: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(user.permissions.chat || user.permissions.leads);

  const reloadConversations = useCallback(async () => {
    setLoading(true);
    try {
      const conversationData = await api<{ conversations: Conversation[] }>("/api/conversations");
      setConversations(conversationData.conversations);
      setSelectedId((current) => current ?? conversationData.conversations[0]?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    const data = await api<{ contacts: Contact[] }>("/api/contacts");
    setContacts(data.contacts);
  }, []);

  const loadSummary = useCallback(async () => {
    setSummary(await api<LeadSummary>("/api/leads/summary"));
  }, []);

  const refreshLeads = useCallback(async () => {
    await Promise.all([reloadConversations(), loadSummary()]);
  }, [loadSummary, reloadConversations]);

  const refreshClients = useCallback(async () => {
    await Promise.all([reloadConversations(), loadContacts()]);
  }, [loadContacts, reloadConversations]);

  useEffect(() => { if (user.permissions.chat || user.permissions.leads) void reloadConversations(); }, [reloadConversations, user.permissions.chat, user.permissions.leads]);
  useEffect(() => {
    if (view === "leads" || view === "lead") void loadSummary();
    if (view === "clients") void loadContacts();
  }, [loadContacts, loadSummary, view]);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    onLogout();
  }

  function navigate(next: View) {
    setView(next);
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} user={user} unread={conversations.reduce((sum, item) => sum + item.unreadCount, 0)} onNavigate={navigate} onLogout={logout} />
      <main className="workspace">
        {loading ? <div className="page-loader"><LoaderCircle className="spin" /> Carregando atendimento...</div> : null}
        {view === "chat" && user.permissions.chat && <ChatPage conversations={conversations} selected={selected} onSelect={setSelectedId} onOpenLead={() => setView("lead")} onRefresh={reloadConversations} />}
        {view === "leads" && user.permissions.leads && <LeadsPage conversations={conversations} summary={summary} onOpen={(id) => { setSelectedId(id); setView("lead"); }} onRefresh={refreshLeads} />}
        {view === "lead" && user.permissions.leads && <LeadDetail conversation={selected} onBack={() => setView("leads")} onChat={() => user.permissions.chat && setView("chat")} onRefresh={refreshLeads} />}
        {view === "clients" && user.permissions.clients && <ClientsPage contacts={contacts} onRefresh={refreshClients} />}
        {view === "settings" && user.permissions.settings && <SettingsPage currentUser={user} />}
      </main>
    </div>
  );
}

function Sidebar({ view, user, unread, onNavigate, onLogout }: { view: View; user: User; unread: number; onNavigate: (view: View) => void; onLogout: () => Promise<void> }) {
  const allItems: Array<{ id: View; label: string; icon: typeof MessageCircle; allowed: boolean }> = [
    { id: "chat", label: "Chat de atendimento", icon: MessageCircle, allowed: user.permissions.chat },
    { id: "leads", label: "Leads", icon: Users, allowed: user.permissions.leads },
    { id: "clients", label: "Cadastro de clientes", icon: Plus, allowed: user.permissions.clients },
  ];
  const items = allItems.filter((item) => item.allowed);
  return (
    <aside className="sidebar">
      <div className="accent-line" />
      <div className="sidebar-inner">
        <Brand />
        <span className="sidebar-label">Atendimento</span>
        <nav>
          {items.map(({ id, label, icon: Icon }) => (
            <button key={id} className={(view === id || (view === "lead" && id === "leads")) ? "active" : ""} onClick={() => onNavigate(id)}>
              <Icon size={18} /><span>{label}</span>{id === "chat" && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
        </nav>
        {user.permissions.settings && <button className={`settings-nav ${view === "settings" ? "active" : ""}`} title="Configurações" aria-label="Configurações" onClick={() => onNavigate("settings")}><Settings size={19} /></button>}
        <div className="sidebar-user">
          <Avatar name={user.name} size="sm" />
          <span><strong>{user.name}</strong><small>Disponível</small></span>
          <button title="Sair" onClick={() => void onLogout()}><LogOut size={17} /></button>
        </div>
      </div>
    </aside>
  );
}

function ChatPage({ conversations, selected, onSelect, onOpenLead, onRefresh }: { conversations: Conversation[]; selected: Conversation | null; onSelect: (id: string | null) => void; onOpenLead: () => void; onRefresh: () => Promise<void> }) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [search, setSearch] = useState("");
  const filtered = conversations.filter((item) => {
    const matchesFilter = filter === "all" || (filter === "unread" && item.unreadCount > 0) || (filter === "hot" && item.classification === "hot");
    return matchesFilter && `${item.name} ${item.phone}`.toLowerCase().includes(search.toLowerCase());
  });
  return (
    <section className="chat-layout">
      <div className="conversation-list">
        <header><h1>Conversas</h1><span>{conversations.reduce((sum, item) => sum + item.unreadCount, 0)} não lidas</span></header>
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome ou telefone" />
        <div className="chips">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todas</Chip>
          <Chip active={filter === "unread"} onClick={() => setFilter("unread")}>Não lidas</Chip>
          <Chip active={filter === "hot"} onClick={() => setFilter("hot")}>Quentes</Chip>
        </div>
        <div className="conversation-scroll">
          {filtered.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={selected?.id === conversation.id} onClick={() => onSelect(conversation.id)} />)}
          {filtered.length === 0 && <Empty text="Nenhuma conversa encontrada." />}
        </div>
      </div>
      {selected ? <ConversationPanel conversation={selected} onBack={() => onSelect(null)} onOpenLead={onOpenLead} onRefresh={onRefresh} /> : <Empty text="Selecione uma conversa para começar." large />}
    </section>
  );
}

function ConversationPanel({ conversation, onBack, onOpenLead, onRefresh }: { conversation: Conversation; onBack: () => void; onOpenLead: () => void; onRefresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<{ messages: Message[] }>(`/api/conversations/${conversation.id}/messages?limit=40`);
      setMessages(data.messages);
      requestAnimationFrame(() => endRef.current?.scrollIntoView());
    } finally {
      setLoading(false);
    }
  }, [conversation.id]);

  useEffect(() => void loadMessages(), [loadMessages]);
  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/api/conversations/${conversation.id}/ws`);
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string; message?: Message };
        if (data.type === "message.new" && data.message) {
          setMessages((current) => current.some((item) => item.id === data.message?.id) ? current : [...current, data.message!]);
        }
      } catch { /* mensagens de controle são ignoradas */ }
    };
    return () => socket.close(1000, "conversation changed");
  }, [conversation.id]);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const result = await api<{ message: Message }>(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setText("");
      await onRefresh();
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="conversation-panel">
      <header className="chat-header">
        <button className="mobile-back" aria-label="Voltar às conversas" onClick={onBack}><ArrowLeft size={20} /></button>
        <Avatar name={conversation.name} online={conversation.online} />
        <div><h2>{conversation.name}</h2><p>{conversation.online ? <em>Online</em> : `Visto por último ${formatTime(conversation.lastSeenAt)}`} <ClassificationBadge value={conversation.classification} /></p></div>
        <button className="primary" onClick={onOpenLead}>Ver ficha do lead</button><button className="icon-button"><Menu size={19} /></button>
      </header>
      <div className="messages">
        {loading && <div className="loading-messages"><LoaderCircle className="spin" size={15} /> Carregando mensagens...</div>}
        <div className="date-pill">Hoje</div>
        {messages.map((message) => <MessageBubble key={message.id} message={message} />)}
        {!loading && messages.length === 0 && <Empty text="Ainda não há mensagens nesta conversa." dark />}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={sendMessage}>
        <button type="button" title="Anexar documento"><Paperclip size={20} /></button><button type="button" title="Enviar imagem"><Image size={19} /></button>
        <textarea aria-label="Mensagem" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Escreva uma mensagem" rows={1} />
        <button className="send-button" aria-label={text.trim() ? "Enviar" : "Gravar áudio"}>{text.trim() ? <Send size={19} /> : <Mic size={19} />}</button>
      </form>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  return (
    <div className={`message-row ${message.direction}`}>
      <div className={`bubble ${message.type}`}>
        {message.type === "image" && <div className="media-placeholder"><Image /></div>}
        {message.type === "audio" && <div className="audio-player"><button><Play size={15} fill="currentColor" /></button><span /><small>{message.duration ? `${message.duration}s` : "0:42"}</small></div>}
        {message.type === "document" && <div className="document-message"><FileText /><span><strong>{message.fileName ?? message.body ?? "Documento"}</strong><small>Documento</small></span></div>}
        {message.body && message.type === "text" && <p>{message.body}</p>}
        <footer>{formatTime(message.createdAt)} {message.direction === "outbound" && <><span>· {message.status === "read" ? "Lido" : message.status === "failed" ? "Não enviado" : "Enviado"}</span><CheckCheck size={12} /></>}</footer>
      </div>
    </div>
  );
}

function LeadsPage({ conversations, summary, onOpen, onRefresh }: { conversations: Conversation[]; summary: LeadSummary; onOpen: (id: string) => void; onRefresh: () => Promise<void> }) {
  const [filter, setFilter] = useState<"all" | Classification>("all");
  const [search, setSearch] = useState("");
  const leads = conversations.filter((item) => (filter === "all" || item.classification === filter) && `${item.name} ${item.phone}`.toLowerCase().includes(search.toLowerCase()));

  async function updateClassification(id: string, classification: Classification) {
    await api(`/api/leads/${id}/classification`, { method: "PATCH", body: JSON.stringify({ classification }) });
    await onRefresh();
  }

  return (
    <section className="page leads-page">
      <div className="page-heading"><div><h1>Leads</h1><p>Atualizado agora · {summary.total} contatos</p></div><div className="heading-actions"><button className="select-button">Últimos 30 dias <ChevronDown size={15} /></button><button className="select-button">Todos os atendentes <ChevronDown size={15} /></button><button className="primary"><Download size={16} /> Exportar relatório</button></div></div>
      <div className="kpi-grid">
        <Kpi label="Total de leads" value={summary.total} dark detail="visão consolidada" />
        <Kpi label="Quentes" value={summary.hot} tone="hot" detail="prioridade imediata" />
        <Kpi label="Mornos" value={summary.warm} tone="warm" detail="em acompanhamento" />
        <Kpi label="Frios" value={summary.cold} tone="cold" detail="reativação futura" />
      </div>
      <div className="chart-grid">
        <div className="card chart-card"><header><strong>Novos leads por dia</strong><span>Média do período</span></header><div className="bar-chart">{(summary.daily.length ? summary.daily : Array.from({ length: 12 }, (_, index) => ({ day: String(index), total: [4, 7, 3, 9, 6, 8, 11, 5, 7, 4, 8, 6][index] }))).map((item, index, rows) => <i key={item.day} title={`${item.day}: ${item.total}`} style={{ height: `${Math.max(18, (item.total / Math.max(...rows.map((row) => row.total), 1)) * 100)}%` }} className={index === 6 ? "peak" : ""} />)}</div></div>
        <div className="card donut-card"><div className="donut" style={{ background: `conic-gradient(var(--hot) 0 ${summary.total ? (summary.hot / summary.total) * 100 : 33}%, var(--taupe) 0 ${summary.total ? ((summary.hot + summary.warm) / summary.total) * 100 : 66}%, var(--cold) 0)` }}><span>{summary.total}</span></div><div><p><b className="dot hot" /> Quente · {summary.total ? Math.round(summary.hot / summary.total * 100) : 0}%</p><p><b className="dot warm" /> Morno · {summary.total ? Math.round(summary.warm / summary.total * 100) : 0}%</p><p><b className="dot cold" /> Frio · {summary.total ? Math.round(summary.cold / summary.total * 100) : 0}%</p><small>Tempo médio de 1ª resposta<br /><strong>{summary.averageFirstResponseMinutes || 0} min</strong></small></div></div>
      </div>
      <div className="card leads-table">
        <div className="table-toolbar"><div className="chips"><Chip active={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>{(["hot", "warm", "cold"] as Classification[]).map((value) => <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>{classificationLabel[value]}s</Chip>)}</div><SearchBox value={search} onChange={setSearch} placeholder="Buscar lead" /></div>
        <div className="lead-row lead-head"><span>Nome</span><span>Telefone</span><span>Classificação</span><span>Etapa</span><span>Último contato</span><span /></div>
        {leads.map((lead) => <div className="lead-row" key={lead.id}><span className="person"><Avatar name={lead.name} size="xs" /><strong>{lead.name}</strong></span><span>{lead.phone}</span><span><select className={`classification-select ${lead.classification}`} value={lead.classification} onChange={(event) => void updateClassification(lead.id, event.target.value as Classification)}><option value="hot">Quente</option><option value="warm">Morno</option><option value="cold">Frio</option></select></span><span>{lead.stage}</span><span>{formatTime(lead.lastMessageAt)}</span><button onClick={() => onOpen(lead.id)}>Abrir ficha →</button></div>)}
        {leads.length === 0 && <Empty text="Nenhum lead neste filtro." />}
      </div>
    </section>
  );
}

function LeadDetail({ conversation, onBack, onChat, onRefresh }: { conversation: Conversation | null; onBack: () => void; onChat: () => void; onRefresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [note, setNote] = useState("");
  useEffect(() => { if (conversation) void api<{ messages: Message[] }>(`/api/conversations/${conversation.id}/messages?limit=100`).then((data) => setMessages(data.messages)); }, [conversation]);
  if (!conversation) return <Empty text="Selecione um lead." large />;
  const current = conversation;
  async function classify(value: Classification) { await api(`/api/leads/${current.id}/classification`, { method: "PATCH", body: JSON.stringify({ classification: value }) }); await onRefresh(); }
  async function saveNote() { if (!note.trim()) return; await api(`/api/conversations/${current.id}/notes`, { method: "POST", body: JSON.stringify({ body: note.trim() }) }); setNote(""); }
  return (
    <section className="page detail-page">
      <header className="lead-hero"><button onClick={onBack}><ArrowLeft size={17} /> Leads</button><Avatar name={conversation.name} /><div><h1>{conversation.name}</h1><p>{conversation.phone} · <em>{conversation.online ? "Online" : "Offline"}</em> · Origem: WhatsApp</p></div><button className="primary" onClick={onChat}>Abrir chat</button><button className="outline">Editar cadastro</button></header>
      <div className="detail-grid"><div className="card history-card"><div className="tabs"><button className="active">Histórico da conversa</button><button>Mídias e documentos</button><button>Anotações</button><button>Linha do tempo</button></div><div className="history-list">{messages.map((message) => <div key={message.id}><time>{new Date(message.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><p><strong>{message.direction === "inbound" ? conversation.name.split(" ")[0] : "Karrer"}</strong> — {message.type === "text" ? message.body : `${message.type === "audio" ? "Áudio" : message.type === "image" ? "Imagem" : "Documento"}${message.body ? ` · ${message.body}` : ""}`}</p></div>)}</div><footer>Histórico somente leitura · para responder, abra o chat.</footer></div>
        <aside className="detail-aside"><div className="classification-card"><span className="eyebrow">Classificação</span><div className="segmented">{(["hot", "warm", "cold"] as Classification[]).map((value) => <button key={value} className={conversation.classification === value ? value : ""} onClick={() => void classify(value)}>{classificationLabel[value]}</button>)}</div><p><span>Pontuação</span><strong>{conversation.score} / 100</strong></p><progress max="100" value={conversation.score} /><ul><li>Respondeu em menos de 5 min</li><li>Enviou documentação</li><li>Interações recentes</li><li className="pending">Contrato de honorários pendente</li></ul></div><div className="card data-card"><span className="eyebrow">Dados do cliente</span><dl><dt>Telefone</dt><dd>{conversation.phone}</dd><dt>Banco</dt><dd>{conversation.bank ?? "Não informado"}</dd><dt>Etapa</dt><dd><strong>{conversation.stage}</strong></dd><dt>Responsável</dt><dd>{conversation.assigneeName ?? "Não atribuído"}</dd></dl></div><div className="card notes-card"><span className="eyebrow">Anotações internas</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Adicionar nota..." /><button className="primary" onClick={() => void saveNote()}>Salvar nota</button></div></aside></div>
    </section>
  );
}

function ClientsPage({ contacts, onRefresh }: { contacts: Contact[]; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const visible = contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(search.toLowerCase()));
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); try { const data = Object.fromEntries(new FormData(event.currentTarget).entries()); await api("/api/contacts", { method: "POST", body: JSON.stringify(data) }); event.currentTarget.reset(); await onRefresh(); } finally { setBusy(false); } }
  return (
    <section className="page clients-page"><div className="page-heading"><div><h1>Cadastro de clientes</h1><p>O número de WhatsApp vincula o cadastro às conversas recebidas</p></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar cliente" /></div><div className="clients-grid"><form className="card client-form" onSubmit={submit}><div className="form-title"><CircleUserRound size={32} /><div><h2>Novo cliente</h2><p>Campos com * são obrigatórios</p></div></div><span className="eyebrow">Dados pessoais</span><div className="form-grid"><Field label="Nome completo *" name="name" required /><Field label="WhatsApp *" name="phone" placeholder="5592999999999" required /><Field label="CPF *" name="cpf" placeholder="000.000.000-00" required /><Field label="RG · Órgão emissor" name="rg" /><Field label="Data de nascimento" name="birthDate" type="date" /><Field label="E-mail" name="email" type="email" /></div><span className="eyebrow">Endereço</span><div className="form-grid address"><Field label="Logradouro e número" name="addressLine" /><Field label="Cidade" name="city" /><Field label="UF" name="state" maxLength={2} /><Field label="CEP" name="postalCode" /></div><span className="eyebrow">Atendimento</span><div className="form-grid thirds"><Field label="Banco / Financeira" name="bank" /><label>Classificação inicial<select name="classification" defaultValue="warm"><option value="hot">Quente</option><option value="warm">Morno</option><option value="cold">Frio</option></select></label><Field label="CCB" name="ccb" /></div><label className="dropzone"><Paperclip /> <span>Documentos poderão ser anexados após salvar o cliente</span></label><div className="form-actions"><button type="reset" className="outline">Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando..." : "Salvar cliente"}</button></div></form><aside className="card recent-card"><header><h2>Recentes</h2><span>{contacts.length} cadastrados</span></header>{visible.slice(0, 8).map((contact) => <div className="recent-person" key={contact.id}><Avatar name={contact.name} size="xs" /><span><strong>{contact.name ?? contact.phone}</strong><small>{contact.bank ?? "Sem banco informado"}</small></span><i /></div>)}{visible.length === 0 && <Empty text="Nenhum cliente encontrado." />}<div className="pending-box"><strong>{contacts.filter((item) => !item.profileComplete).length} contatos pendentes de cadastro</strong><span>Chegaram pelo WhatsApp sem ficha completa.</span></div></aside></div></section>
  );
}

type SettingsModal = { kind: "create" | "password" | "delete" | "email"; user?: ManagedUser } | null;
const accessLabels: Array<{ key: keyof Permissions; label: string }> = [
  { key: "chat", label: "Chat" }, { key: "leads", label: "Leads" }, { key: "clients", label: "Clientes" }, { key: "settings", label: "Configurações" },
];

function SettingsPage({ currentUser }: { currentUser: User }) {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [modal, setModal] = useState<SettingsModal>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const loadUsers = useCallback(async () => {
    const data = await api<{ users: ManagedUser[] }>("/api/settings/users");
    setUsers(data.users);
  }, []);
  useEffect(() => void loadUsers(), [loadUsers]);

  function open(next: SettingsModal) { setError(""); setNotice(""); setModal(next); }
  async function updateAccess(user: ManagedUser, patch: { active?: boolean; permission?: keyof Permissions }) {
    if (user.role === "admin") return;
    const next = { ...user, active: patch.active ?? user.active, permissions: { ...user.permissions } };
    if (patch.permission) next.permissions[patch.permission] = !next.permissions[patch.permission];
    setUsers((current) => current.map((item) => item.id === user.id ? next : item));
    try {
      await api(`/api/settings/users/${user.id}/access`, { method: "PATCH", body: JSON.stringify({ active: next.active, permissions: next.permissions }) });
      setNotice("Acessos atualizados no banco.");
    } catch (reason) { await loadUsers(); setError(reason instanceof Error ? reason.message : "Não foi possível atualizar os acessos."); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    const permissions = Object.fromEntries(accessLabels.map(({ key }) => [key, data.get(key) === "on"]));
    try {
      await api("/api/settings/users", { method: "POST", body: JSON.stringify({ name: data.get("name"), email: data.get("email"), permissions }) });
      await loadUsers(); setModal(null); setNotice("Convite enviado. O usuário deve confirmar o e-mail e criar a própria senha.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível criar o usuário."); }
    finally { setBusy(false); }
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    const data = new FormData(event.currentTarget);
    if (data.get("newPassword") !== data.get("confirmation")) { setError("As senhas não coincidem."); setBusy(false); return; }
    try {
      await api("/api/settings/change-password", { method: "POST", body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword") }) });
      setModal(null); setNotice("Sua senha foi alterada com segurança.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível alterar a senha."); }
    finally { setBusy(false); }
  }

  async function removeUser() {
    if (!modal?.user) return; setBusy(true); setError("");
    try { await api(`/api/settings/users/${modal.user.id}`, { method: "DELETE" }); await loadUsers(); setModal(null); setNotice("Usuário excluído."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível excluir o usuário."); }
    finally { setBusy(false); }
  }

  async function emailReset() {
    if (!modal?.user) return; setBusy(true); setError("");
    try { await api(`/api/settings/users/${modal.user.id}/send-password-reset`, { method: "POST" }); setModal(null); setNotice("Link de redefinição enviado por e-mail."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar o e-mail."); }
    finally { setBusy(false); }
  }

  return <section className="page settings-page">
    <div className="page-heading settings-heading"><div><span className="eyebrow">Administração</span><h1>Configurações</h1><p>Gerencie segurança, usuários e acessos por área.</p></div><button className="primary" onClick={() => open({ kind: "create" })}><UserPlus size={17} /> Novo usuário</button></div>
    {notice && <div className="notice success">{notice}</div>}{error && !modal && <div className="notice error">{error}</div>}
    <div className="settings-overview">
      <div className="card security-card"><div className="settings-icon"><ShieldCheck /></div><div><span className="eyebrow">Minha conta</span><h2>{currentUser.name}</h2><p>{currentUser.email} · {currentUser.role === "admin" ? "Administrador mestre" : "Acesso administrativo"}</p></div><button className="outline" onClick={() => open({ kind: "password" })}><KeyRound size={16} /> Alterar minha senha</button></div>
      <div className="card access-summary"><span className="eyebrow">Equipe</span><strong>{users.filter((user) => user.active).length}</strong><p>usuários ativos</p><small>{users.length} contas cadastradas</small></div>
    </div>
    <div className="card users-card"><div className="users-card-head"><div><h2>Usuários e permissões</h2><p>Os toggles são aplicados imediatamente no banco e validados pela API.</p></div></div>
      <div className="users-table users-table-head"><span>Usuário</span><span>Status</span>{accessLabels.map(({ key, label }) => <span key={key}>{label}</span>)}<span>Ações</span></div>
      {users.map((user) => <div className={`users-table ${user.active ? "" : "disabled-user"}`} key={user.id}><div className="managed-person"><Avatar name={user.name} size="sm" /><span><strong>{user.name}{user.id === currentUser.id && <em>Você</em>}{!user.emailVerified && <em className="pending-verification">Convite pendente</em>}</strong><small>{user.email}</small></span></div><div><Toggle checked={user.active} disabled={user.role === "admin"} label="Usuário ativo" onChange={(checked) => void updateAccess(user, { active: checked })} /></div>{accessLabels.map(({ key }) => <div key={key}><Toggle checked={user.permissions[key]} disabled={user.role === "admin" || !user.active} label={`Acesso a ${key}`} onChange={() => void updateAccess(user, { permission: key })} /></div>)}<div className="user-actions"><button title="Enviar redefinição de senha" disabled={!user.emailVerified} onClick={() => open({ kind: "email", user })}><Mail size={16} /></button><button className="danger-icon" title="Excluir usuário" disabled={user.role === "admin" || user.id === currentUser.id} onClick={() => open({ kind: "delete", user })}><Trash2 size={16} /></button></div></div>)}
      {!users.length && <Empty text="Nenhum usuário cadastrado." />}
    </div>

    {modal?.kind === "create" && <Modal title="Convidar novo usuário" subtitle="Ele receberá um código de confirmação e criará a própria senha." onClose={() => setModal(null)}><form className="modal-form" onSubmit={create}><Field label="Nome completo" name="name" required /><Field label="E-mail profissional" name="email" type="email" required /><fieldset><legend>Acessos liberados</legend>{accessLabels.map(({ key, label }, index) => <label className="permission-option" key={key}><span><strong>{label}</strong><small>{key === "settings" ? "Gerenciar equipe e segurança" : `Visualizar e operar ${label.toLowerCase()}`}</small></span><Toggle name={key} defaultChecked={index < 2} label={label} /></label>)}</fieldset>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Enviando convite..." : "Enviar convite"}</button></div></form></Modal>}
    {modal?.kind === "password" && <Modal title="Alterar minha senha" subtitle="As outras sessões abertas serão encerradas." onClose={() => setModal(null)}><form className="modal-form" onSubmit={changeOwnPassword}><Field label="Senha atual" name="currentPassword" type="password" required /><Field label="Nova senha" name="newPassword" type="password" minLength={10} required /><Field label="Confirmar nova senha" name="confirmation" type="password" minLength={10} required />{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando..." : "Alterar senha"}</button></div></form></Modal>}
    {modal?.kind === "delete" && modal.user && <Modal title="Excluir usuário?" subtitle={`O acesso de ${modal.user.name} será removido permanentemente.`} tone="danger" onClose={() => setModal(null)}>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void removeUser()}>{busy ? "Excluindo..." : "Excluir usuário"}</button></div></Modal>}
    {modal?.kind === "email" && modal.user && <Modal title="Enviar redefinição?" subtitle={`Enviaremos um link seguro para ${modal.user.email}. O link expira em 30 minutos.`} onClose={() => setModal(null)}>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={() => void emailReset()}>{busy ? "Enviando..." : "Enviar e-mail"}</button></div></Modal>}
  </section>;
}

function Toggle({ checked, defaultChecked, disabled, label, name, onChange }: { checked?: boolean; defaultChecked?: boolean; disabled?: boolean; label: string; name?: string; onChange?: (checked: boolean) => void }) {
  const state = checked === undefined ? { defaultChecked } : { checked };
  return <label className="toggle" title={label}><input type="checkbox" name={name} {...state} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} /><span /></label>;
}

function Modal({ title, subtitle, tone, onClose, children }: { title: string; subtitle: string; tone?: "danger"; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === "Escape" && onClose(); addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal-card ${tone ?? ""}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button><div className="modal-mark">{tone === "danger" ? <Trash2 /> : <ShieldCheck />}</div><h2>{title}</h2><p>{subtitle}</p>{children}</section></div>;
}

function ConversationRow({ conversation, active, onClick }: { conversation: Conversation; active: boolean; onClick: () => void }) { return <button className={`conversation-row ${active ? "active" : ""}`} onClick={onClick}><Avatar name={conversation.name} online={conversation.online} size="sm" /><span><strong>{conversation.name}</strong><small>{conversation.lastMessageType === "audio" ? "Áudio" : conversation.lastMessage ?? conversation.stage}</small></span><time>{formatTime(conversation.lastMessageAt)}{conversation.unreadCount > 0 && <b>{conversation.unreadCount}</b>}</time></button>; }
function Brand() { return <div className="brand">Karrer<span> &amp;</span><br />Advogados</div>; }
function Avatar({ name, online, size = "md" }: { name: string | null; online?: boolean; size?: "xs" | "sm" | "md" }) { return <div className={`avatar ${size}`}>{initials(name)}{online && <i />}</div>; }
function ClassificationBadge({ value }: { value: Classification }) { return <span className={`badge ${value}`}>Lead {classificationLabel[value].toLowerCase()}</span>; }
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="search-box"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>{children}</button>; }
function Kpi({ label, value, detail, dark, tone }: { label: string; value: number; detail: string; dark?: boolean; tone?: Classification }) { return <div className={`kpi ${dark ? "dark" : ""} ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { const { label, ...input } = props; return <label>{label}<input {...input} /></label>; }
function Empty({ text, large, dark }: { text: string; large?: boolean; dark?: boolean }) { return <div className={`empty ${large ? "large" : ""} ${dark ? "dark" : ""}`}><MessageCircle /><p>{text}</p></div>; }

export default App;
