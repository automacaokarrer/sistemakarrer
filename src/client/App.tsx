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
  Menu,
  MessageCircle,
  Mic,
  Paperclip,
  Play,
  Plus,
  Search,
  Send,
  Users,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, formatTime, initials } from "./api";
import type { AuthStatus, Classification, Contact, Conversation, LeadSummary, Message, User } from "./types";

type View = "chat" | "leads" | "clients" | "lead";
type ConversationFilter = "all" | "unread" | "hot";

const classificationLabel: Record<Classification, string> = { hot: "Quente", warm: "Morno", cold: "Frio" };

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
  const [view, setView] = useState<View>("chat");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [summary, setSummary] = useState<LeadSummary>({ total: 0, hot: 0, warm: 0, cold: 0, averageFirstResponseMinutes: 0, daily: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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

  useEffect(() => void reloadConversations(), [reloadConversations]);
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
        {view === "chat" && <ChatPage conversations={conversations} selected={selected} onSelect={setSelectedId} onOpenLead={() => setView("lead")} onRefresh={reloadConversations} />}
        {view === "leads" && <LeadsPage conversations={conversations} summary={summary} onOpen={(id) => { setSelectedId(id); setView("lead"); }} onRefresh={refreshLeads} />}
        {view === "lead" && <LeadDetail conversation={selected} onBack={() => setView("leads")} onChat={() => setView("chat")} onRefresh={refreshLeads} />}
        {view === "clients" && <ClientsPage contacts={contacts} onRefresh={refreshClients} />}
      </main>
    </div>
  );
}

function Sidebar({ view, user, unread, onNavigate, onLogout }: { view: View; user: User; unread: number; onNavigate: (view: View) => void; onLogout: () => Promise<void> }) {
  const items: Array<{ id: View; label: string; icon: typeof MessageCircle }> = [
    { id: "chat", label: "Chat de atendimento", icon: MessageCircle },
    { id: "leads", label: "Leads", icon: Users },
    { id: "clients", label: "Cadastro de clientes", icon: Plus },
  ];
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
