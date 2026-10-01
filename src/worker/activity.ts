import { HttpError, json } from "./http";
import type { AppEnv } from "./types";

export const activityPages = ["chat", "leads", "lead", "clients", "settings", "activity"] as const;
export type ActivityPage = typeof activityPages[number];

type LoginRow = {
  id: string;
  userId: string;
  name: string;
  role: string;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
  lastPage: string | null;
};

type PageRow = {
  id: string;
  sessionId: string;
  userId: string;
  pageKey: ActivityPage;
  startedAt: string;
  lastSeenAt: string;
  endedAt: string | null;
};

type DailyActivity = {
  sessionId: string;
  day: string;
  userId: string;
  userName: string;
  startedAt: string;
  endedAt: string;
  seconds: number;
  active: boolean;
};

const activityTimeZone = "America/Manaus";
const dayMilliseconds = 24 * 60 * 60 * 1_000;

function localDayKey(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: activityTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function localDayStart(day: string): Date {
  const parsed = new Date(`${day}T00:00:00-04:00`);
  if (Number.isNaN(parsed.getTime())) throw new HttpError("Período de atividade inválido.", 422);
  return parsed;
}

function shiftLocalDay(day: string, amount: number): string {
  return localDayKey(new Date(localDayStart(day).getTime() + amount * dayMilliseconds));
}

function dateParam(value: string | null, fallbackDay: string): Date {
  const day = value?.slice(0, 10) || fallbackDay;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new HttpError("Período de atividade inválido.", 422);
  return localDayStart(day);
}

function overlapSeconds(startedAt: string, endedAt: string, from: number, to: number): number {
  const start = Math.max(new Date(startedAt).getTime(), from);
  const end = Math.min(new Date(endedAt).getTime(), to);
  return end > start ? Math.round((end - start) / 1_000) : 0;
}

function pageLabel(page: ActivityPage): string {
  return page === "chat" ? "Chat" : page === "leads" ? "Leads" : page === "lead" ? "Ficha do lead" : page === "clients" ? "Clientes" : page === "settings" ? "Configurações" : "Atividade";
}

function dailyActivity(sessions: Array<{ id: string; userId: string; userName: string; startedAt: string; endedAt: string | null; lastSeenAt: string }>, from: number, to: number, onlineSince: number): DailyActivity[] {
  const rows: DailyActivity[] = [];
  for (const session of sessions) {
    let start = Math.max(new Date(session.startedAt).getTime(), from);
    const end = Math.min(new Date(session.endedAt ?? session.lastSeenAt).getTime(), to);
    while (start < end) {
      const day = localDayKey(new Date(start));
      const nextDay = Math.min(localDayStart(shiftLocalDay(day, 1)).getTime(), end);
      rows.push({
        sessionId: session.id,
        day,
        userId: session.userId,
        userName: session.userName,
        startedAt: new Date(start).toISOString(),
        endedAt: new Date(nextDay).toISOString(),
        seconds: Math.round((nextDay - start) / 1_000),
        active: !session.endedAt && nextDay === end && new Date(session.lastSeenAt).getTime() >= onlineSince,
      });
      start = nextDay;
    }
  }
  return rows.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
}

export async function listActivity(env: AppEnv, url: URL): Promise<Response> {
  const now = new Date();
  const defaultToDay = localDayKey(now);
  const defaultFromDay = shiftLocalDay(defaultToDay, -29);
  const fromDate = dateParam(url.searchParams.get("from"), defaultFromDay);
  const toDay = (url.searchParams.get("to") || defaultToDay).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDay)) throw new HttpError("Período de atividade inválido.", 422);
  const toDate = new Date(localDayStart(shiftLocalDay(toDay, 1)).getTime());
  if (toDate <= fromDate) throw new HttpError("A data final deve ser posterior à inicial.", 422);
  const from = fromDate.getTime();
  const to = toDate.getTime();
  const fromIso = fromDate.toISOString();
  const toIso = toDate.toISOString();

  const [logins, pages] = await Promise.all([
    env.DB.prepare(`SELECT s.id, s.user_id AS userId, u.name, u.role, s.started_at AS startedAt,
      s.last_seen_at AS lastSeenAt, s.ended_at AS endedAt, s.last_page AS lastPage
      FROM user_login_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.started_at < ?1 AND COALESCE(s.ended_at, s.last_seen_at) > ?2
      ORDER BY s.started_at DESC LIMIT 500`).bind(toIso, fromIso).all<LoginRow>(),
    env.DB.prepare(`SELECT id, session_id AS sessionId, user_id AS userId, page_key AS pageKey,
      started_at AS startedAt, last_seen_at AS lastSeenAt, ended_at AS endedAt
      FROM user_page_visits
      WHERE started_at < ?1 AND COALESCE(ended_at, last_seen_at) > ?2
      ORDER BY started_at DESC LIMIT 5_000`).bind(toIso, fromIso).all<PageRow>(),
  ]);

  const pageBySession = new Map<string, PageRow[]>();
  for (const page of pages.results) {
    const list = pageBySession.get(page.sessionId) ?? [];
    list.push(page);
    pageBySession.set(page.sessionId, list);
  }
  const onlineSince = Date.now() - 6 * 60 * 1_000;
  const sessions = logins.results.map((session) => {
    const end = session.endedAt ?? session.lastSeenAt;
    const sessionPages = (pageBySession.get(session.id) ?? []).map((page) => ({
      page: page.pageKey,
      label: pageLabel(page.pageKey),
      startedAt: page.startedAt,
      endedAt: page.endedAt,
      seconds: overlapSeconds(page.startedAt, page.endedAt ?? page.lastSeenAt, from, to),
      active: !page.endedAt && new Date(page.lastSeenAt).getTime() >= onlineSince,
    }));
    return {
      id: session.id,
      userId: session.userId,
      userName: session.name,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      lastSeenAt: session.lastSeenAt,
      lastPage: session.lastPage,
      durationSeconds: overlapSeconds(session.startedAt, end, from, to),
      active: !session.endedAt && new Date(session.lastSeenAt).getTime() >= onlineSince,
      pages: sessionPages,
    };
  });
  const daily = dailyActivity(sessions, from, to, Date.now() - 6 * 60 * 1_000);
  const dailyTotals = new Map<string, number>();
  for (const row of daily) dailyTotals.set(row.userId, (dailyTotals.get(row.userId) ?? 0) + row.seconds);

  const users = new Map<string, {
    id: string;
    name: string;
    role: string;
    loginCount: number;
    totalSeconds: number;
    firstLoginAt: string | null;
    lastLoginAt: string | null;
    online: boolean;
    lastSeenAt: string | null;
    pageSeconds: Record<ActivityPage, number>;
  }>();
  for (const session of sessions) {
    const current = users.get(session.userId) ?? {
      id: session.userId, name: session.userName, role: logins.results.find((row) => row.userId === session.userId)?.role ?? "attendant",
      loginCount: 0, totalSeconds: 0, firstLoginAt: null, lastLoginAt: null, online: false, lastSeenAt: null,
      pageSeconds: { chat: 0, leads: 0, lead: 0, clients: 0, settings: 0, activity: 0 },
    };
    current.loginCount += 1;
    if (!current.firstLoginAt || session.startedAt < current.firstLoginAt) current.firstLoginAt = session.startedAt;
    if (!current.lastLoginAt || session.startedAt > current.lastLoginAt) current.lastLoginAt = session.startedAt;
    current.online = current.online || session.active;
    if (!current.lastSeenAt || session.lastSeenAt > current.lastSeenAt) current.lastSeenAt = session.lastSeenAt;
    for (const page of session.pages) current.pageSeconds[page.page as ActivityPage] += page.seconds;
    users.set(session.userId, current);
  }
  for (const user of users.values()) user.totalSeconds = dailyTotals.get(user.id) ?? 0;

  return json({
    from: fromIso,
    to: toIso,
    pages: activityPages.map((page) => ({ page, label: pageLabel(page) })),
    users: [...users.values()].sort((left, right) => left.name.localeCompare(right.name, "pt-BR")),
    sessions,
    daily,
  });
}
