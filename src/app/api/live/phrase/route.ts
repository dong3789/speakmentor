import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { addPhrases } from "@/lib/store";

export const runtime = "nodejs";

// POST {phrase, ko_note, source_turn_id?} -> add a corrected sentence to the review deck
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const b = await req.json().catch(() => ({}));
  const phrase = String(b?.phrase || "").trim().slice(0, 300);
  if (!phrase) return NextResponse.json({ error: "phrase required" }, { status: 400 });
  const added = await addPhrases(user.id, [{ phrase, ko_note: String(b?.ko_note || "").slice(0, 200), source_turn_id: b?.source_turn_id || undefined }]);
  return NextResponse.json({ ok: true, added });
}
