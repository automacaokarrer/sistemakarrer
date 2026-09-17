import { AtSign, ImagePlus, LoaderCircle, Send, Users, X } from "lucide-react";
import { type ClipboardEvent, type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, formatTime, initials } from "./api";
import type { User } from "./types";
import "./team-chat.css";

interface Member { id: string; name: string; online: boolean }
interface TeamMessage {
  id: number;
  authorId: string | null;
  authorName: string;
  body: string | null;
  imageUrl: string | null;
  mentionAll: boolean;
  mentions: Array<{ id: string; name: string }>;
  createdAt: string;
}
interface Summary { members: Member[]; unreadCount: number; mentionCount: number }
interface MessagePage { messages: TeamMessage[]; hasMore: boolean; nextCursor: number | null }

export function TeamChat({ user, open, onClose, onCounts }: {
  user: User; open: boolean; onClose: () => void; onCounts: (unread: number, mentions: number) => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [body, setBody] = useState("");
  const [mentionIds, setMentionIds] = useState<string[]>([]);
  const [mentionAll, setMentionAll] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [openImage, setOpenImage] = useState<string | null>(null);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const refreshSummary = useCallback(async () => {
    const result = await api<Summary>("/api/team-chat/summary");
    setMembers(result.members);
    onCounts(result.unreadCount, result.mentionCount);
  }, [onCounts]);

  const markRead = useCallback(async (id: number) => {
    await api("/api/team-chat/read", { method: "POST", body: JSON.stringify({ messageId: id }) });
    await refreshSummary();
  }, [refreshSummary]);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api<MessagePage>("/api/team-chat/messages");
      setMessages(result.messages);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
      if (result.messages.length) await markRead(result.messages.at(-1)!.id);
      requestAnimationFrame(() => endRef.current?.scrollIntoView());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar o chat interno.");
    } finally { setLoading(false); }
  }, [markRead]);

  useEffect(() => {
    void refreshSummary().catch(() => undefined);
    const refresh = () => { if (document.visibilityState === "visible") void refreshSummary().catch(() => undefined); };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); };
  }, [refreshSummary]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let timer: number | null = null;
    let heartbeat: number | null = null;
    let stopped = false;
    const connect = () => {
      if (stopped) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${location.host}/api/team-chat/ws`);
      socket.onopen = () => {
        void refreshSummary().catch(() => undefined);
        if (openRef.current) void loadMessages();
        heartbeat = window.setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send("ping"); }, 25_000);
      };
      socket.onmessage = (event) => {
        if (event.data === "pong") return;
        try {
          const data = JSON.parse(event.data) as { type?: string; message?: TeamMessage };
          if (data.type !== "team.message" || !data.message) return;
          if (openRef.current) {
            setMessages((current) => current.some((item) => item.id === data.message!.id) ? current : [...current, data.message!]);
            void markRead(data.message.id).catch(() => undefined);
            requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
          } else void refreshSummary().catch(() => undefined);
        } catch { /* Ignore malformed control messages. */ }
      };
      socket.onclose = () => {
        if (heartbeat !== null) window.clearInterval(heartbeat);
        heartbeat = null;
        if (!stopped) timer = window.setTimeout(connect, 1_500);
      };
    };
    connect();
    return () => { stopped = true; if (timer !== null) window.clearTimeout(timer); if (heartbeat !== null) window.clearInterval(heartbeat); socket?.close(); };
  }, [loadMessages, markRead, refreshSummary]);

  useEffect(() => { if (open) { setError(""); void loadMessages(); } }, [open, loadMessages]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { if (openImage) setOpenImage(null); else onClose(); } };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [open, openImage, onClose]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function loadOlder() {
    if (!nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await api<MessagePage>(`/api/team-chat/messages?before=${nextCursor}`);
      setMessages((current) => [...result.messages.filter((item) => !current.some((existing) => existing.id === item.id)), ...current]);
      setHasMore(result.hasMore);
      setNextCursor(result.nextCursor);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível carregar mensagens anteriores."); }
    finally { setLoadingOlder(false); }
  }

  function stageImage(file: File) {
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) { setError("Use um print JPG, PNG ou WebP."); return; }
    if (file.size > 8 * 1024 * 1024) { setError("O print deve ter no máximo 8 MB."); return; }
    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(URL.createObjectURL(file));
    setError("");
  }

  function pasteImage(event: ClipboardEvent<HTMLTextAreaElement>) {
    const entry = Array.from(event.clipboardData.items).find((item) => item.kind === "file" && item.type.startsWith("image/"));
    if (!entry) return;
    event.preventDefault();
    const file = entry.getAsFile();
    if (file) stageImage(file);
  }

  function clearImage() {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (sending || (!body.trim() && !image)) return;
    setSending(true);
    setError("");
    const form = new FormData();
    form.set("body", body);
    form.set("mentionUserIds", JSON.stringify(mentionIds));
    form.set("mentionAll", String(mentionAll));
    if (image) form.set("image", image);
    try {
      const result = await api<{ message: TeamMessage }>("/api/team-chat/messages", { method: "POST", body: form });
      setMessages((current) => current.some((item) => item.id === result.message.id) ? current : [...current, result.message]);
      setBody(""); setMentionIds([]); setMentionAll(false); clearImage();
      await markRead(result.message.id);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth" }));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível enviar ao chat interno."); }
    finally { setSending(false); }
  }

  if (!open) return null;
  const onlineCount = members.filter((member) => member.online).length;
  return createPortal(<>
    <div className="team-chat-backdrop" onClick={onClose} />
    <section className="team-chat-panel" role="dialog" aria-label="Chat interno da equipe">
      <header className="team-chat-header"><div><strong>Chat interno</strong><span><i /> {onlineCount} online na equipe</span></div><button type="button" aria-label="Fechar chat interno" onClick={onClose}><X size={19} /></button></header>
      <div className="team-chat-members" aria-label="Equipe online">
        {members.map((member) => <span key={member.id} className={member.online ? "online" : ""} title={`${member.name} · ${member.online ? "Online" : "Offline"}`}><i />{member.name.split(" ")[0]}</span>)}
      </div>
      <div className="team-chat-history">
        {hasMore && <button type="button" className="team-chat-older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "Carregando..." : "Carregar mensagens anteriores"}</button>}
        {loading && <p className="team-chat-empty"><LoaderCircle className="spin" size={18} /> Carregando...</p>}
        {!loading && messages.length === 0 && <p className="team-chat-empty">Comece uma conversa com a equipe.</p>}
        {messages.map((message) => <article key={message.id} className={`team-chat-message ${message.authorId === user.id ? "mine" : ""}`}>
          <span className="team-chat-avatar">{initials(message.authorName)}</span>
          <div><header><strong>{message.authorId === user.id ? "Você" : message.authorName}</strong><time>{formatTime(message.createdAt)}</time></header>
            {(message.mentionAll || message.mentions.length > 0) && <div className="team-chat-mentions">{message.mentionAll && <span>@todos</span>}{message.mentions.map((person) => <span key={person.id}>@{person.name}</span>)}</div>}
            {message.body && <p>{message.body}</p>}
            {message.imageUrl && <button type="button" className="team-chat-image" onClick={() => setOpenImage(message.imageUrl)} aria-label={`Abrir print de ${message.authorName}`}><img src={message.imageUrl} alt={`Print enviado por ${message.authorName}`} loading="lazy" /></button>}
          </div>
        </article>)}
        <div ref={endRef} />
      </div>
      <form className="team-chat-composer" onSubmit={(event) => void sendMessage(event)}>
        {error && <p className="team-chat-error" role="alert">{error}</p>}
        {(mentionAll || mentionIds.length > 0) && <div className="team-chat-selected-mentions">{mentionAll && <button type="button" onClick={() => setMentionAll(false)}>@todos <X size={12} /></button>}{mentionIds.map((id) => { const person = members.find((member) => member.id === id); return person && <button type="button" key={id} onClick={() => setMentionIds((current) => current.filter((item) => item !== id))}>@{person.name} <X size={12} /></button>; })}</div>}
        {preview && <div className="team-chat-preview"><img src={preview} alt="Prévia do print" /><span>{image?.name || "Print colado"}</span><button type="button" onClick={clearImage} aria-label="Remover print"><X size={16} /></button></div>}
        {pickerOpen && <div className="team-chat-picker" role="listbox" aria-label="Marcar pessoas"><button type="button" role="option" aria-selected={mentionAll} onClick={() => { setMentionAll(true); setMentionIds([]); setPickerOpen(false); }}><Users size={15} /> @todos</button>{members.filter((member) => member.id !== user.id).map((member) => <button type="button" role="option" aria-selected={mentionIds.includes(member.id)} key={member.id} onClick={() => { setMentionAll(false); setMentionIds((current) => current.includes(member.id) ? current : [...current, member.id]); setPickerOpen(false); }}><i className={member.online ? "online" : ""} /> @{member.name}</button>)}</div>}
        <textarea aria-label="Mensagem para a equipe" placeholder="Escreva para a equipe..." value={body} onChange={(event) => setBody(event.target.value)} onPaste={pasteImage} maxLength={4_000} rows={2} disabled={sending} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} />
        <div className="team-chat-actions"><button type="button" aria-label="Marcar pessoas" title="Marcar pessoas" onClick={() => setPickerOpen((current) => !current)}><AtSign size={18} /></button><button type="button" aria-label="Anexar print" title="Anexar print" onClick={() => inputRef.current?.click()}><ImagePlus size={18} /></button><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) stageImage(file); }} /><small>Enter envia · Shift + Enter quebra linha · Ctrl + V cola print</small><button type="submit" className="team-chat-send" disabled={sending || (!body.trim() && !image)} aria-label="Enviar ao chat interno">{sending ? <LoaderCircle className="spin" size={18} /> : <Send size={18} />}</button></div>
      </form>
    </section>
    {openImage && <div className="team-chat-lightbox" role="dialog" aria-label="Print em tamanho completo" onClick={() => setOpenImage(null)}><button type="button" aria-label="Fechar print" onClick={() => setOpenImage(null)}><X size={20} /></button><img src={openImage} alt="Print em tamanho completo" onClick={(event) => event.stopPropagation()} /></div>}
  </>, document.body);
}
