import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import {
  createAuthSession,
  createDemoUser,
  isDemoUser,
  pruneDemoUsers,
  type UserRow,
} from "./store";

// Guest demo sessions for portfolio visitors. Limits keep paid Gemini / xAI
// calls from running unbounded. Counters live in data/demo-usage.json, not
// in the main user database, and every demo visitor gets a throwaway account
// so they cannot see the owner's history or settings.

export const DEMO_SESSION_TURNS = 10;
export const DEMO_SESSION_MINUTES = 5;
export const DEMO_IP_SESSIONS_PER_DAY = 2;
export const DEMO_IP_TURNS_PER_DAY = 20;
export const DEMO_IP_LIVE_PER_DAY = 1;
export const DEMO_GLOBAL_SESSIONS_PER_DAY = 40;
export const DEMO_GLOBAL_TURNS_PER_DAY = 300;
export const DEMO_GLOBAL_LIVE_PER_DAY = 15;

const SESSION_MS = DEMO_SESSION_MINUTES * 60 * 1000;
const USAGE_FILE = path.join(process.cwd(), "data", "demo-usage.json");

const MSG = {
  sessionTurns: `데모는 한 세션에 ${DEMO_SESSION_TURNS}번까지 대화할 수 있어요. 가입하면 제한 없이 연습할 수 있습니다.`,
  sessionTime: `데모 체험 시간(${DEMO_SESSION_MINUTES}분)이 끝났어요. 가입하면 계속 연습할 수 있습니다.`,
  ip: "이 네트워크에서는 오늘 데모 횟수를 모두 사용했어요. 내일 다시 체험하거나, 계정을 만들어 이용해 주세요.",
  global: "오늘 데모 체험 인원이 가득 찼어요. 내일 다시 시도해 주세요.",
  liveIp: "이 네트워크에서는 오늘 실시간 대화 데모를 이미 사용했어요. 일반 대화 연습은 남은 횟수만큼 할 수 있고, 내일 다시 실시간 대화를 체험할 수 있습니다.",
  liveGlobal: "오늘 실시간 대화 데모 인원이 가득 찼어요. 일반 대화 연습은 남은 횟수만큼 할 수 있습니다.",
  feature: "데모에서는 대화 연습만 체험할 수 있어요. 가입하면 일기·팟캐스트·힌트도 사용할 수 있습니다.",
} as const;

export type DemoStatus = {
  turns_used: number;
  turns_left: number;
  turns_limit: number;
  seconds_left: number;
  minutes_limit: number;
  live_used: boolean;
};

type IpBucket = { sessions: number; turns: number; live: number };
type DemoSession = {
  user_id: string;
  ip: string;
  started_at: string;
  turns: number;
  live: boolean;
};

type Usage = {
  date: string;
  global_sessions: number;
  global_turns: number;
  global_live: number;
  by_ip: Record<string, IpBucket>;
  sessions: Record<string, DemoSession>; // keyed by user_id
};

function seoulDate(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function emptyUsage(date: string): Usage {
  return {
    date,
    global_sessions: 0,
    global_turns: 0,
    global_live: 0,
    by_ip: {},
    sessions: {},
  };
}

function ipBucket(u: Usage, ip: string): IpBucket {
  if (!u.by_ip[ip]) u.by_ip[ip] = { sessions: 0, turns: 0, live: 0 };
  return u.by_ip[ip];
}

let lock: Promise<void> = Promise.resolve();

async function withUsage<T>(fn: (u: Usage) => Promise<T> | T): Promise<T> {
  let release!: () => void;
  const prev = lock;
  lock = new Promise<void>((r) => {
    release = r;
  });
  await prev;
  try {
    const today = seoulDate();
    let u: Usage;
    try {
      u = JSON.parse(await readFile(USAGE_FILE, "utf8")) as Usage;
      if (u.date !== today) u = emptyUsage(today);
      u.by_ip = u.by_ip ?? {};
      u.sessions = u.sessions ?? {};
    } catch {
      u = emptyUsage(today);
    }
    const result = await fn(u);
    await mkdir(path.dirname(USAGE_FILE), { recursive: true });
    await writeFile(USAGE_FILE, JSON.stringify(u, null, 2));
    return result;
  } finally {
    release();
  }
}

export function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

function statusFrom(sess: DemoSession | undefined): DemoStatus {
  const turnsUsed = sess?.turns ?? 0;
  const started = sess ? new Date(sess.started_at).getTime() : Date.now();
  const secondsLeft = sess
    ? Math.max(0, Math.ceil((SESSION_MS - (Date.now() - started)) / 1000))
    : DEMO_SESSION_MINUTES * 60;
  return {
    turns_used: turnsUsed,
    turns_left: Math.max(0, DEMO_SESSION_TURNS - turnsUsed),
    turns_limit: DEMO_SESSION_TURNS,
    seconds_left: secondsLeft,
    minutes_limit: DEMO_SESSION_MINUTES,
    live_used: Boolean(sess?.live),
  };
}

function sessionBlock(sess: DemoSession): string | null {
  const st = statusFrom(sess);
  if (st.seconds_left <= 0) return MSG.sessionTime;
  if (st.turns_left <= 0) return MSG.sessionTurns;
  return null;
}

export async function getDemoStatus(user: UserRow): Promise<DemoStatus | null> {
  if (!isDemoUser(user)) return null;
  return withUsage((u) => statusFrom(u.sessions[user.id]));
}

export type StartDemoResult =
  | { ok: true; user: UserRow; token: string; demo: DemoStatus }
  | { ok: false; error: string; status: number };

export async function startDemoSession(ip: string): Promise<StartDemoResult> {
  await pruneDemoUsers().catch(() => 0);
  return withUsage(async (u) => {
    if (u.global_sessions >= DEMO_GLOBAL_SESSIONS_PER_DAY) {
      return { ok: false as const, error: MSG.global, status: 429 };
    }
    const bucket = ipBucket(u, ip);
    if (bucket.sessions >= DEMO_IP_SESSIONS_PER_DAY || bucket.turns >= DEMO_IP_TURNS_PER_DAY) {
      return { ok: false as const, error: MSG.ip, status: 429 };
    }
    const user = await createDemoUser();
    const token = await createAuthSession(user.id);
    u.sessions[user.id] = {
      user_id: user.id,
      ip,
      started_at: new Date().toISOString(),
      turns: 0,
      live: false,
    };
    u.global_sessions += 1;
    bucket.sessions += 1;
    return { ok: true as const, user, token, demo: statusFrom(u.sessions[user.id]) };
  });
}

export type QuotaResult =
  | { ok: true; demo: DemoStatus }
  | { ok: false; error: string; status: number };

export async function assertDemoQuota(
  user: UserRow,
  ip: string,
  kind: "check" | "turn" | "live",
): Promise<QuotaResult> {
  if (!isDemoUser(user)) {
    return {
      ok: true,
      demo: {
        turns_used: 0,
        turns_left: DEMO_SESSION_TURNS,
        turns_limit: DEMO_SESSION_TURNS,
        seconds_left: DEMO_SESSION_MINUTES * 60,
        minutes_limit: DEMO_SESSION_MINUTES,
        live_used: false,
      },
    };
  }
  return withUsage((u) => {
    const sess = u.sessions[user.id];
    if (!sess) {
      // Cookie survived a usage-file reset (new Seoul day). Treat as expired.
      return { ok: false as const, error: MSG.sessionTime, status: 429 };
    }
    const blocked = sessionBlock(sess);
    if (blocked) {
      return { ok: false as const, error: blocked, status: 429 };
    }
    if (kind === "turn") {
      // Re-check: a turn that would exceed the cap must be rejected first.
      if (sess.turns >= DEMO_SESSION_TURNS) {
        return { ok: false as const, error: MSG.sessionTurns, status: 429 };
      }
      const bucket = ipBucket(u, sess.ip || ip);
      if (u.global_turns >= DEMO_GLOBAL_TURNS_PER_DAY) {
        return { ok: false as const, error: MSG.global, status: 429 };
      }
      if (bucket.turns >= DEMO_IP_TURNS_PER_DAY) {
        return { ok: false as const, error: MSG.ip, status: 429 };
      }
      sess.turns += 1;
      u.global_turns += 1;
      bucket.turns += 1;
    }
    if (kind === "live") {
      if (sess.live) {
        // Allow reconnect within the same session window.
        const blockedLive = sessionBlock(sess);
        if (blockedLive) return { ok: false as const, error: blockedLive, status: 429 };
      } else {
        const blockedLive = sessionBlock(sess);
        if (blockedLive) return { ok: false as const, error: blockedLive, status: 429 };
        const bucket = ipBucket(u, sess.ip || ip);
        if (u.global_live >= DEMO_GLOBAL_LIVE_PER_DAY) {
          return { ok: false as const, error: MSG.liveGlobal, status: 429 };
        }
        if (bucket.live >= DEMO_IP_LIVE_PER_DAY) {
          return { ok: false as const, error: MSG.liveIp, status: 429 };
        }
        sess.live = true;
        u.global_live += 1;
        bucket.live += 1;
      }
    }
    return { ok: true as const, demo: statusFrom(sess) };
  });
}

export function demoError(error: string, status = 429) {
  return NextResponse.json({ error }, { status });
}

export function demoFeatureBlocked() {
  return NextResponse.json({ error: MSG.feature }, { status: 403 });
}

export { isDemoUser, MSG as DEMO_MESSAGES };
