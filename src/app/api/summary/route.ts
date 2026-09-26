import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getAllTurns, listPhrases, listSessions } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/summary -> the user's most recent finished session, summarized:
// 잘한 문장 (praised) / 고친 문장 (corrected) / 배운 표현 / 내일 쓸 표현.
// The review page shows this so the end-of-session evaluation stays visible.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  try {
    const [sessions, allTurns, phrases] = await Promise.all([
      listSessions(user.id),
      getAllTurns(user.id),
      listPhrases(user.id),
    ]);
    const last = sessions.find((s) => s.ended_at) ?? null;
    if (!last) return NextResponse.json({ summary: null });

    const turns = allTurns.filter((t) => t.session_id === last.id);
    if (turns.length === 0) return NextResponse.json({ summary: null });
    const turnIds = new Set(turns.map((t) => t.id));

    const scored = turns.filter((t) => typeof t.jev_score === "number");
    const avg = scored.length
      ? Math.round((scored.reduce((s, t) => s + (t.jev_score ?? 0), 0) / scored.length) * 10) / 10
      : null;

    const pick = (t: (typeof turns)[number]) => ({
      transcript: t.transcript_cleaned || t.transcript,
      corrected: t.corrected,
      score: t.jev_score,
      coach_note_ko: t.coach_note_ko,
      created_at: t.created_at,
    });
    // 잘한 문장: 점수 3.5 이상 + 교정 없음
    const good = turns
      .filter((t) => (t.jev_score ?? 0) >= 3.5 && (t.errors?.length ?? 0) === 0)
      .sort((a, b) => (b.jev_score ?? 0) - (a.jev_score ?? 0))
      .slice(0, 3)
      .map(pick);
    // 고친 문장: 교정이 붙은 턴
    const fix = turns
      .filter((t) => (t.errors?.length ?? 0) > 0)
      .slice(-3)
      .map(pick);

    const newPhrases = phrases.filter((p) => p.source_turn_id && turnIds.has(p.source_turn_id));
    const tomorrow = [...turns].reverse().find((t) => t.target_phrase)?.target_phrase ?? null;

    return NextResponse.json({
      summary: {
        session: { id: last.id, topic: last.topic, level: last.level, created_at: last.created_at, turn_count: turns.length },
        avg_score: avg,
        good,
        fix,
        new_phrases: newPhrases.map((p) => ({ phrase: p.phrase, ko_note: p.ko_note })).slice(0, 5),
        tomorrow,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "summary failed" },
      { status: 500 },
    );
  }
}
