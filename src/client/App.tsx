import {
  ArrowLeft,
  Bot,
  Check,
  CheckCheck,
  ChevronDown,
  CircleUserRound,
  Clock3,
  Download,
  FileText,
  Image,
  LoaderCircle,
  LogOut,
  KeyRound,
  Mail,
  MessageCircle,
  Mic,
  Paperclip,
  Pause,
  Play,
  Plus,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { ClipboardEvent, FocusEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, formatResponseDuration, formatTime, initials } from "./api";
import type { AuthStatus, Classification, Contact, Conversation, LeadAttendant, LeadTag, LeadTagHistory, ManagedUser, Message, Permissions, ServiceStatus, User } from "./types";

type View = "chat" | "leads" | "clients" | "lead" | "settings";
type LinkPreviewData = { url: string; title: string; description: string | null; siteName: string };
type ConversationFilter = "all" | "mine" | "unassigned" | "unread" | "hot";
type ConversationSort = "recent" | "waiting";

const classificationLabel: Record<Classification, string> = { hot: "Quente", warm: "Morno", cold: "Frio" };
const serviceStatusLabel: Record<ServiceStatus, string> = { new: "Nova", in_progress: "Em atendimento", waiting_customer: "Aguardando cliente", resolved: "Finalizada" };
const resetToken = new URLSearchParams(location.search).get("reset");
const activationEmail = new URLSearchParams(location.search).get("activate");
const activationRequiresPassword = new URLSearchParams(location.search).get("invite") === "1";
const urlPattern = /https?:\/\/[^\s<>]+/gi;
const trailingUrlPunctuation = /[),.!?;:]+$/;
const linkPreviewCache = new Map<string, Promise<LinkPreviewData | null>>();

function formatBrazilianPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits.slice(2) : digits;
  if (national.length !== 10 && national.length !== 11) return value;
  const areaCode = national.slice(0, 2);
  let local = national.slice(2);
  if (local.length === 8) local = `9${local}`;
  return `(${areaCode}) ${local.slice(0, 5)}-${local.slice(5)}`;
}

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
  if (activationEmail) return <ActivateAccountScreen email={activationEmail} requiresPassword={activationRequiresPassword} />;

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
  return <Dashboard user={auth.user} googleDrive={auth.features.googleDrive} onLogout={() => setAuth({ setupRequired: false, user: null, features: auth.features })} />;
}

function ActivateAccountScreen({ email, requiresPassword }: { email: string; requiresPassword: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    if (requiresPassword && password !== String(data.get("confirmation") ?? "")) { setError("As senhas não coincidem."); return; }
    setBusy(true); setError("");
    try {
      await api("/api/auth/activate", { method: "POST", body: JSON.stringify({ email, code: data.get("code"), ...(requiresPassword ? { password } : {}) }) });
      setDone(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível confirmar o acesso."); }
    finally { setBusy(false); }
  }
  if (done) return <main className="auth-page"><section className="auth-brand"><Brand /><p>Seu acesso foi confirmado com segurança.</p></section><div className="auth-card"><span className="eyebrow">Conta ativada</span><h1>Tudo pronto</h1><p>Seu e-mail foi confirmado. Você já pode entrar no sistema.</p><button className="primary wide" onClick={() => { history.replaceState({}, "", "/"); location.reload(); }}>Ir para o login</button></div></main>;
  return <main className="auth-page"><section className="auth-brand"><Brand /><p>Confirme seu e-mail para ativar o acesso.</p></section><form className="auth-card" onSubmit={submit}><span className="eyebrow">Confirmação de e-mail</span><h1>{requiresPassword ? "Crie seu acesso" : "Digite seu código"}</h1><p className="auth-helper">Enviamos um código para <strong>{email}</strong>.</p><Field label="Código de 6 dígitos" name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" required />{requiresPassword && <><Field label="Criar senha" name="password" type="password" autoComplete="new-password" minLength={10} required /><Field label="Confirmar senha" name="confirmation" type="password" autoComplete="new-password" minLength={10} required /></>}{error && <p className="form-error">{error}</p>}<button className="primary wide" disabled={busy}>{busy ? "Confirmando..." : requiresPassword ? "Criar senha e confirmar" : "Confirmar e-mail"}</button></form></main>;
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
  const [mode, setMode] = useState<"login" | "register">("login");
  const [photoName, setPhotoName] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      if (!setupRequired && mode === "register") {
        if (data.get("password") !== data.get("confirmation")) throw new Error("As senhas não coincidem.");
        const result = await api<{ email: string }>("/api/auth/register", { method: "POST", body: data });
        location.href = `/?activate=${encodeURIComponent(result.email)}`;
        return;
      }
      await api(setupRequired ? "/api/auth/bootstrap" : "/api/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(data.entries())) });
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
      <form className={`auth-card ${mode === "register" ? "register-card" : ""}`} onSubmit={submit}>
        {!setupRequired && <div className="auth-tabs"><button type="button" className={mode === "login" ? "active" : ""} onClick={() => { setMode("login"); setError(""); }}>Entrar</button><button type="button" className={mode === "register" ? "active" : ""} onClick={() => { setMode("register"); setError(""); }}>Criar conta</button></div>}
        <span className="eyebrow">{setupRequired ? "Configuração inicial" : mode === "register" ? "Novo acesso" : "Acesso seguro"}</span>
        <h1>{setupRequired ? "Criar administrador" : mode === "register" ? "Cadastre-se" : "Entrar no sistema"}</h1>
        {(setupRequired || mode === "register") && <Field label="Nome completo" name="name" autoComplete="name" required />}
        <Field label="E-mail" name="email" type="email" autoComplete="email" required />
        {mode === "register" && !setupRequired && <Field label="Perfil do Instagram" name="instagram" placeholder="@seuperfil" autoComplete="off" required />}
        {mode === "register" && !setupRequired && <label>Função profissional<select name="professionalRole" required defaultValue=""><option value="" disabled>Selecione sua função</option><option value="advogado">Advogado</option><option value="advogada">Advogada</option><option value="estagiario">Estagiário</option><option value="secretaria">Secretaria</option><option value="atendente_chat">Atendente de chat</option></select></label>}
        <Field label="Senha" name="password" type="password" autoComplete={setupRequired || mode === "register" ? "new-password" : "current-password"} minLength={10} required />
        {mode === "register" && !setupRequired && <><Field label="Confirmar senha" name="confirmation" type="password" minLength={10} required /><label className="photo-field">Foto de perfil *<span><CircleUserRound size={22} />{photoName || "Escolher foto JPG, PNG ou WebP"}</span><input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoName(event.target.files?.[0]?.name ?? "")} required /></label><small className="register-note">Enviaremos um código de 6 dígitos para confirmar seu e-mail.</small></>}
        {setupRequired && <Field label="Código de inicialização" name="bootstrapToken" type="password" required />}
        {error && <p className="form-error">{error}</p>}
        <button className="primary wide" disabled={busy}>{busy ? "Aguarde..." : setupRequired ? "Criar acesso" : mode === "register" ? "Cadastrar e confirmar e-mail" : "Entrar"}</button>
      </form>
    </main>
  );
}

function Dashboard({ user, googleDrive, onLogout }: { user: User; googleDrive: boolean; onLogout: () => void }) {
  const firstView: View = user.permissions.chat ? "chat" : user.permissions.leads ? "leads" : user.permissions.clients ? "clients" : user.role === "admin" ? "settings" : "chat";
  const [view, setView] = useState<View>(firstView);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(user.permissions.chat || user.permissions.leads);
  const conversationsLoaded = useRef(false);
  const reloadSequence = useRef(0);

  const reloadConversations = useCallback(async () => {
    const sequence = ++reloadSequence.current;
    if (!conversationsLoaded.current) setLoading(true);
    try {
      const conversationData = await api<{ conversations: Conversation[] }>("/api/conversations");
      if (sequence === reloadSequence.current) {
        setConversations(conversationData.conversations);
        setSelectedId((current) => current && conversationData.conversations.some((conversation) => conversation.id === current) ? current : null);
      }
    } finally {
      conversationsLoaded.current = true;
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    const data = await api<{ contacts: Contact[] }>("/api/contacts");
    setContacts(data.contacts);
  }, []);

  const refreshClients = useCallback(async () => {
    await Promise.all([loadContacts(), ...(user.permissions.chat || user.permissions.leads ? [reloadConversations()] : [])]);
  }, [loadContacts, reloadConversations, user.permissions.chat, user.permissions.leads]);

  useEffect(() => {
    if (!user.permissions.chat && !user.permissions.leads) return;
    const refresh = () => { if (document.visibilityState === "visible") void reloadConversations().catch(() => undefined); };
    refresh();
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [reloadConversations, user.permissions.chat, user.permissions.leads]);
  useEffect(() => {
    if (!user.permissions.chat && !user.permissions.leads) return;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let refreshTimer: number | null = null;
    let awaitingPong = false;
    let stopped = false;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      awaitingPong = false;
    };
    const scheduleRefresh = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void reloadConversations().catch(() => undefined), 100);
    };
    const connect = () => {
      if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/conversations/ws`);
      socket.onopen = () => {
        void reloadConversations().catch(() => undefined);
        clearHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState !== WebSocket.OPEN) return;
          if (awaitingPong) { socket.close(4000, "heartbeat timeout"); return; }
          awaitingPong = true;
          socket.send("ping");
        }, 25_000);
      };
      socket.onmessage = (event) => {
        if (event.data === "pong") { awaitingPong = false; return; }
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === "conversation.updated") scheduleRefresh();
        } catch { /* mensagens de controle são ignoradas */ }
      };
      socket.onclose = () => {
        clearHeartbeat();
        socket = null;
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1_500);
      };
    };

    const reconnectWhenVisible = () => {
      if (document.visibilityState === "visible") connect();
    };
    connect();
    fallbackTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && socket?.readyState !== WebSocket.OPEN) void reloadConversations().catch(() => undefined);
    }, 30_000);
    document.addEventListener("visibilitychange", reconnectWhenVisible);
    return () => {
      stopped = true;
      document.removeEventListener("visibilitychange", reconnectWhenVisible);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      clearHeartbeat();
      socket?.close(1000, "dashboard closed");
    };
  }, [reloadConversations, user.permissions.chat, user.permissions.leads]);
  useEffect(() => {
    const ping = () => { if (document.visibilityState === "visible") void api("/api/auth/presence", { method: "POST" }).catch(() => undefined); };
    ping();
    const timer = window.setInterval(ping, 5 * 60 * 1000);
    document.addEventListener("visibilitychange", ping);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", ping); };
  }, []);
  useEffect(() => {
    if (view === "clients") void loadContacts();
  }, [loadContacts, view]);
  const selected = conversations.find((conversation) => conversation.id === selectedId) ?? null;

  useEffect(() => {
    if (view !== "chat" || !selected || selected.unreadCount <= 0) return;
    const conversationId = selected.id;
    setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unreadCount: 0, waitingSince: null, serviceStatus: item.serviceStatus === "new" ? "in_progress" : item.serviceStatus, assigneeId: item.assigneeId ?? user.id, assigneeName: item.assigneeName ?? user.name } : item));
    void api<{ assigneeId: string; assigneeName: string; serviceStatus: ServiceStatus }>(`/api/conversations/${conversationId}/read`, { method: "POST" })
      .then((result) => setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, unreadCount: 0, waitingSince: null, assigneeId: result.assigneeId, assigneeName: result.assigneeName, serviceStatus: result.serviceStatus } : item)))
      .catch(() => void reloadConversations());
  }, [reloadConversations, selected, user.name, view]);

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
        {view === "chat" && user.permissions.chat && <ChatPage currentUser={user} conversations={conversations} selected={selected} onSelect={setSelectedId} onOpenLead={() => setView("lead")} onRefresh={reloadConversations} />}
        {view === "leads" && user.permissions.leads && <LeadsPage currentUserId={user.id} conversations={conversations} onOpen={(id) => { setSelectedId(id); setView("lead"); }} onRefresh={reloadConversations} />}
        {view === "lead" && user.permissions.leads && <LeadDetail conversation={selected} onBack={() => setView("leads")} onChat={() => user.permissions.chat && setView("chat")} onRefresh={reloadConversations} />}
        {view === "clients" && user.permissions.clients && <ClientsPage contacts={contacts} googleDrive={googleDrive} onRefresh={refreshClients} />}
        {view === "settings" && user.role === "admin" && <SettingsPage currentUser={user} />}
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
            <button key={id} aria-label={id === "chat" ? "Chat" : id === "clients" ? "Clientes" : label} data-mobile-label={id === "chat" ? "Chat" : id === "clients" ? "Clientes" : label} className={(view === id || (view === "lead" && id === "leads")) ? "active" : ""} onClick={() => onNavigate(id)}>
              <Icon size={18} /><span>{label}</span>{id === "chat" && unread > 0 && <b>{unread}</b>}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="sidebar-user">
            <Avatar name={user.name} imageUrl={user.avatarUrl} size="sm" />
            <span><strong>{user.name}</strong><small>Online <i /></small></span>
            <button className="logout-button" title="Sair" aria-label="Sair" onClick={() => void onLogout()}><LogOut size={17} /></button>
          </div>
          {user.role === "admin" && <button className={`settings-nav ${view === "settings" ? "active" : ""}`} onClick={() => onNavigate("settings")}><span><Settings size={18} /></span><strong>Configurações</strong></button>}
        </div>
      </div>
    </aside>
  );
}

function ChatPage({ currentUser, conversations, selected, onSelect, onOpenLead, onRefresh }: { currentUser: User; conversations: Conversation[]; selected: Conversation | null; onSelect: (id: string | null) => void; onOpenLead: () => void; onRefresh: () => Promise<void> }) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [sort, setSort] = useState<ConversationSort>("recent");
  const [search, setSearch] = useState("");
  const [attendants, setAttendants] = useState<ManagedUser[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingLuna, setUpdatingLuna] = useState(false);
  const [actionError, setActionError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (currentUser.role !== "admin") return;
    void api<{ users: ManagedUser[] }>("/api/settings/users").then((data) => setAttendants(data.users.filter((user) => user.active && user.permissions.chat))).catch(() => setAttendants([]));
  }, [currentUser.role]);
  async function assign(userId: string) {
    if (!selected || assigning) return;
    setAssigning(true);
    setActionError("");
    try {
      await api(`/api/conversations/${selected.id}/assignee`, { method: "PATCH", body: JSON.stringify({ userId: userId || null }) });
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Não foi possível direcionar o atendimento.");
    } finally { setAssigning(false); }
  }
  async function updateStatus(status: ServiceStatus) {
    if (!selected || updatingStatus || status === selected.serviceStatus) return;
    setUpdatingStatus(true);
    setActionError("");
    try {
      await api(`/api/conversations/${selected.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Não foi possível atualizar o status.");
    } finally { setUpdatingStatus(false); }
  }
  async function toggleLuna() {
    if (!selected || updatingLuna) return;
    const enabled = !selected.lunaAutonomousEnabled;
    if (enabled && !window.confirm("Ativar a Luna nesta conversa? O atendimento humano atual será removido e as próximas mensagens do cliente poderão receber resposta automática.")) return;
    setUpdatingLuna(true);
    setActionError("");
    try {
      await api(`/api/conversations/${selected.id}/luna`, { method: "PATCH", body: JSON.stringify({ enabled }) });
      await onRefresh();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : "Não foi possível alterar o atendimento da Luna.");
    } finally { setUpdatingLuna(false); }
  }
  useEffect(() => setActionError(""), [selected?.id]);
  const filtered = conversations.filter((item) => {
    const matchesFilter = filter === "all"
      || (filter === "mine" && item.assigneeId === currentUser.id)
      || (filter === "unassigned" && !item.assigneeId)
      || (filter === "unread" && item.unreadCount > 0)
      || (filter === "hot" && item.classification === "hot");
    return matchesFilter && `${item.name} ${item.phone}`.toLowerCase().includes(search.toLowerCase());
  }).sort((left, right) => {
    if (sort !== "waiting") return 0;
    if (left.waitingSince && right.waitingSince) return new Date(left.waitingSince).getTime() - new Date(right.waitingSince).getTime();
    if (left.waitingSince) return -1;
    if (right.waitingSince) return 1;
    return 0;
  });
  return (
    <section className="chat-layout">
      <div className="conversation-list">
        <header><h1>Conversas</h1><span>{conversations.reduce((sum, item) => sum + item.unreadCount, 0)} não lidas</span></header>
        <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome ou telefone" />
        <div className="chips">
          <Chip active={filter === "all"} onClick={() => setFilter("all")}>Todas</Chip>
          <Chip active={filter === "mine"} onClick={() => setFilter("mine")}>Minhas</Chip>
          <Chip active={filter === "unassigned"} onClick={() => setFilter("unassigned")}>Não atribuídas</Chip>
          <Chip active={filter === "unread"} onClick={() => setFilter("unread")}>Não lidas</Chip>
          <Chip active={filter === "hot"} onClick={() => setFilter("hot")}>Quentes</Chip>
        </div>
        <label className="conversation-sort"><span>Ordenar</span><select aria-label="Ordenar conversas" value={sort} onChange={(event) => setSort(event.target.value as ConversationSort)}><option value="recent">Mais recentes</option><option value="waiting">Maior espera</option></select><ChevronDown size={14} /></label>
        <div className="conversation-scroll">
          {filtered.map((conversation) => <ConversationRow key={conversation.id} conversation={conversation} active={selected?.id === conversation.id} now={now} onClick={() => onSelect(conversation.id)} />)}
          {filtered.length === 0 && <div className="conversation-empty"><span><MessageCircle size={19} /></span><strong>Nenhuma conversa</strong><p>{search || filter !== "all" ? "Tente alterar os filtros ou a busca." : "As novas conversas do WhatsApp aparecerão aqui."}</p></div>}
        </div>
      </div>
      {selected ? <ConversationPanel conversation={selected} attendants={attendants} canAssign={currentUser.role === "admin"} assigning={assigning} updatingStatus={updatingStatus} updatingLuna={updatingLuna} actionError={actionError} onAssign={assign} onStatus={updateStatus} onToggleLuna={toggleLuna} onBack={() => onSelect(null)} onOpenLead={onOpenLead} onRefresh={onRefresh} /> : <div className="chat-welcome"><div className="welcome-mark"><MessageCircle size={28} /></div><span className="eyebrow">Central de atendimento</span><h2>Suas conversas em um só lugar</h2><p>Selecione um contato ao lado para visualizar o histórico e continuar o atendimento.</p><div className="welcome-features"><span><CheckCheck size={16} /> Histórico organizado</span><span><Users size={16} /> Leads integrados</span><span><ShieldCheck size={16} /> Dados protegidos</span></div><small><i /> Aguardando novas mensagens</small></div>}
    </section>
  );
}

function ConversationPanel({ conversation, attendants, canAssign, assigning, updatingStatus, updatingLuna, actionError, onAssign, onStatus, onToggleLuna, onBack, onOpenLead, onRefresh }: { conversation: Conversation; attendants: ManagedUser[]; canAssign: boolean; assigning: boolean; updatingStatus: boolean; updatingLuna: boolean; actionError: string; onAssign: (userId: string) => Promise<void>; onStatus: (status: ServiceStatus) => Promise<void>; onToggleLuna: () => Promise<void>; onBack: () => void; onOpenLead: () => void; onRefresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [recording, setRecording] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState<{ file: File; kind: "image" | "audio" | "document"; previewUrl: string | null; duration?: number } | null>(null);
  const [openImage, setOpenImage] = useState<{ url: string; alt: string; downloadUrl: string } | null>(null);
  const [sendError, setSendError] = useState("");
  const [tagData, setTagData] = useState<{ tags: LeadTag[]; history: LeadTagHistory[] }>({ tags: [], history: [] });
  const [tagModal, setTagModal] = useState(false);
  const [tagBusy, setTagBusy] = useState<string | null>(null);
  const [tagError, setTagError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const loadingOlderRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recordingStartedAtRef = useRef(0);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setMessages([]);
    setNextCursor(null);
    setHasMore(false);
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean; nextCursor: string | null }>(`/api/conversations/${conversation.id}/messages?limit=40`);
      setMessages(data.messages);
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      requestAnimationFrame(() => endRef.current?.scrollIntoView());
    } finally {
      setLoading(false);
    }
  }, [conversation.id]);

  const loadOlderMessages = useCallback(async () => {
    if (!hasMore || !nextCursor || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    const pane = messagesRef.current;
    const previousHeight = pane?.scrollHeight ?? 0;
    const previousTop = pane?.scrollTop ?? 0;
    try {
      const data = await api<{ messages: Message[]; hasMore: boolean; nextCursor: string | null }>(`/api/conversations/${conversation.id}/messages?limit=40&before=${encodeURIComponent(nextCursor)}`);
      setMessages((current) => {
        const known = new Set(current.map((message) => message.id));
        return [...data.messages.filter((message) => !known.has(message.id)), ...current];
      });
      setHasMore(data.hasMore);
      setNextCursor(data.nextCursor);
      requestAnimationFrame(() => {
        if (pane) pane.scrollTop = previousTop + (pane.scrollHeight - previousHeight);
      });
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Não foi possível carregar mensagens anteriores.");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversation.id, hasMore, nextCursor]);

  const syncRecentMessages = useCallback(async () => {
    if (document.visibilityState !== "visible") return;
    const data = await api<{ messages: Message[] }>(`/api/conversations/${conversation.id}/messages?limit=40`);
    setMessages((current) => {
      const byId = new Map(current.map((message) => [message.id, message]));
      for (const message of data.messages) byId.set(message.id, message);
      return [...byId.values()].sort((left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
    });
  }, [conversation.id]);

  const loadTags = useCallback(async () => {
    const data = await api<{ tags: LeadTag[]; history: LeadTagHistory[] }>(`/api/conversations/${conversation.id}/tags`);
    setTagData(data);
  }, [conversation.id]);

  useEffect(() => void loadMessages(), [loadMessages]);
  useEffect(() => { setTagModal(false); setTagError(""); void loadTags().catch(() => setTagData({ tags: [], history: [] })); }, [loadTags]);
  useEffect(() => {
    const refresh = () => void syncRecentMessages().catch(() => undefined);
    document.addEventListener("visibilitychange", refresh);
    return () => document.removeEventListener("visibilitychange", refresh);
  }, [syncRecentMessages]);
  useEffect(() => () => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.stop();
    }
    recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, [conversation.id]);
  useEffect(() => {
    if (!openImage) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpenImage(null); };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openImage]);
  useEffect(() => setOpenImage(null), [conversation.id]);
  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let awaitingPong = false;
    let stopped = false;

    const clearHeartbeat = () => {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      awaitingPong = false;
    };
    const connect = () => {
      if (stopped || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/conversations/${conversation.id}/ws`);
      socket.onopen = () => {
        void syncRecentMessages().catch(() => undefined);
        clearHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (socket?.readyState !== WebSocket.OPEN) return;
          if (awaitingPong) { socket.close(4000, "heartbeat timeout"); return; }
          awaitingPong = true;
          socket.send("ping");
        }, 25_000);
      };
      socket.onmessage = (event) => {
        if (event.data === "pong") { awaitingPong = false; return; }
        try {
          const data = JSON.parse(event.data) as { type: string; message?: Message; messageId?: string; status?: Message["status"] };
          if (data.type === "message.new" && data.message) {
            const pane = messagesRef.current;
            const shouldFollow = !pane || pane.scrollHeight - pane.scrollTop - pane.clientHeight < 120;
            setMessages((current) => current.some((item) => item.id === data.message?.id) ? current : [...current, data.message!]);
            if (shouldFollow) requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
          }
          if (data.type === "message.status" && data.messageId && data.status) {
            setMessages((current) => current.map((message) => message.id === data.messageId ? { ...message, status: data.status! } : message));
          }
          if (data.type === "conversation.tags") void loadTags().catch(() => undefined);
        } catch { /* mensagens de controle são ignoradas */ }
      };
      socket.onclose = () => {
        clearHeartbeat();
        socket = null;
        if (!stopped) reconnectTimer = window.setTimeout(connect, 1_500);
      };
    };

    connect();
    fallbackTimer = window.setInterval(() => {
      if (document.visibilityState === "visible" && socket?.readyState !== WebSocket.OPEN) void syncRecentMessages().catch(() => undefined);
    }, 30_000);
    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (fallbackTimer !== null) window.clearInterval(fallbackTimer);
      clearHeartbeat();
      socket?.close(1000, "conversation changed");
    };
  }, [conversation.id, loadTags, syncRecentMessages]);

  async function toggleTag(tag: LeadTag) {
    if (tagBusy) return;
    setTagBusy(tag.id);
    setTagError("");
    try {
      const data = await api<{ tags: LeadTag[]; history: LeadTagHistory[] }>(`/api/conversations/${conversation.id}/tags`, {
        method: "PATCH", body: JSON.stringify({ tagId: tag.id, active: !tag.selected }),
      });
      setTagData(data);
      await onRefresh();
    } catch (reason) {
      setTagError(reason instanceof Error ? reason.message : "Não foi possível atualizar a etiqueta.");
    } finally { setTagBusy(null); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError("");
    try {
      const result = await api<{ message: Message }>(`/api/conversations/${conversation.id}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setText("");
      await onRefresh();
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  async function sendAttachment(file: File, kind: "image" | "audio" | "document", duration?: number) {
    if (uploadingMedia) return;
    setUploadingMedia(true);
    setSendError("");
    const form = new FormData();
    form.set("file", file); form.set("kind", kind);
    if (text.trim() && kind !== "audio") form.set("caption", text.trim());
    if (duration) form.set("duration", String(duration));
    try {
      const result = await api<{ message: Message }>(`/api/conversations/${conversation.id}/media`, { method: "POST", body: form });
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      if (kind !== "audio") setText("");
      setPendingAttachment(null);
      await onRefresh();
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Não foi possível enviar o arquivo.");
    } finally { setUploadingMedia(false); }
  }

  function stageAttachment(file: File, kind: "image" | "audio" | "document", duration?: number) {
    setPendingAttachment({ file, kind, duration, previewUrl: kind === "image" || kind === "audio" ? URL.createObjectURL(file) : null });
    setSendError("");
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const item = Array.from(event.clipboardData.items).find((entry) => entry.kind === "file" && entry.type.startsWith("image/"));
    if (!item) return;
    event.preventDefault();
    const pasted = item.getAsFile();
    if (!pasted) return;
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const extension = extensions[pasted.type];
    if (!extension) {
      setSendError("O print colado precisa estar em JPG, PNG ou WebP.");
      return;
    }
    const file = new File([pasted], pasted.name || `print-${Date.now()}.${extension}`, { type: pasted.type, lastModified: Date.now() });
    stageAttachment(file, "image");
  }

  async function toggleRecording() {
    if (recording) { recorderRef.current?.stop(); return; }
    setSendError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      recorder.onstop = () => {
        const duration = Math.max(1, Math.round((Date.now() - recordingStartedAtRef.current) / 1_000));
        const mime = recorder.mimeType || "audio/webm";
        recorderStreamRef.current?.getTracks().forEach((track) => track.stop());
        recorderStreamRef.current = null; recorderRef.current = null; setRecording(false);
        const blob = new Blob(chunks, { type: mime });
        if (blob.size) stageAttachment(new File([blob], `audio-${Date.now()}.${mime.includes("mp4") ? "m4a" : "webm"}`, { type: mime }), "audio", duration);
      };
      recorderRef.current = recorder; recorderStreamRef.current = stream; recordingStartedAtRef.current = Date.now();
      recorder.start(); setRecording(true);
    } catch { setSendError("Permita o acesso ao microfone para gravar o áudio."); }
  }

  useEffect(() => () => {
    if (pendingAttachment?.previewUrl) URL.revokeObjectURL(pendingAttachment.previewUrl);
  }, [pendingAttachment]);

  return (
    <div className={`conversation-panel ${tagModal ? "modal-open" : ""}`}>
      <header className="chat-header">
        <button className="mobile-back" aria-label="Voltar às conversas" onClick={onBack}><ArrowLeft size={20} /></button>
        <Avatar name={conversation.name} imageUrl={conversation.avatarUrl} online={conversation.online} />
        <div className="chat-contact"><div className="chat-contact-title"><h2>{conversation.name}</h2><button type="button" className="tag-button" aria-label="Gerenciar etiquetas" title="Gerenciar etiquetas" onClick={() => setTagModal(true)}><Tag size={15} /></button></div><p>{conversation.online ? <em>Online</em> : conversation.lastSeenAt ? `Visto por último ${new Date(conversation.lastSeenAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Visto por último indisponível"} <ClassificationBadge value={conversation.classification} /></p>{tagData.tags.some((tag) => tag.selected) && <div className="chat-tag-strip" aria-label="Etiquetas ativas">{tagData.tags.filter((tag) => tag.selected).slice(0, 3).map((tag) => <span className="chat-tag" style={{ backgroundColor: tag.color }} key={tag.id}>{tag.name}</span>)}{tagData.tags.filter((tag) => tag.selected).length > 3 && <span className="chat-tag-more">+{tagData.tags.filter((tag) => tag.selected).length - 3}</span>}</div>}</div>
        <div className={`chat-routing-controls ${canAssign ? "with-luna" : "solo"}`}>
          <CompactSelect className={`service-status-picker ${conversation.serviceStatus}`} label="Status do atendimento" value={conversation.serviceStatus} disabled={updatingStatus} options={Object.entries(serviceStatusLabel).map(([value, label]) => ({ value, label }))} onChange={(value) => void onStatus(value as ServiceStatus)} />
          {canAssign && <CompactSelect className="assignee-picker" label="Direcionar atendimento" value={conversation.assigneeId ?? ""} disabled={assigning} icon={<Users size={15} />} options={[{ value: "", label: "Não atribuído" }, ...attendants.map((attendant) => ({ value: attendant.id, label: attendant.name }))]} onChange={(value) => void onAssign(value)} />}
          {canAssign && <button type="button" className={`luna-control ${conversation.lunaAutonomousEnabled ? "active" : ""}`} aria-pressed={conversation.lunaAutonomousEnabled} aria-label={conversation.lunaAutonomousEnabled ? "Desativar atendimento da Luna" : "Ativar atendimento da Luna"} disabled={updatingLuna || (!conversation.lunaAutonomousEnabled && conversation.serviceStatus === "resolved")} onClick={() => void onToggleLuna()}><Bot size={16} /><span>{updatingLuna ? "Aguarde" : conversation.lunaAutonomousEnabled ? "Luna ativa" : "Ativar Luna"}</span></button>}
        </div>
        <button className="primary" onClick={onOpenLead}>Ver ficha do lead</button>
        {actionError && <div className="chat-action-error" role="alert">{actionError}</div>}
      </header>
      <div ref={messagesRef} className="messages" onScroll={(event) => { if (event.currentTarget.scrollTop < 120) void loadOlderMessages(); }}>
        {loading && <div className="loading-messages"><LoaderCircle className="spin" size={15} /> Carregando mensagens...</div>}
        {loadingOlder && <div className="loading-messages"><LoaderCircle className="spin" size={15} /> Carregando mensagens anteriores...</div>}
        <div className="date-pill">Hoje</div>
        {messages.map((message) => <MessageBubble key={message.id} message={message} onImageOpen={setOpenImage} />)}
        {sendError && <div className="message-error" role="alert">{sendError}</div>}
        {!loading && messages.length === 0 && <Empty text="Ainda não há mensagens nesta conversa." dark />}
        <div ref={endRef} />
      </div>
      {pendingAttachment && <div className={`attachment-preview ${pendingAttachment.kind}`} role="region" aria-label="Prévia do arquivo">
        <div className="attachment-preview-content">
          {pendingAttachment.kind === "image" && pendingAttachment.previewUrl && <img src={pendingAttachment.previewUrl} alt="Prévia da imagem" />}
          {pendingAttachment.kind === "audio" && pendingAttachment.previewUrl && <AudioPreview src={pendingAttachment.previewUrl} recordedDuration={pendingAttachment.duration} />}
          {pendingAttachment.kind === "document" && <><span className="attachment-file-icon"><FileText size={25} /></span><span className="attachment-copy"><strong>{pendingAttachment.file.name}</strong><small>Documento selecionado</small></span></>}
          {pendingAttachment.kind === "image" && <span className="attachment-copy"><strong>{pendingAttachment.file.name}</strong><small>Confira a imagem antes de enviar</small></span>}
        </div>
        <div className="attachment-preview-actions">
          <button type="button" className="outline" disabled={uploadingMedia} onClick={() => setPendingAttachment(null)}><X size={16} /> {pendingAttachment.kind === "audio" ? "Descartar" : "Cancelar"}</button>
          <button type="button" className="primary" disabled={uploadingMedia} onClick={() => void sendAttachment(pendingAttachment.file, pendingAttachment.kind, pendingAttachment.duration)}>{uploadingMedia ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />} {uploadingMedia ? "Enviando..." : pendingAttachment.kind === "audio" ? "Enviar áudio" : "Enviar arquivo"}</button>
        </div>
      </div>}
      <form className="composer" onSubmit={sendMessage}>
        <input ref={documentInputRef} className="composer-file-input" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt" onChange={(event) => { const file = event.target.files?.[0]; if (file) stageAttachment(file, "document"); event.currentTarget.value = ""; }} />
        <input ref={imageInputRef} className="composer-file-input" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) stageAttachment(file, "image"); event.currentTarget.value = ""; }} />
        <button type="button" title="Anexar documento" aria-label="Anexar documento" disabled={uploadingMedia} onClick={() => documentInputRef.current?.click()}><Paperclip size={20} /></button><button type="button" title="Enviar imagem" aria-label="Enviar imagem" disabled={uploadingMedia} onClick={() => imageInputRef.current?.click()}><Image size={19} /></button>
        <div className="composer-message-field">
          <textarea aria-label="Mensagem" aria-describedby="composer-shortcut" value={text} onChange={(event) => setText(event.target.value)} onPaste={pasteImage} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Escreva uma mensagem" rows={1} />
          <small id="composer-shortcut">Enter envia · Shift + Enter quebra linha · Ctrl + V cola print</small>
        </div>
        <button type={text.trim() && !recording ? "submit" : "button"} className={`send-button ${recording ? "recording" : ""}`} disabled={sending} onClick={text.trim() && !recording ? undefined : (event) => { event.preventDefault(); void toggleRecording(); }} aria-label={recording ? "Parar gravação" : text.trim() ? "Enviar" : "Gravar áudio"}>{recording ? <Mic size={19} /> : text.trim() ? <Send size={19} /> : <Mic size={19} />}</button>
      </form>
      {openImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Imagem em tamanho completo" onMouseDown={(event) => event.target === event.currentTarget && setOpenImage(null)}>
        <a className="image-lightbox-download" href={openImage.downloadUrl} download><Download size={18} /> Baixar imagem</a>
        <button type="button" className="image-lightbox-close" aria-label="Fechar imagem" onClick={() => setOpenImage(null)}><X size={22} /></button>
        <img src={openImage.url} alt={openImage.alt} />
      </div>}
      {tagModal && <Modal title="Etiquetas do lead" subtitle="Organize o atendimento. Toda alteração fica registrada no histórico." onClose={() => setTagModal(false)}><div className="tag-manager"><div className="tag-manager-grid">{tagData.tags.map((tag) => <button type="button" className="tag-choice" aria-pressed={tag.selected} disabled={Boolean(tagBusy)} onClick={() => void toggleTag(tag)} key={tag.id}><i style={{ backgroundColor: tag.color }} />{tag.name}{tag.selected && <Check size={13} />}</button>)}</div>{tagError && <p className="tag-manager-error" role="alert">{tagError}</p>}<h3>Histórico de alterações</h3><div className="tag-history">{tagData.history.map((entry) => <div className="tag-history-item" key={entry.id}><i style={{ backgroundColor: entry.color }} /><span><strong>{entry.name}</strong><small>{entry.action === "added" ? "Adicionada" : "Removida"} por {entry.actorName}</small></span><time>{new Date(entry.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time></div>)}{!tagData.history.length && <p className="tag-history-empty">Nenhuma alteração registrada.</p>}</div></div></Modal>}
    </div>
  );
}

function MessageBubble({ message, onImageOpen }: { message: Message; onImageOpen: (image: { url: string; alt: string; downloadUrl: string }) => void }) {
  const mediaUrl = message.mediaKey ? `/api/media/${encodeURIComponent(message.mediaKey)}` : null;
  const imageAlt = message.body ?? "Imagem enviada";
  const imageFileName = message.fileName?.trim() || `imagem-${message.id}`;
  const imageDownloadUrl = mediaUrl ? `${mediaUrl}?download=1&filename=${encodeURIComponent(imageFileName)}` : null;
  return (
    <div className={`message-row ${message.direction}`}>
      <div className={`bubble ${message.type}`}>
        {message.type === "image" && (mediaUrl && imageDownloadUrl ? <button type="button" className="message-image-link" aria-label="Abrir imagem em tamanho completo" title="Abrir imagem" onClick={() => onImageOpen({ url: mediaUrl, alt: imageAlt, downloadUrl: imageDownloadUrl })}><img className="message-image" src={mediaUrl} alt={imageAlt} /></button> : <div className="media-placeholder"><Image /></div>)}
        {message.type === "audio" && (mediaUrl ? <audio className="message-audio" controls preload="metadata" src={mediaUrl} /> : <div className="audio-player"><Mic size={18} /><span /><small>{message.duration ? `${message.duration}s` : "Áudio"}</small></div>)}
        {message.type === "document" && <a className="document-message" href={mediaUrl ?? undefined} target="_blank" rel="noreferrer"><FileText /><span><strong>{message.fileName ?? message.body ?? "Documento"}</strong><small>Abrir documento</small></span></a>}
        {message.body && message.type === "text" && <MessageText body={message.body} />}
        <footer>{formatTime(message.createdAt)} {message.direction === "outbound" && <span className={`message-status ${message.status}`}>· {message.status === "read" ? "Lido" : message.status === "delivered" ? "Entregue" : message.status === "failed" ? "Não enviado" : message.status === "sending" ? "Enviando" : "Enviado"} <CheckCheck size={12} /></span>}</footer>
      </div>
    </div>
  );
}

function splitMessageUrls(body: string): Array<{ text: string; url?: string }> {
  const parts: Array<{ text: string; url?: string }> = [];
  let cursor = 0;
  for (const match of body.matchAll(urlPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ text: body.slice(cursor, index) });
    const matched = match[0];
    const suffix = matched.match(trailingUrlPunctuation)?.[0] ?? "";
    const url = suffix ? matched.slice(0, -suffix.length) : matched;
    parts.push({ text: url, url });
    if (suffix) parts.push({ text: suffix });
    cursor = index + matched.length;
  }
  if (cursor < body.length) parts.push({ text: body.slice(cursor) });
  return parts;
}

function MessageText({ body }: { body: string }) {
  const parts = splitMessageUrls(body);
  const firstUrl = parts.find((part) => part.url)?.url ?? null;
  return <div className="message-text">
    <p>{parts.map((part, index) => part.url
      ? <a key={`${part.url}-${index}`} href={part.url} target="_blank" rel="noopener noreferrer">{part.text}</a>
      : <span key={index}>{part.text}</span>)}</p>
    {firstUrl && <LinkPreview url={firstUrl} />}
  </div>;
}

function LinkPreview({ url }: { url: string }) {
  const [preview, setPreview] = useState<LinkPreviewData | null>(null);
  useEffect(() => {
    let active = true;
    let request = linkPreviewCache.get(url);
    if (!request) {
      request = api<LinkPreviewData>(`/api/link-preview?url=${encodeURIComponent(url)}`).catch(() => null);
      linkPreviewCache.set(url, request);
    }
    void request.then((data) => { if (active) setPreview(data); });
    return () => { active = false; };
  }, [url]);
  if (!preview) return null;
  return <a className="link-preview" href={preview.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir prévia: ${preview.title}`}>
    <small>{preview.siteName}</small>
    <strong>{preview.title}</strong>
    {preview.description && <span>{preview.description}</span>}
  </a>;
}

function LeadsPage({ currentUserId, conversations, onOpen, onRefresh }: { currentUserId: string; conversations: Conversation[]; onOpen: (id: string) => void; onRefresh: () => Promise<void> }) {
  const leadsPerPage = 20;
  const [filter, setFilter] = useState<"all" | Classification>("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState<"7" | "30" | "90" | "all">("30");
  const [attendant, setAttendant] = useState("all");
  const [entryTime, setEntryTime] = useState<"all" | "morning" | "afternoon" | "evening">("all");
  const [page, setPage] = useState(1);
  const [entryTimeModal, setEntryTimeModal] = useState(false);
  const [team, setTeam] = useState<LeadAttendant[]>([]);
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = () => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      void api<{ attendants: LeadAttendant[] }>("/api/leads/attendants")
        .then((data) => { if (active) setTeam(data.attendants); })
        .catch(() => undefined)
        .finally(() => { inFlight = false; });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, []);
  const attendantNames = new Map<string, string>();
  for (const person of team) attendantNames.set(person.id, person.name);
  for (const item of conversations) {
    if (item.assigneeId && item.assigneeName) attendantNames.set(item.assigneeId, item.assigneeName);
    if (item.firstResponderId && item.firstResponderName) attendantNames.set(item.firstResponderId, item.firstResponderName);
  }
  const attendants = [...attendantNames].sort((left, right) => left[1].localeCompare(right[1], "pt-BR"));
  const cutoff = period === "all" ? null : Date.now() - Number(period) * 24 * 60 * 60 * 1000;
  const entryTimeLabel = { all: "Todos os horários", morning: "Manhã · 06h às 12h", afternoon: "Tarde · 12h às 18h", evening: "Noite · 18h às 06h" }[entryTime];
  const periodConversations = conversations.filter((item) => {
    const createdAt = new Date(item.createdAt);
    const hour = createdAt.getHours();
    const matchesTime = entryTime === "all" || (entryTime === "morning" && hour >= 6 && hour < 12) || (entryTime === "afternoon" && hour >= 12 && hour < 18) || (entryTime === "evening" && (hour >= 18 || hour < 6));
    return (!cutoff || createdAt.getTime() >= cutoff) && matchesTime;
  });
  const periodLeads = periodConversations.filter((item) => attendant === "all" || (attendant === "unassigned" ? !item.assigneeId : item.assigneeId === attendant));
  const answered = periodConversations.filter((item) => typeof item.firstResponseMinutes === "number" && Number.isFinite(item.firstResponseMinutes) && item.firstResponseMinutes >= 0
    && (attendant === "all" || (attendant === "unassigned" ? !item.assigneeId : item.firstResponderId === attendant)));
  const averageResponse = answered.length ? answered.reduce((total, item) => total + item.firstResponseMinutes!, 0) / answered.length : null;
  const teamById = new Map(team.map((person) => [person.id, person]));
  const responseByAttendant = attendants.map(([id, name]) => {
    const replies = periodConversations.filter((item) => item.firstResponderId === id && typeof item.firstResponseMinutes === "number" && Number.isFinite(item.firstResponseMinutes) && item.firstResponseMinutes >= 0);
    const average = replies.length ? replies.reduce((total, item) => total + item.firstResponseMinutes!, 0) / replies.length : null;
    const person = teamById.get(id);
    return { id, name, avatarUrl: person?.avatarUrl ?? null, online: id === currentUserId || Boolean(person?.online), activeCount: person?.activeCount ?? 0, waitingCount: person?.waitingCount ?? 0, average, count: replies.length };
  });
  const normalizedSearch = search.trim().toLocaleLowerCase("pt-BR");
  const leads = periodLeads.filter((item) => (filter === "all" || item.classification === filter) && `${item.name} ${item.phone} ${item.stage} ${item.assigneeName ?? ""}`.toLocaleLowerCase("pt-BR").includes(normalizedSearch));
  const totalPages = Math.max(1, Math.ceil(leads.length / leadsPerPage));
  const currentPage = Math.min(page, totalPages);
  const firstLeadIndex = (currentPage - 1) * leadsPerPage;
  const visibleLeads = leads.slice(firstLeadIndex, firstLeadIndex + leadsPerPage);
  useEffect(() => setPage(1), [filter, search, period, attendant, entryTime]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  const metrics = {
    total: periodLeads.length,
    hot: periodLeads.filter((item) => item.classification === "hot").length,
    warm: periodLeads.filter((item) => item.classification === "warm").length,
    cold: periodLeads.filter((item) => item.classification === "cold").length,
  };
  const graphDays = period === "7" ? 7 : period === "90" ? 14 : 10;
  const trendData = Array.from({ length: graphDays }, (_, index) => {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - (graphDays - 1 - index));
    const key = date.toISOString().slice(0, 10);
    return { key, label: date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }), total: periodLeads.filter((item) => item.createdAt.slice(0, 10) === key).length };
  });
  const trendMax = Math.max(...trendData.map((item) => item.total), 1);

  function exportReport() {
    const cell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const rows = [
      ["Nome", "Telefone", "Classificação", "Etapa", "Último contato", "Responsável"],
      ...leads.map((lead) => [lead.name, formatBrazilianPhone(lead.phone), classificationLabel[lead.classification], lead.stage, lead.lastMessageAt ? new Date(lead.lastMessageAt).toLocaleString("pt-BR") : "", lead.assigneeName ?? "Não atribuído"]),
    ];
    const blob = new Blob(["\ufeff", rows.map((row) => row.map(cell).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `leads-karrer-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function updateClassification(id: string, classification: Classification) {
    await api(`/api/leads/${id}/classification`, { method: "PATCH", body: JSON.stringify({ classification }) });
    await onRefresh();
  }

  return (
    <section className="page leads-page">
      <header className="leads-hero">
        <div><h1>Leads</h1><p>Atualizado agora <span>{metrics.total} contatos</span></p></div>
        <div className="leads-actions">
          <label><span>Período</span><select aria-label="Período dos leads" value={period} onChange={(event) => setPeriod(event.target.value as typeof period)}><option value="7">Últimos 7 dias</option><option value="30">Últimos 30 dias</option><option value="90">Últimos 90 dias</option><option value="all">Todo o período</option></select><ChevronDown size={14} /></label>
          <label><span>Atendente</span><select aria-label="Atendente responsável" value={attendant} onChange={(event) => setAttendant(event.target.value)}><option value="all">Todos os atendentes</option><option value="unassigned">Não atribuído</option>{attendants.map(([id, name]) => <option value={id} key={id}>{name}</option>)}</select><ChevronDown size={14} /></label>
          <button className="leads-export" onClick={exportReport} disabled={!leads.length} title={leads.length ? `Exportar ${leads.length} lead(s) filtrado(s)` : "Não há leads para exportar"}><Download size={15} /><span>Exportar relatório</span></button>
        </div>
      </header>
      <div className="leads-kpis">
        <Kpi label="Total de leads" value={metrics.total} detail="Visão consolidada" />
        <Kpi label="Quentes" value={metrics.hot} tone="hot" detail="Prioridade imediata" />
        <Kpi label="Mornos" value={metrics.warm} tone="warm" detail="Em acompanhamento" />
        <Kpi label="Frios" value={metrics.cold} tone="cold" detail="Reativação futura" />
      </div>
      <div className="leads-insights">
        <article className="lead-trend"><header><span>Novos por dia</span><button className="trend-filter" aria-haspopup="dialog" onClick={() => setEntryTimeModal(true)}>{entryTime === "all" ? "Filtrar por hora de entrada" : entryTimeLabel}<ChevronDown size={13} /></button></header><div className="lead-bars">{trendData.map((item) => <div key={item.key} title={`${item.label}: ${item.total} lead(s)`}><span>{item.total || ""}</span><i style={{ height: `${item.total ? Math.max(12, item.total / trendMax * 100) : 2}%` }} /><small>{item.label}</small></div>)}</div></article>
        <article className="lead-distribution"><div className="lead-donut" style={{ background: `conic-gradient(#1f1f1f 0 ${metrics.total ? metrics.hot / metrics.total * 100 : 0}%, #e7ac2d 0 ${metrics.total ? (metrics.hot + metrics.warm) / metrics.total * 100 : 0}%, #f0d277 0 100%)` }}><span>{metrics.total}</span></div><div className="lead-legend"><p><i className="hot" />Quente <strong>{metrics.hot}</strong></p><p><i className="warm" />Morno <strong>{metrics.warm}</strong></p><p><i className="cold" />Frio <strong>{metrics.cold}</strong></p></div><div className="response-time"><span title="Cada lead é medido da primeira mensagem recebida até a primeira resposta enviada pelo CRM. A média por atendente considera quem enviou essa resposta, mesmo após uma transferência.">{attendant !== "all" && attendant !== "unassigned" ? `Primeira resposta por lead de ${attendantNames.get(attendant) ?? "atendente"}` : "Tempo médio da primeira resposta por lead"}</span><strong>{formatResponseDuration(averageResponse)}</strong><small>{answered.length ? `${answered.length} ${answered.length === 1 ? "lead respondido" : "leads respondidos"}` : "Nenhuma resposta no período"}</small></div></article>
      </div>
      <section className="attendant-response" aria-label="Tempo médio por atendente">
        <header><div><h2>Equipe e primeira resposta</h2><p>Presença e atendimento agora · média por lead {period === "all" ? "de todo o período" : `dos últimos ${period} dias`}</p></div><small>{responseByAttendant.filter((person) => person.online).length} online · {responseByAttendant.filter((person) => person.online && person.activeCount > 0).length} atendendo agora</small></header>
        <div className="attendant-response-list">{responseByAttendant.map((person) => <div className={`attendant-response-person ${attendant === person.id ? "selected" : ""}`} key={person.id}>
          <Avatar name={person.name} imageUrl={person.avatarUrl} online={person.online} size="sm" />
          <span><strong>{person.name}</strong><small className="attendant-response-states"><em className={person.online ? "online" : "offline"}><i />{person.online ? "Online" : "Offline"}</em><em className={person.online && person.activeCount ? "busy" : "idle"}>{person.activeCount ? person.online ? `Atendendo ${person.activeCount} ${person.activeCount === 1 ? "lead" : "leads"}` : `${person.activeCount} ${person.activeCount === 1 ? "lead em andamento" : "leads em andamento"}` : person.waitingCount ? `Aguardando ${person.waitingCount} ${person.waitingCount === 1 ? "cliente" : "clientes"}` : "Sem atendimento ativo"}</em></small><small>{person.count ? `${person.count} ${person.count === 1 ? "lead respondido" : "leads respondidos"}` : "Nenhuma resposta no período"}</small></span>
          <b title="Tempo médio da primeira resposta por lead">{formatResponseDuration(person.average)}</b>
        </div>)}</div>
        {!responseByAttendant.length && <p className="attendant-response-empty">Nenhum usuário cadastrado.</p>}
      </section>
      <div className="leads-table">
        <div className="table-toolbar"><div className="chips"><Chip active={filter === "all"} onClick={() => setFilter("all")}>Todos</Chip>{(["hot", "warm", "cold"] as Classification[]).map((value) => <Chip key={value} active={filter === value} onClick={() => setFilter(value)}>{classificationLabel[value]}s</Chip>)}</div><SearchBox value={search} onChange={setSearch} placeholder="Buscar lead" /></div>
        <div className="lead-row lead-head"><span>Nome</span><span>Telefone</span><span>Classificação</span><span>Etapa</span><span>Último contato</span><span>Responsável</span><span /></div>
        {visibleLeads.map((lead) => <div className="lead-row" key={lead.id} onDoubleClick={() => onOpen(lead.id)}><span className="person"><Avatar name={lead.name} size="xs" /><strong>{lead.name}</strong></span><span data-label="Telefone">{formatBrazilianPhone(lead.phone)}</span><span data-label="Classificação"><select aria-label={`Classificação de ${lead.name}`} className={`classification-select ${lead.classification}`} value={lead.classification} onChange={(event) => void updateClassification(lead.id, event.target.value as Classification)}><option value="hot">Quente</option><option value="warm">Morno</option><option value="cold">Frio</option></select></span><span data-label="Etapa">{lead.stage}</span><span data-label="Último contato">{formatTime(lead.lastMessageAt)}</span><span data-label="Responsável">{lead.assigneeName ?? "Não atribuído"}</span><button aria-label={`Abrir ficha de ${lead.name}`} onClick={() => onOpen(lead.id)}>Abrir ficha <span>→</span></button></div>)}
        {leads.length === 0 && <Empty text={search || filter !== "all" || attendant !== "all" || entryTime !== "all" ? "Nenhum lead corresponde aos filtros." : "Nenhum lead neste período."} />}
        {leads.length > 0 && <nav className="leads-pagination" aria-label="Paginação de leads">
          <span>Mostrando {firstLeadIndex + 1}–{Math.min(firstLeadIndex + leadsPerPage, leads.length)} de {leads.length} leads</span>
          <div>
            <button type="button" aria-label="Página anterior" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Anterior</button>
            <strong>Página {currentPage} de {totalPages}</strong>
            <button type="button" aria-label="Próxima página" disabled={currentPage === totalPages} onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Próxima</button>
          </div>
        </nav>}
      </div>
      {entryTimeModal && <Modal title="Hora de entrada" subtitle="Filtre os leads pelo horário em que chegaram ao atendimento." onClose={() => setEntryTimeModal(false)}><div className="attendant-picker">{([
        ["all", "Todos os horários", "Exibir leads recebidos durante todo o dia"],
        ["morning", "Manhã", "Das 06h às 12h"],
        ["afternoon", "Tarde", "Das 12h às 18h"],
        ["evening", "Noite", "Das 18h às 06h"],
      ] as const).map(([value, label, detail]) => <button key={value} className={entryTime === value ? "selected" : ""} onClick={() => { setEntryTime(value); setEntryTimeModal(false); }}><CircleUserRound size={18} /><span><strong>{label}</strong><small>{detail}</small></span>{entryTime === value && <CheckCheck size={17} />}</button>)}</div></Modal>}
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
      <header className="lead-hero"><button onClick={onBack}><ArrowLeft size={17} /> Leads</button><Avatar name={conversation.name} /><div><h1>{conversation.name}</h1><p>{formatBrazilianPhone(conversation.phone)} · <em>{conversation.online ? "Online" : "Offline"}</em> · Origem: WhatsApp</p></div><button className="primary" onClick={onChat}>Abrir chat</button><button className="outline">Editar cadastro</button></header>
      <div className="detail-grid"><div className="card history-card"><div className="tabs"><button className="active">Histórico da conversa</button><button>Mídias e documentos</button><button>Anotações</button><button>Linha do tempo</button></div><div className="history-list">{messages.map((message) => <div key={message.id}><time>{new Date(message.createdAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</time><p><strong>{message.direction === "inbound" ? conversation.name.split(" ")[0] : "Karrer"}</strong> — {message.type === "text" ? message.body : `${message.type === "audio" ? "Áudio" : message.type === "image" ? "Imagem" : "Documento"}${message.body ? ` · ${message.body}` : ""}`}</p></div>)}</div><footer>Histórico somente leitura · para responder, abra o chat.</footer></div>
        <aside className="detail-aside"><div className="classification-card"><span className="eyebrow">Classificação</span><div className="segmented">{(["hot", "warm", "cold"] as Classification[]).map((value) => <button key={value} className={conversation.classification === value ? value : ""} onClick={() => void classify(value)}>{classificationLabel[value]}</button>)}</div><p><span>Pontuação</span><strong>{conversation.score} / 100</strong></p><progress max="100" value={conversation.score} /><ul><li>Respondeu em menos de 5 min</li><li>Enviou documentação</li><li>Interações recentes</li><li className="pending">Contrato de honorários pendente</li></ul></div><div className="card data-card"><span className="eyebrow">Dados do cliente</span><dl><dt>Telefone</dt><dd>{formatBrazilianPhone(conversation.phone)}</dd><dt>Banco</dt><dd>{conversation.bank ?? "Não informado"}</dd><dt>Etapa</dt><dd><strong>{conversation.stage}</strong></dd><dt>Responsável</dt><dd>{conversation.assigneeName ?? "Não atribuído"}</dd></dl></div><div className="card notes-card"><span className="eyebrow">Anotações internas</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Adicionar nota..." /><button className="primary" onClick={() => void saveNote()}>Salvar nota</button></div></aside></div>
    </section>
  );
}

function ClientsPage({ contacts, googleDrive, onRefresh }: { contacts: Contact[]; googleDrive: boolean; onRefresh: () => Promise<void> }) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cepStatus, setCepStatus] = useState("");
  const [clientNotice, setClientNotice] = useState<{ message: string; tone: "success" | "error" } | null>(null);
  const [documentCount, setDocumentCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const selected = contacts.find((contact) => contact.id === selectedId) ?? null;
  const visible = contacts.filter((contact) => `${contact.name} ${contact.phone}`.toLowerCase().includes(search.toLowerCase()));
  const completeContacts = contacts.filter((contact) => contact.profileComplete).length;
  const pendingContacts = contacts.length - completeContacts;
  const bankContacts = contacts.filter((contact) => Boolean(contact.bank)).length;
  function edit(contact: Contact) {
    setSelectedId(contact.id); setClientNotice(null); setCepStatus(""); setDocumentCount(0);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }
  function newClient() { setSelectedId(null); setClientNotice(null); setCepStatus(""); setDocumentCount(0); }
  async function fillAddress(event: FocusEvent<HTMLInputElement>) {
    const cep = event.currentTarget.value.replace(/\D/g, "");
    if (cep.length !== 8) { if (cep) setCepStatus("Informe os 8 números do CEP."); return; }
    const form = event.currentTarget.form;
    if (!form) return;
    setCepStatus("Buscando endereço...");
    try {
      const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const address = await response.json() as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!response.ok || address.erro) throw new Error("CEP não encontrado.");
      const set = (name: string, value = "") => { const field = form.elements.namedItem(name); if (field instanceof HTMLInputElement) field.value = value; };
      set("addressLine", [address.logradouro, address.bairro].filter(Boolean).join(" · "));
      set("city", address.localidade); set("state", address.uf);
      event.currentTarget.value = cep.replace(/(\d{5})(\d{3})/, "$1-$2");
      setCepStatus("Endereço preenchido. Complete com o número.");
    } catch (reason) { setCepStatus(reason instanceof Error ? reason.message : "Não foi possível consultar o CEP."); }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setClientNotice(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const documents = formData.getAll("documents").filter((item): item is File => item instanceof File && item.size > 0);
    const data = Object.fromEntries(formData.entries()); delete data.documents;
    try {
      const contact = await api<{ id: string }>(selected ? `/api/contacts/${selected.id}` : "/api/contacts", { method: selected ? "PATCH" : "POST", body: JSON.stringify(data) });
      const warnings: string[] = [];
      try { await onRefresh(); }
      catch { warnings.push("A lista não pôde ser atualizada; recarregue a página para conferir os dados."); }
      if (!selected) { form.reset(); setDocumentCount(0); setCepStatus(""); }
      if (documents.length) {
        try {
          const upload = new FormData(); documents.forEach((file) => upload.append("documents", file));
          await api(`/api/contacts/${contact.id}/documents`, { method: "POST", body: upload });
          setDocumentCount(0);
          const fileInput = form.elements.namedItem("documents");
          if (fileInput instanceof HTMLInputElement) fileInput.value = "";
        } catch (reason) {
          warnings.push(`O envio dos documentos falhou: ${reason instanceof Error ? reason.message : "tente novamente."}`);
        }
      }
      const message = selected ? "Dados do cliente atualizados no banco." : "Cliente salvo no banco.";
      setClientNotice({ message: `${message}${warnings.length ? ` ${warnings.join(" ")}` : documents.length ? " Documentos enviados." : ""}`, tone: warnings.length ? "error" : "success" });
    } catch (reason) { setClientNotice({ message: reason instanceof Error ? reason.message : "Não foi possível salvar o cliente.", tone: "error" }); }
    finally { setBusy(false); }
  }
  return (
    <section className="page clients-page"><header className="clients-hero"><div><h1>Cadastro de clientes</h1><p>WhatsApp vinculado às conversas <span>{contacts.length} contatos</span></p></div><SearchBox value={search} onChange={setSearch} placeholder="Buscar cliente" /></header><div className="clients-kpis"><Kpi label="Total de clientes" value={contacts.length} detail="Base consolidada" /><Kpi label="Cadastros completos" value={completeContacts} detail="Dados conferidos" /><Kpi label="Pendentes" value={pendingContacts} detail="Aguardam informações" /><Kpi label="Com banco informado" value={bankContacts} detail="Prontos para triagem" /></div><div className="clients-grid"><form key={selected?.id ?? "new"} ref={formRef} className="card client-form" onSubmit={submit}><div className="form-title"><CircleUserRound size={32} /><div><h2>{selected ? "Editar cliente" : "Novo cliente"}</h2><p>{selected ? `Alterando cadastro de ${selected.name ?? selected.phone}` : "Campos com * são obrigatórios"}</p></div></div><span className="eyebrow">Dados pessoais</span><div className="form-grid"><Field label={selected ? "Nome completo" : "Nome completo *"} name="name" defaultValue={selected?.name ?? ""} autoComplete="name" required={!selected} /><Field label="WhatsApp *" name="phone" defaultValue={selected?.phone ?? ""} inputMode="tel" autoComplete="tel" placeholder="5592999999999" required /><Field label={selected ? "CPF" : "CPF *"} name="cpf" defaultValue={selected?.cpf ?? ""} inputMode="numeric" placeholder="000.000.000-00" required={!selected} /><Field label="RG" name="rg" defaultValue={selected?.rg ?? ""} /><Field label="Órgão emissor" name="rgIssuer" defaultValue={selected?.rgIssuer ?? ""} /><Field label="Data de nascimento" name="birthDate" defaultValue={selected?.birthDate ?? ""} type="date" /><Field label="E-mail" name="email" defaultValue={selected?.email ?? ""} type="email" autoComplete="email" /></div><span className="eyebrow">Endereço</span><div className="form-grid address"><Field label="CEP" name="postalCode" defaultValue={selected?.postalCode ?? ""} inputMode="numeric" autoComplete="postal-code" placeholder="00000-000" maxLength={9} onBlur={fillAddress} /><Field label="Logradouro, bairro e número" name="addressLine" defaultValue={selected?.addressLine ?? ""} autoComplete="street-address" /><Field label="Cidade" name="city" defaultValue={selected?.city ?? ""} autoComplete="address-level2" /><Field label="UF" name="state" defaultValue={selected?.state ?? ""} autoComplete="address-level1" maxLength={2} /></div>{cepStatus && <small className="cep-status" aria-live="polite">{cepStatus}</small>}<span className="eyebrow">Atendimento</span><div className="form-grid thirds"><Field label="Banco / Financeira" name="bank" defaultValue={selected?.bank ?? ""} /><label>Classificação<select name="classification" defaultValue={selected?.classification ?? "warm"}><option value="hot">Quente</option><option value="warm">Morno</option><option value="cold">Frio</option></select></label><Field label="CCB" name="ccb" defaultValue={selected?.ccb ?? ""} /></div>{googleDrive ? <label className="dropzone"><Paperclip /> <span>{documentCount ? `${documentCount} documento(s) selecionado(s)` : "Selecionar documentos para salvar no Google Drive"}</span><input name="documents" type="file" multiple onChange={(event) => setDocumentCount(event.target.files?.length ?? 0)} /></label> : <div className="dropzone drive-pending"><Paperclip /> <span>Google Drive aguardando configuração do administrador</span></div>}{clientNotice && <div className={`client-notice ${clientNotice.tone}`} role="status">{clientNotice.message}</div>}<div className="form-actions">{selected ? <button type="button" className="outline" disabled={busy} onClick={newClient}>Novo cliente</button> : <button type="reset" className="outline" onClick={() => { setCepStatus(""); setClientNotice(null); setDocumentCount(0); }}>Limpar formulário</button>}<button className="primary" disabled={busy}>{busy ? "Salvando..." : selected ? "Salvar alterações" : "Salvar cliente"}</button></div></form><aside className="card recent-card"><header><div><span>Base de clientes</span><h2>Clientes</h2></div><strong>{visible.length}</strong></header><p className="recent-hint">Selecione um cliente para editar seus dados.</p><div className="recent-list">{visible.map((contact) => <button type="button" className={`recent-person ${selectedId === contact.id ? "selected" : ""}`} aria-label={`Editar ${contact.name ?? contact.phone}`} aria-pressed={selectedId === contact.id} key={contact.id} onClick={() => edit(contact)}><Avatar name={contact.name} size="xs" /><span><strong>{contact.name ?? contact.phone}</strong><small>{contact.bank ?? "Sem banco informado"}</small></span><i title={contact.profileComplete ? "Cadastro completo" : "Cadastro pendente"} className={contact.profileComplete ? "complete" : ""} /></button>)}{visible.length === 0 && <Empty text={search ? "Nenhum cliente corresponde à busca." : "Nenhum cliente cadastrado."} />}</div><div className="pending-box"><strong>{pendingContacts} contatos pendentes de cadastro</strong><span>Chegaram pelo WhatsApp sem ficha completa.</span></div></aside></div></section>
  );
}

type SettingsModal = { kind: "password" | "delete" | "email" | "profile"; user?: ManagedUser } | null;
const accessLabels: Array<{ key: keyof Permissions; label: string }> = [
  { key: "chat", label: "Chat" }, { key: "leads", label: "Leads" }, { key: "clients", label: "Clientes" },
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
  useEffect(() => {
    void loadUsers();
    const refresh = () => { if (document.visibilityState === "visible") void loadUsers(); };
    const timer = window.setInterval(refresh, 2 * 60 * 1000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [loadUsers]);

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
    <div className="page-heading settings-heading"><div><span className="eyebrow">Administração</span><h1>Configurações</h1><p>Gerencie segurança, usuários, presença e acessos por área.</p></div></div>
    {notice && <div className="notice success">{notice}</div>}{error && !modal && <div className="notice error">{error}</div>}
    <div className="settings-overview">
      <div className="card security-card"><Avatar name={currentUser.name} imageUrl={currentUser.avatarUrl} /><div><span className="eyebrow">Minha conta</span><h2>{currentUser.name}</h2><p>{currentUser.email} · Administrador mestre</p></div><button className="outline" onClick={() => open({ kind: "password" })}><KeyRound size={16} /> Alterar minha senha</button></div>
      <div className="card access-summary"><span className="eyebrow">Equipe</span><strong>{users.filter((user) => user.active).length}</strong><p>usuários ativos</p><small>{users.length} contas cadastradas</small></div>
    </div>
    <div className="card online-team"><header><div><span className="eyebrow">Presença agora</span><h2>Equipe online</h2></div><strong>{users.filter((user) => user.online).length}</strong></header><div className="online-team-list">{users.filter((user) => user.online).map((user) => <button type="button" key={user.id} onClick={() => open({ kind: "profile", user })}><Avatar name={user.name} imageUrl={user.avatarUrl} size="sm" online /><span><strong>{user.name}</strong><small>{user.professionalRole ?? "Equipe Karrer"}{user.instagram ? ` · ${user.instagram}` : ""}</small></span></button>)}{!users.some((user) => user.online) && <p>Nenhum usuário online neste momento.</p>}</div></div>
    <div className="card users-card"><div className="users-card-head"><div><h2>Usuários e permissões</h2><p>Somente você, como administrador mestre, pode alterar funções e acessos. As mudanças são validadas pela API.</p></div></div>
      <div className="users-table users-table-head"><span>Usuário</span><span>Status</span>{accessLabels.map(({ key, label }) => <span key={key}>{label}</span>)}<span>Ações</span></div>
      {users.map((user) => <div className={`users-table ${user.active ? "" : "disabled-user"}`} key={user.id}><button type="button" className="managed-person" onClick={() => open({ kind: "profile", user })} aria-label={`Ver informações de ${user.name}`}><Avatar name={user.name} imageUrl={user.avatarUrl} size="sm" /><span><strong>{user.name}{user.id === currentUser.id && <em>Você</em>}{!user.emailVerified && <em className="pending-verification">E-mail pendente</em>}</strong><small>{user.email}</small><small>{user.professionalRole ?? "Administrador"}{user.instagram ? ` · ${user.instagram}` : ""}</small></span></button><div className="presence-control"><span className={`presence-badge ${user.online ? "online" : ""}`}><i />{user.online ? "Online" : "Offline"}</span><Toggle checked={user.active} disabled={user.role === "admin"} label="Usuário ativo" onChange={(checked) => void updateAccess(user, { active: checked })} /></div>{accessLabels.map(({ key }) => <div key={key}><Toggle checked={user.permissions[key]} disabled={user.role === "admin" || !user.active} label={`Acesso a ${key}`} onChange={() => void updateAccess(user, { permission: key })} /></div>)}<div className="user-actions"><button title="Enviar redefinição de senha" disabled={!user.emailVerified} onClick={() => open({ kind: "email", user })}><Mail size={16} /></button><button className="danger-icon" title="Excluir usuário" disabled={user.role === "admin" || user.id === currentUser.id} onClick={() => open({ kind: "delete", user })}><Trash2 size={16} /></button></div></div>)}
      {!users.length && <Empty text="Nenhum usuário cadastrado." />}
    </div>

    {modal?.kind === "password" && <Modal title="Alterar minha senha" subtitle="As outras sessões abertas serão encerradas." onClose={() => setModal(null)}><form className="modal-form" onSubmit={changeOwnPassword}><Field label="Senha atual" name="currentPassword" type="password" required /><Field label="Nova senha" name="newPassword" type="password" minLength={10} required /><Field label="Confirmar nova senha" name="confirmation" type="password" minLength={10} required />{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Salvando..." : "Alterar senha"}</button></div></form></Modal>}
    {modal?.kind === "delete" && modal.user && <Modal title="Excluir usuário?" subtitle={`O acesso de ${modal.user.name} será removido permanentemente.`} tone="danger" onClose={() => setModal(null)}>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="danger-button" disabled={busy} onClick={() => void removeUser()}>{busy ? "Excluindo..." : "Excluir usuário"}</button></div></Modal>}
    {modal?.kind === "email" && modal.user && <Modal title="Enviar redefinição?" subtitle={`Enviaremos um link seguro para ${modal.user.email}. O link expira em 30 minutos.`} onClose={() => setModal(null)}>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button className="outline" onClick={() => setModal(null)}>Cancelar</button><button className="primary" disabled={busy} onClick={() => void emailReset()}>{busy ? "Enviando..." : "Enviar e-mail"}</button></div></Modal>}
    {modal?.kind === "profile" && modal.user && <Modal title="Informações do usuário" subtitle="Perfil, presença e acessos cadastrados no sistema." onClose={() => setModal(null)}><div className="user-profile-modal"><div className="user-profile-hero"><Avatar name={modal.user.name} imageUrl={modal.user.avatarUrl} online={modal.user.online} /><div><h3>{modal.user.name}</h3><p>{modal.user.professionalRole ?? (modal.user.role === "admin" ? "Administrador mestre" : "Equipe Karrer")}</p><span className={`profile-state ${modal.user.online ? "online" : ""}`}><i />{modal.user.online ? "Online agora" : modal.user.lastSeenAt ? `Visto por último ${new Date(modal.user.lastSeenAt).toLocaleString("pt-BR")}` : "Offline"}</span></div></div><dl className="user-profile-details"><div><dt>E-mail</dt><dd>{modal.user.email}</dd></div><div><dt>Instagram</dt><dd>{modal.user.instagram || "Não informado"}</dd></div><div><dt>Tipo de acesso</dt><dd>{modal.user.role === "admin" ? "Administrador mestre" : "Usuário da equipe"}</dd></div><div><dt>Conta</dt><dd>{modal.user.active ? "Ativa" : "Desativada"} · {modal.user.emailVerified ? "E-mail confirmado" : "E-mail pendente"}</dd></div><div><dt>Cadastrado em</dt><dd>{new Date(modal.user.createdAt).toLocaleString("pt-BR")}</dd></div></dl><div className="user-profile-permissions"><span>Acessos liberados</span><div>{accessLabels.map(({ key, label }) => <em className={modal.user!.permissions[key] ? "allowed" : ""} key={key}>{label}</em>)}</div><small>{modal.user.role === "admin" ? "O administrador mestre possui acesso completo e protegido." : "As permissões só podem ser alteradas por você, administrador mestre."}</small></div></div></Modal>}
  </section>;
}

function Toggle({ checked, defaultChecked, disabled, label, name, onChange }: { checked?: boolean; defaultChecked?: boolean; disabled?: boolean; label: string; name?: string; onChange?: (checked: boolean) => void }) {
  const state = checked === undefined ? { defaultChecked } : { checked };
  return <label className="toggle" title={label}><input type="checkbox" name={name} {...state} disabled={disabled} onChange={(event) => onChange?.(event.target.checked)} /><span /></label>;
}

function formatAudioDuration(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function AudioPreview({ src, recordedDuration }: { src: string; recordedDuration?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(recordedDuration ?? 0);

  function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) void audio.play(); else audio.pause();
  }

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = value;
    setCurrentTime(value);
  }

  return <div className="audio-preview-player">
    <audio ref={audioRef} src={src} preload="metadata" onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : recordedDuration ?? 0)} onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
    <button type="button" className="audio-preview-play" onClick={togglePlayback} aria-label={playing ? "Pausar prévia do áudio" : "Ouvir prévia do áudio"}>{playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}</button>
    <span className="audio-preview-mic"><Mic size={18} /></span>
    <div className="audio-preview-body"><span><strong>Prévia do áudio</strong><small>Ouça antes de enviar</small></span><div className="audio-preview-track"><input type="range" min={0} max={Math.max(duration, 0.1)} step="0.01" value={Math.min(currentTime, Math.max(duration, 0.1))} onChange={(event) => seek(Number(event.target.value))} aria-label="Posição da prévia do áudio" style={{ "--audio-progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties} /><time>{formatAudioDuration(currentTime)} / {formatAudioDuration(duration)}</time></div></div>
  </div>;
}

function Modal({ title, subtitle, tone, onClose, children }: { title: string; subtitle: string; tone?: "danger"; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const close = (event: KeyboardEvent) => event.key === "Escape" && onClose(); addEventListener("keydown", close); return () => removeEventListener("keydown", close); }, [onClose]);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal-card ${tone ?? ""}`} role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose} aria-label="Fechar"><X size={18} /></button><div className="modal-mark">{tone === "danger" ? <Trash2 /> : <ShieldCheck />}</div><h2>{title}</h2><p>{subtitle}</p>{children}</section></div>;
}

function formatWaitingTime(waitingSince: string, now: number): string {
  const minutes = Math.max(0, Math.floor((now - new Date(waitingSince).getTime()) / 60_000));
  if (minutes < 1) return "menos de 1 min";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}min` : `${hours}h`;
}

function ConversationRow({ conversation, active, now, onClick }: { conversation: Conversation; active: boolean; now: number; onClick: () => void }) { return <button className={`conversation-row ${active ? "active" : ""}`} onClick={onClick}><Avatar name={conversation.name} imageUrl={conversation.avatarUrl} online={conversation.online} size="sm" /><span><strong>{conversation.name}</strong><small>{conversation.lastMessageType === "audio" ? "Áudio" : conversation.lastMessage ?? conversation.stage}</small><span className="conversation-meta"><em className={`conversation-service-status ${conversation.serviceStatus}`}>{serviceStatusLabel[conversation.serviceStatus]}</em>{conversation.lunaAutonomousEnabled && <em className="conversation-luna"><Bot size={11} />Luna ativa</em>}{conversation.waitingSince && <em className="conversation-waiting"><Clock3 size={11} />Aguardando há {formatWaitingTime(conversation.waitingSince, now)}</em>}{conversation.assigneeName && <em className="conversation-assignee"><i />{conversation.assigneeName} atendendo</em>}</span></span><time>{formatTime(conversation.lastMessageAt)}{conversation.unreadCount > 0 && <b aria-label={`${conversation.unreadCount} ${conversation.unreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}`}>{conversation.unreadCount}</b>}</time></button>; }
function Brand() { return <div className="brand"><img src="/karrer-logo.png" alt="Karrer & Advogados" /></div>; }
function Avatar({ name, imageUrl, online, size = "md" }: { name: string | null; imageUrl?: string | null; online?: boolean; size?: "xs" | "sm" | "md" }) { const [failed, setFailed] = useState(false); useEffect(() => setFailed(false), [imageUrl]); return <div className={`avatar ${size}`}>{imageUrl && !failed ? <img src={imageUrl} alt={`Foto de ${name ?? "usuário"}`} loading="lazy" onError={() => setFailed(true)} /> : initials(name)}{online && <i />}</div>; }
function ClassificationBadge({ value }: { value: Classification }) { return <span className={`badge ${value}`}>Lead {classificationLabel[value].toLowerCase()}</span>; }
function CompactSelect({ className, label, value, options, disabled, icon, onChange }: { className: string; label: string; value: string; options: Array<{ value: string; label: string }>; disabled?: boolean; icon?: React.ReactNode; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [open]);
  return <div ref={rootRef} className={`compact-select ${className} ${open ? "open" : ""}`}>
    <button type="button" className="compact-select-trigger" aria-label={label} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((current) => !current)}>
      {icon && <span className="compact-select-icon">{icon}</span>}
      <span className="compact-select-copy"><small>{label === "Direcionar atendimento" ? "Atendente" : "Status"}</small><strong>{selected?.label ?? "Selecione"}</strong></span>
      <ChevronDown className="compact-select-chevron" size={15} />
    </button>
    {open && <div className="compact-select-menu" role="listbox" aria-label={`${label} — opções`}>{options.map((option) => <button type="button" role="option" aria-selected={option.value === value} className={option.value === value ? "selected" : ""} key={option.value || "empty"} onClick={() => { onChange(option.value); setOpen(false); }}><span>{option.label}</span><Check size={15} /></button>)}</div>}
  </div>;
}
function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) { return <label className="search-box"><Search size={16} /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>; }
function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button className={`chip ${active ? "active" : ""}`} onClick={onClick}>{children}</button>; }
function Kpi({ label, value, detail, dark, tone }: { label: string; value: number; detail: string; dark?: boolean; tone?: Classification }) { return <div className={`kpi ${dark ? "dark" : ""} ${tone ?? ""}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>; }
function Field(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) { const { label, ...input } = props; return <label>{label}<input {...input} /></label>; }
function Empty({ text, large, dark }: { text: string; large?: boolean; dark?: boolean }) { return <div className={`empty ${large ? "large" : ""} ${dark ? "dark" : ""}`}><MessageCircle /><p>{text}</p></div>; }

export default App;
