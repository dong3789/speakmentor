import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getAllTurns } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/remix -> recent turns that have the user's own recording,
// in chronological order (oldest first = the story of their practice).
// Used by the rhythm-review remix player on /review.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  try {
    const turns = await getAllTurns(user.id);
    const lines = turns
      .filter((t) => t.audio_path)
      .slice(-8)
      .map((t) => ({
        transcript: t.transcript_cleaned || t.transcript,
        corrected: t.corrected,
        score: t.jev_score,
        audio: t.audio_path as string,
      }));
    return NextResponse.json({ lines });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "remix load failed" },
      { status: 500 },
    );
  }
}
