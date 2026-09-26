import { randomUUID, randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "fs/promises";
import path from "path";

// Persistence abstraction.
// - Multi-user (2026-09-23): rows carry user_id. Auth (users + session tokens)
//   lives here too; no external auth service.
// - If Supabase env vars are set, rows go to Postgres (supabase/schema.sql).
// - Otherwise everything lands in data/db.json.
// - Legacy rows without user_id are claimed by the seeded admin at load time.

export type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  role: "admin" | "user";
  created_at: string;
};

export type AuthSessionRow = { token: string; user_id: string; created_at: string };

export type SessionRow = {
  id: string;
  user_id?: string;
  topic: string;
  level: string;
  created_at: string;
  ended_at: string | null;
  turn_count: number;
};

export type TurnRow = {
  id: string;
  session_id: string;
  user_id?: string;
  audio_path: string | null;
  transcript: string;
  transcript_cleaned: string | null;
  corrected: string | null;
  reply_en: string | null;
  reply_audio_path: string | null;
  coach_note_ko: string | null;
  target_phrase: string | null;
  jev_score: number | null;
  jev_grammar: number | null;
  jev_vocab: number | null;
  next_difficulty: string | null;
  next_angle: string | null;
  next_focus: string | null;
  created_at: string;
  errors?: { span: string; type: string; fix: string }[];
};

export type PhraseRow = {
  id: string;
  user_id?: string;
  phrase: string;
  ko_note: string | null;
  source_turn_id: string | null;
  first_seen: string;
  last_used: string | null;
  times_seen: number;
  times_correct: number;
  ease: number;
  interval_days: number;
  due_at: string;
};

export type ActivityRow = { id: string; user_id?: string; type: "review_correct" | "review_again" | "turn" | "session_bonus"; xp: number; created_at: string };

export type MetaRow = {
  xp: number;
  streak_days: number;
  last_study_date: string | null;
  seeds: number; // 🌻 idle currency: accrues over time + practice rewards
  seeds_updated_at: string | null;
};

type DB = {
  users: UserRow[];
  auth_sessions: AuthSessionRow[];
  invite_codes: InviteCodeRow[];
  sessions: SessionRow[];
  turns: TurnRow[];
  errors: any[];
  phrases: PhraseRow[];
  activity: ActivityRow[];
  meta_by_user: Record<string, MetaRow>;
};

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
let cache: DB | null = null;

const DEFAULT_META: MetaRow = { xp: 0, streak_days: 0, last_study_date: null, seeds: 0, seeds_updated_at: null };

export function hashPassword(password: string, salt?: string): { hash: string; salt: string } {
  const s = salt ?? randomBytes(16).toString("hex");
  const hash = scryptSync(password, s, 64).toString("hex");
  return { hash, salt: s };
}

export function verifyPassword(password: string, user: UserRow): boolean {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(user.password_hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

async function load(): Promise<DB> {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await readFile(DB_FILE, "utf8")) as Partial<DB>;
    parsed.users = parsed.users ?? [];
    parsed.auth_sessions = parsed.auth_sessions ?? [];
    parsed.invite_codes = parsed.invite_codes ?? [];
    parsed.phrases = parsed.phrases ?? [];
    parsed.activity = parsed.activity ?? [];
    parsed.sessions = parsed.sessions ?? [];
    parsed.turns = parsed.turns ?? [];
    parsed.errors = parsed.errors ?? [];

    // Seed the first (admin) account once, then claim legacy userless rows.
    if (parsed.users.length === 0) {
      const password = process.env.ADMIN_PASSWORD || "speak-mentor-2026";
      const { hash, salt } = hashPassword(password);
      parsed.users.push({
        id: randomUUID(),
        username: (process.env.ADMIN_USERNAME || "yoon").toLowerCase(),
        password_hash: hash,
        salt,
        role: "admin",
        created_at: new Date().toISOString(),
      });
    }
    const admin = parsed.users.find((u) => u.role === "admin") ?? parsed.users[0];

    for (const s of parsed.sessions) if (!s.user_id) s.user_id = admin.id;
    const sessionUser = new Map(parsed.sessions.map((s) => [s.id, s.user_id as string]));
    for (const t of parsed.turns) if (!t.user_id) t.user_id = sessionUser.get(t.session_id) ?? admin.id;
    for (const p of parsed.phrases) if (!p.user_id) p.user_id = admin.id;
    for (const a of parsed.activity) if (!a.user_id) a.user_id = admin.id;

    if (!parsed.meta_by_user) {
      // Legacy single-user gamification meta (pre-accounts) migrates to the admin.
      const legacy = (parsed as any).meta as MetaRow | undefined;
      parsed.meta_by_user = { [admin.id]: legacy ?? DEFAULT_META };
    }
    for (const u of parsed.users) {
      const m = parsed.meta_by_user[u.id] ?? { ...DEFAULT_META };
      if (typeof m.seeds !== "number") m.seeds = 100; // welcome gift
      if (typeof m.seeds_updated_at !== "string") m.seeds_updated_at = new Date().toISOString();
      parsed.meta_by_user[u.id] = m;
    }

    // Backfill SM-2 fields for rows written before spaced repetition existed.
    for (const p of parsed.phrases) {
      if (typeof p.ease !== "number") p.ease = 2.5;
      if (typeof p.interval_days !== "number") p.interval_days = 0;
      if (typeof p.due_at !== "string") p.due_at = new Date().toISOString();
    }
    cache = parsed as DB;
  } catch {
    cache = {
      users: [], auth_sessions: [], invite_codes: [], sessions: [], turns: [], errors: [],
      phrases: [], activity: [], meta_by_user: {},
    };
  }
  return cache;
}

async function save(): Promise<void> {
  if (!cache) return;
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DB_FILE, JSON.stringify(cache, null, 2));
}

function useSupabase() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// ---- auth ----

export async function createUser(username: string, password: string, role: "admin" | "user" = "user"): Promise<UserRow | null> {
  const db = await load();
  const uname = username.toLowerCase();
  if (db.users.some((u) => u.username === uname)) return null;
  const { hash, salt } = hashPassword(password);
  const user: UserRow = { id: randomUUID(), username: uname, password_hash: hash, salt, role, created_at: new Date().toISOString() };
  db.users.push(user);
  db.meta_by_user[user.id] = { ...DEFAULT_META, seeds: 100 }; // welcome gift

  await save();
  return user;
}

export async function authenticate(username: string, password: string): Promise<UserRow | null> {
  const db = await load();
  const user = db.users.find((u) => u.username === username.toLowerCase());
  if (!user || !verifyPassword(password, user)) return null;
  return user;
}

export async function getUserById(id: string): Promise<UserRow | null> {
  const db = await load();
  return db.users.find((u) => u.id === id) ?? null;
}

export async function listUsers(): Promise<UserRow[]> {
  const db = await load();
  return [...db.users].sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<boolean> {
  const db = await load();
  const user = db.users.find((u) => u.id === userId);
  if (!user) return false;
  const { hash, salt } = hashPassword(newPassword);
  user.password_hash = hash;
  user.salt = salt;
  await save();
  return true;
}

export async function createAuthSession(userId: string): Promise<string> {
  const db = await load();
  const token = randomBytes(32).toString("hex");
  db.auth_sessions.push({ token, user_id: userId, created_at: new Date().toISOString() });
  if (db.auth_sessions.length > 500) db.auth_sessions = db.auth_sessions.slice(-300);
  await save();
  return token;
}

export async function getUserByToken(token: string): Promise<UserRow | null> {
  const db = await load();
  const session = db.auth_sessions.find((s) => s.token === token);
  if (!session) return null;
  return db.users.find((u) => u.id === session.user_id) ?? null;
}

export async function deleteAuthSession(token: string): Promise<void> {
  const db = await load();
  db.auth_sessions = db.auth_sessions.filter((s) => s.token !== token);
  await save();
}

// ---- invite codes: multi-use, signup requires one, admin tracks usage ----

export type InviteCodeRow = {
  code: string; // lowercased
  label: string;
  active: boolean;
  uses: number;
  used_by: string[]; // usernames that joined with this code
  created_by: string;
  created_at: string;
};

export async function listInviteCodes(): Promise<InviteCodeRow[]> {
  const db = await load();
  return [...(db.invite_codes ?? [])].sort((a, b) => b.uses - a.uses || a.created_at.localeCompare(b.created_at));
}

// Codes a specific (non-admin) user owns — every signup gets one by default.
export async function listInviteCodesByUser(username: string): Promise<InviteCodeRow[]> {
  const db = await load();
  return (db.invite_codes ?? [])
    .filter((c) => c.created_by === username.toLowerCase())
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function createInviteCode(createdBy: string, code?: string, label?: string): Promise<InviteCodeRow> {
  const db = await load();
  db.invite_codes = db.invite_codes ?? [];
  let final = (code || "").trim().toLowerCase();
  if (!final) {
    final = randomBytes(3).toString("hex") + randomBytes(1).toString("hex"); // 8 hex chars
  }
  final = final.replace(/\s+/g, "");
  if (db.invite_codes.some((c) => c.code === final)) {
    throw new Error("이미 존재하는 코드입니다");
  }
  const row: InviteCodeRow = {
    code: final,
    label: (label || "").trim() || "초대 코드",
    active: true,
    uses: 0,
    used_by: [],
    created_by: createdBy,
    created_at: new Date().toISOString(),
  };
  db.invite_codes.push(row);
  await save();
  return row;
}

export function normalizeInviteCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, "");
}

// Validate without consuming (used at signup start).
export async function inviteCodeIsValid(code: string): Promise<boolean> {
  const db = await load();
  const normalized = normalizeInviteCode(code);
  const row = (db.invite_codes ?? []).find((c) => c.code === normalized);
  return Boolean(row?.active);
}

// Consume one use after a successful signup.
export async function consumeInviteCode(code: string, username: string): Promise<void> {
  const db = await load();
  const normalized = normalizeInviteCode(code);
  const row = (db.invite_codes ?? []).find((c) => c.code === normalized);
  if (row) {
    row.uses += 1;
    row.used_by.push(username);
    await save();
  }
}

export async function setInviteCodeActive(code: string, active: boolean): Promise<boolean> {
  const db = await load();
  const normalized = normalizeInviteCode(code);
  const row = (db.invite_codes ?? []).find((c) => c.code === normalized);
  if (!row) return false;
  row.active = active;
  await save();
  return true;
}

// ---- practice data (per user) ----

export async function createSession(topic: string, level: string, userId: string): Promise<string> {
  if (useSupabase()) {
    const { getSupabase } = await import("./supabase");
    const sb = getSupabase();
    const { data, error } = await sb.from("sessions").insert({ topic, level, user_id: userId }).select("id").single();
    if (error) throw new Error(`supabase insert session: ${error.message}`);
    return data.id as string;
  }
  const db = await load();
  const id = randomUUID();
  db.sessions.push({ id, user_id: userId, topic, level, created_at: new Date().toISOString(), ended_at: null, turn_count: 0 });
  await save();
  return id;
}

export async function finishSession(id: string): Promise<void> {
  const db = await load();
  const s = db.sessions.find((x) => x.id === id);
  if (s) {
    s.ended_at = new Date().toISOString();
    s.turn_count = db.turns.filter((t) => t.session_id === id).length;
    await save();
  }
}

export async function addTurn(sessionId: string, turn: Omit<TurnRow, "id" | "created_at" | "session_id">): Promise<string> {
  const db = await load();
  const session = db.sessions.find((x) => x.id === sessionId);
  const id = randomUUID();
  db.turns.push({ ...turn, session_id: sessionId, user_id: session?.user_id, id, created_at: new Date().toISOString() });
  for (const e of turn.errors ?? []) {
    db.errors.push({ id: randomUUID(), turn_id: id, ...e });
  }
  if (session) session.turn_count = db.turns.filter((t) => t.session_id === sessionId).length;
  await save();
  return id;
}

// The most recent turn of a session — carries the difficulty decision
// from one turn into the next tutor prompt.
export async function getLastTurn(sessionId: string): Promise<TurnRow | null> {
  const db = await load();
  const turns = db.turns
    .filter((t) => t.session_id === sessionId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return turns[0] ?? null;
}

export async function listSessions(userId?: string): Promise<SessionRow[]> {
  if (useSupabase()) {
    const { getSupabase } = await import("./supabase");
    const sb = getSupabase();
    let q = sb.from("sessions").select("*").order("created_at", { ascending: false }).limit(50);
    if (userId) q = q.eq("user_id", userId);
    const { data, error } = await q;
    if (error) throw new Error(`supabase list sessions: ${error.message}`);
    return (data ?? []) as SessionRow[];
  }
  const db = await load();
  return [...db.sessions]
    .filter((s) => !userId || s.user_id === userId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 50);
}

export async function getSession(id: string, userId?: string): Promise<{ session: SessionRow; turns: TurnRow[] } | null> {
  const db = await load();
  const session = db.sessions.find((x) => x.id === id);
  if (!session) return null;
  if (userId && session.user_id !== userId) return null; // owner or admin-only
  const turns = db.turns
    .filter((t) => t.session_id === id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((t) => ({ ...t, errors: db.errors.filter((e) => e.turn_id === t.id) }));
  return { session, turns };
}

export async function getAllTurns(userId?: string, limit = 500): Promise<TurnRow[]> {
  const db = await load();
  return db.turns
    .filter((t) => !userId || t.user_id === userId)
    .slice(-limit)
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((t) => ({ ...t, errors: db.errors.filter((e) => e.turn_id === t.id) }));
}

// ---- phrase bank: sentences extracted from real conversation, drilled in /review ----

export async function addPhrases(
  userId: string,
  items: { phrase: string; ko_note: string; source_turn_id?: string }[],
): Promise<number> {
  const clean = items
    .map((p) => ({ ...p, key: p.phrase.trim().toLowerCase() }))
    .filter((p) => p.key.length > 1);
  if (clean.length === 0) return 0;

  const db = await load();
  const have = new Set(db.phrases.filter((p) => !userId || p.user_id === userId).map((p) => p.phrase.trim().toLowerCase()));
  let added = 0;
  for (const p of clean) {
    if (have.has(p.key)) continue;
    db.phrases.push({
      id: randomUUID(),
      user_id: userId,
      phrase: p.phrase.trim(),
      ko_note: p.ko_note || null,
      source_turn_id: p.source_turn_id ?? null,
      first_seen: new Date().toISOString(),
      last_used: null,
      times_seen: 0,
      times_correct: 0,
      ease: 2.5,
      interval_days: 0,
      due_at: new Date().toISOString(),
    });
    added++;
  }
  await save();
  return added;
}

export async function listPhrases(userId?: string): Promise<PhraseRow[]> {
  const db = await load();
  return [...db.phrases]
    .filter((p) => !userId || p.user_id === userId)
    .sort((a, b) => b.first_seen.localeCompare(a.first_seen));
}

// SM-2 (SuperMemo-2) spaced repetition, two-button simplification:
//   "외웠어요" = quality 5, "다시 볼게요" = quality 1.
function sm2Next(p: { ease: number; interval_days: number }, correct: boolean) {
  let { ease, interval_days } = p;
  if (correct) {
    if (interval_days === 0) interval_days = 1;
    else if (interval_days === 1) interval_days = 6;
    else interval_days = Math.round(interval_days * ease);
  } else {
    interval_days = 0;
    ease = Math.max(1.3, ease - 0.2);
  }
  return { ease, interval_days };
}

export async function markPhrase(id: string, correct: boolean, userId?: string): Promise<void> {
  await recordActivity(correct ? "review_correct" : "review_again", userId);
  const now = new Date();
  const db = await load();
  const p = db.phrases.find((x) => x.id === id);
  if (p) {
    p.times_seen += 1;
    if (correct) p.times_correct += 1;
    p.last_used = now.toISOString();
    const next = sm2Next(p, correct);
    p.ease = next.ease;
    p.interval_days = next.interval_days;
    p.due_at = new Date(now.getTime() + next.interval_days * 24 * 3600 * 1000).toISOString();
    await save();
  }
}

// ---- gamification: XP / level / streak / daily goal (per user) ----

export const XP = { review_correct: 10, review_again: 2, turn: 5, session_bonus: 20 } as const;

// ---- 🌻 seeds: idle currency ----
// Accrues in real time (even while the app is closed) up to a bank cap, so
// checking in regularly matters. Practice also earns seeds. Seeds are spent
// on learning hints (Korean keywords, extra examples).
export const SEED_RATE_MS = 2 * 60 * 1000; // 1 seed per 2 minutes
export const SEED_CAP = 240; // bank fills in ~8 hours
export const SEED_GRANT: Record<string, number> = {
  review_correct: 3, review_again: 1, turn: 5, session_bonus: 10,
};

// Parrot growth stages — the mascot evolves as the learner levels up.
const PARROT_STAGES = [
  { minLevel: 1, emoji: "🐣", name: "아기 앵무" },
  { minLevel: 3, emoji: "🐤", name: "귀여운 앵무" },
  { minLevel: 5, emoji: "🦜", name: "멋쟁이 앵무새" },
  { minLevel: 7, emoji: "🦜", name: "수다쟁이 앵무새" },
  { minLevel: 9, emoji: "🌟", name: "전설의 앵무새" },
];
export function parrotStage(level: number) {
  const idx = PARROT_STAGES.reduce((acc, st, i) => (level >= st.minLevel ? i : acc), 0);
  const stage = PARROT_STAGES[idx];
  const next = PARROT_STAGES[idx + 1] ?? null;
  return {
    emoji: stage.emoji,
    name: stage.name,
    next: next ? { minLevel: next.minLevel, emoji: next.emoji, name: next.name } : null,
  };
}

function accrueSeeds(meta: MetaRow, now = Date.now()): void {
  const last = meta.seeds_updated_at ? Date.parse(meta.seeds_updated_at) : now;
  const elapsed = Math.max(0, now - (Number.isFinite(last) ? last : now));
  const room = Math.max(0, SEED_CAP - meta.seeds);
  const gained = Math.min(Math.floor(elapsed / SEED_RATE_MS), room);
  meta.seeds = Math.min(SEED_CAP, meta.seeds + gained);
  meta.seeds_updated_at = new Date(now).toISOString();
}

// KST calendar date for "today"/"yesterday" comparisons.
function kstDate(offsetDays = 0): string {
  return new Date(Date.now() + offsetDays * 24 * 3600 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Seoul" });
}

export function levelFromXp(xp: number): { level: number; into: number; span: number } {
  let level = 1;
  while (50 * level * (level + 1) <= xp) level++;
  const start = 50 * (level - 1) * level;
  const next = 50 * level * (level + 1);
  return { level, into: xp - start, span: next - start };
}

const LEVEL_TITLES = ["새싹", "말문 트기", "따라잡기", "일상 대화", "자신 만점", "유창함 향해", "영어 마스터"];

export async function recordActivity(type: keyof typeof XP, userId?: string): Promise<number> {
  const db = await load();
  const uid = userId ?? "legacy";
  const xp = XP[type];
  db.activity.push({ id: randomUUID(), user_id: uid, type, xp, created_at: new Date().toISOString() });
  if (db.activity.length > 5000) db.activity = db.activity.slice(-4000);

  const meta = db.meta_by_user[uid] ?? { ...DEFAULT_META };
  meta.xp += xp;
  const today = kstDate();
  if (meta.last_study_date !== today) {
    meta.streak_days = meta.last_study_date === kstDate(-1) ? meta.streak_days + 1 : 1;
    meta.last_study_date = today;
  }
  meta.seeds = (meta.seeds ?? 0) + (SEED_GRANT[type] ?? 0); // practice earns seeds too
  db.meta_by_user[uid] = meta;
  await save();
  return xp;
}

export async function getGamification(userId?: string) {
  const db = await load();
  const uid = userId ?? "legacy";
  const meta = db.meta_by_user[uid] ?? { ...DEFAULT_META };
  accrueSeeds(meta);
  const { level, into, span } = levelFromXp(meta.xp);
  const today = kstDate();
  const mine = db.activity.filter((a) => (a.user_id ?? "legacy") === uid);
  const todayActivity = mine.filter((a) => a.created_at.slice(0, 10) === today);
  const todayReviews = todayActivity.filter((a) => a.type === "review_correct" || a.type === "review_again").length;
  const todayTurns = todayActivity.filter((a) => a.type === "turn").length;

  const last7: { date: string; reviews: number; turns: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = kstDate(-i);
    const day = mine.filter((a) => a.created_at.slice(0, 10) === date);
    last7.push({
      date,
      reviews: day.filter((a) => a.type === "review_correct" || a.type === "review_again").length,
      turns: day.filter((a) => a.type === "turn").length,
    });
  }

  db.meta_by_user[uid] = meta;
  await save();

  return {
    xp: meta.xp,
    level,
    level_title: LEVEL_TITLES[Math.min(level - 1, LEVEL_TITLES.length - 1)],
    level_into: into,
    level_span: span,
    streak_days: meta.streak_days,
    today_reviews: todayReviews,
    today_turns: todayTurns,
    goal: { reviews_target: 10, turns_target: 8 },
    goal_met: todayReviews >= 10 || todayTurns >= 8,
    seeds: meta.seeds,
    seeds_cap: SEED_CAP,
    parrot: parrotStage(level),
    last7,
  };
}

// Spend seeds (hints etc). Returns false when the balance is too low.
export async function spendSeeds(userId: string, amount: number): Promise<boolean> {
  const db = await load();
  const meta = db.meta_by_user[userId];
  if (!meta) return false;
  accrueSeeds(meta);
  if (meta.seeds < amount) return false;
  meta.seeds -= amount;
  await save();
  return true;
}

// Memory for the tutor: recent error types + learned phrases + the last
// questions it asked (so it varies its questions instead of repeating).
export async function getTutorMemory(userId?: string): Promise<{
  recent_error_types: string[];
  learned_phrases: string[];
  recent_replies: string[];
}> {
  const db = await load();
  const phrases = await listPhrases(userId);
  const turns = await getAllTurns(userId);
  const myTurnIds = new Set(turns.map((t) => t.id));
  const errorTypes = db.errors
    .filter((e) => myTurnIds.has(e.turn_id))
    .slice(-20)
    .map((e) => String(e.type));
  return {
    recent_error_types: errorTypes,
    learned_phrases: phrases.slice(0, 15).map((p) => p.phrase),
    recent_replies: turns.slice(-3).map((t) => t.reply_en).filter((r): r is string => Boolean(r)),
  };
}

// Normalize for reuse matching: lowercase, strip punctuation, collapse spaces.
export function normalizePhrase(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

// Did the user actually say the corrected/target phrase in a LATER turn?
export function computePhraseReuse(turns: TurnRow[]): { assigned: number; reused: number } {
  let assigned = 0;
  let reused = 0;
  for (let i = 0; i < turns.length; i++) {
    const target = turns[i].target_phrase;
    if (!target || normalizePhrase(target).length < 3) continue;
    assigned++;
    const targetNorm = normalizePhrase(target);
    const later = turns.slice(i + 1).map((t) => normalizePhrase(t.transcript || ""));
    if (later.some((t) => t.includes(targetNorm))) reused++;
  }
  return { assigned, reused };
}

// ---- audio retention (privacy: auto-delete user audio after N days) ----

export async function cleanupOldAudio(): Promise<number> {
  const days = Number(process.env.AUDIO_RETENTION_DAYS || 14);
  if (!Number.isFinite(days) || days <= 0) return 0;
  const cutoff = Date.now() - days * 24 * 3600 * 1000;
  const dir = path.join(process.cwd(), "data", "audio");
  let removed = 0;
  try {
    const files = await readdir(dir);
    for (const f of files) {
      if (f.startsWith("opening-")) continue; // cached intro audio: keep
      const full = path.join(dir, f);
      const st = await stat(full).catch(() => null);
      if (st && st.mtimeMs < cutoff) {
        await unlink(full).catch(() => {});
        removed++;
      }
    }
  } catch {
    return 0; // no audio dir yet
  }
  if (removed > 0) {
    const db = await load();
    for (const t of db.turns) {
      for (const key of ["audio_path", "reply_audio_path"] as const) {
        const p = t[key];
        if (p) {
          const rel = p.replace(/^\/api\/audio\//, "");
          const full = path.join(process.cwd(), "data", "audio", rel);
          const exists = await stat(full).then(() => true, () => false);
          if (!exists) t[key] = null;
        }
      }
    }
    await save();
  }
  return removed;
}
