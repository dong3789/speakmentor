import { NextResponse } from "next/server";
import { forbidden, getUserFromRequest, unauthorized } from "@/lib/auth";
import { getAllTurns, getGamification, listPhrases, listSessions, listUsers } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/admin/users -> every account with its learning summary (admin only).
// This is the "one admin watches every account's learning" view.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  if (user.role !== "admin") return forbidden();

  const users = await listUsers();
  const rows = await Promise.all(
    users.map(async (u) => {
      const [turns, sessions, phrases, game] = await Promise.all([
        getAllTurns(u.id),
        listSessions(u.id),
        listPhrases(u.id),
        getGamification(u.id),
      ]);
      const scored = turns.filter((t) => typeof t.jev_score === "number");
      const avgScore = scored.length
        ? Math.round((scored.reduce((s, t) => s + (t.jev_score ?? 0), 0) / scored.length) * 10) / 10
        : null;
      const due = phrases.filter((p) => new Date(p.due_at).getTime() <= Date.now()).length;
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        created_at: u.created_at,
        sessions: sessions.length,
        turns: turns.length,
        avg_score: avgScore,
        phrases: phrases.length,
        due,
        xp: game.xp,
        level: game.level,
        level_title: game.level_title,
        streak_days: game.streak_days,
        last_active: turns.length ? turns[turns.length - 1].created_at : null,
      };
    }),
  );
  return NextResponse.json({ users: rows });
}
