import { NextResponse } from "next/server";
import { forbidden, getUserFromRequest, unauthorized } from "@/lib/auth";
import {
  computePhraseReuse,
  getAllTurns,
  getGamification,
  getUserById,
  listPhrases,
  listSessions,
  resetUserPassword,
} from "@/lib/store";

export const runtime = "nodejs";

// GET /api/admin/users/[id] -> one learner's full picture (admin only).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getUserFromRequest(req);
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return forbidden();
  const { id } = await params;

  const user = await getUserById(id);
  if (!user) return NextResponse.json({ error: "사용자를 찾을 수 없습니다" }, { status: 404 });

  const [turns, sessions, phrases, game] = await Promise.all([
    getAllTurns(id),
    listSessions(id),
    listPhrases(id),
    getGamification(id),
  ]);
  const reuse = computePhraseReuse(turns);
  const errorCounts: Record<string, number> = {};
  for (const t of turns) for (const e of t.errors ?? []) errorCounts[e.type] = (errorCounts[e.type] || 0) + 1;

  return NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role, created_at: user.created_at },
    game,
    sessions: sessions.slice(0, 10),
    recent_turns: turns.slice(-15).reverse().map((t) => ({
      created_at: t.created_at,
      transcript: t.transcript,
      corrected: t.corrected,
      score: t.jev_score,
      coach_note_ko: t.coach_note_ko,
    })),
    stats: {
      turns: turns.length,
      sessions: sessions.length,
      phrases: phrases.length,
      reuse,
      error_counts: errorCounts,
      avg_score: turns.some((t) => typeof t.jev_score === "number")
        ? Math.round((turns.filter((t) => typeof t.jev_score === "number").reduce((s, t) => s + (t.jev_score ?? 0), 0) /
            turns.filter((t) => typeof t.jev_score === "number").length) * 10) / 10
        : null,
    },
  });
}

// POST /api/admin/users/[id]  { password } -> reset that learner's password.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await getUserFromRequest(req);
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return forbidden();
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const password = String(body.password || "");
  if (password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상으로 입력하세요" }, { status: 400 });
  }
  const ok = await resetUserPassword(id, password);
  if (!ok) return NextResponse.json({ error: "사용자를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
