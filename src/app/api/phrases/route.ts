import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { listPhrases, markPhrase } from "@/lib/store";

export const runtime = "nodejs";

// GET -> the signed-in learner's phrase bank (newest first)
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  try {
    const phrases = await listPhrases(user.id);
    return NextResponse.json({ phrases });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}

// POST { id, correct } -> record a review result (SM-2 + XP)
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  try {
    await markPhrase(String(body.id), Boolean(body.correct), user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "mark failed" },
      { status: 500 },
    );
  }
}
