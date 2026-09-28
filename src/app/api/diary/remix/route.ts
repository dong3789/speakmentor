import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { listDiaryEntries } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/diary/remix -> recent diary recordings for the remix player.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const entries = await listDiaryEntries(user.id);
  const lines = entries
    .filter((e) => e.audio_path)
    .slice(0, 8)
    .map((e) => ({
      transcript: e.text,
      corrected: e.corrected,
      score: null as number | null,
      audio: e.audio_path as string,
    }));
  return NextResponse.json({ lines });
}
