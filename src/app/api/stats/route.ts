import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { computePhraseReuse, getAllTurns, getGamification, listPhrases, listSessions, normalizePhrase } from "@/lib/store";

export const runtime = "nodejs";

// GET -> per-user weekly counts, error types, reuse, gamification, Jev scores.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  try {
    const [turns, sessions, phrases, game] = await Promise.all([
      getAllTurns(user.id),
      listSessions(user.id),
      listPhrases(user.id),
      getGamification(user.id),
    ]);
    const now = Date.now();
    const weekAgo = now - 7 * 24 * 3600 * 1000;

    const recentTurns = turns.filter((t) => new Date(t.created_at).getTime() >= weekAgo);
    const recentSessions = sessions.filter((s) => new Date(s.created_at).getTime() >= weekAgo);

    // Rough speaking-time estimate: one turn ≈ 20 s of speech.
    const minutes = Math.round((recentTurns.length * 20 / 60) * 10) / 10;

    const uniquePhrases = new Set(recentTurns.map((t) => normalizePhrase(t.transcript || "")).filter(Boolean)).size;

    const errorCounts: Record<string, number> = {};
    for (const t of recentTurns) {
      for (const e of t.errors ?? []) {
        errorCounts[e.type] = (errorCounts[e.type] || 0) + 1;
      }
    }
    const topErrors = Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, count }));

    const reuse = computePhraseReuse(turns);
    const duePhrases = phrases.filter((p) => new Date(p.due_at).getTime() <= now).length;
    const learnedPhrases = phrases.filter((p) => p.interval_days >= 1).length;

    const allScored = turns.filter((t) => typeof t.jev_score === "number");
    const weekScored = recentTurns.filter((t) => typeof t.jev_score === "number");
    const avg = (list: typeof allScored) =>
      list.length ? Math.round((list.reduce((s, t) => s + (t.jev_score ?? 0), 0) / list.length) * 10) / 10 : null;

    return NextResponse.json({
      game,
      scores: { avg_week: avg(weekScored), avg_all: avg(allScored), count: allScored.length },
      week: {
        sessions: recentSessions.length,
        turns: recentTurns.length,
        estimated_minutes: minutes,
        unique_phrases: uniquePhrases,
      },
      top_errors: topErrors,
      phrase_reuse: { ...reuse, rate: reuse.assigned ? Math.round((reuse.reused / reuse.assigned) * 100) : 0 },
      review: { total_phrases: phrases.length, due: duePhrases, learned: learnedPhrases },
      all_time: { sessions: sessions.length, turns: turns.length },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "stats failed" },
      { status: 500 },
    );
  }
}
