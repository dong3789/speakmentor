import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { synthesizeSpeech } from "@/lib/tts";
import { assertDemoQuota, clientIp, demoError, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";

// POST {text} -> Grok TTS url for a corrected sentence (tap-to-hear on review)
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  if (isDemoUser(user)) {
    const quota = await assertDemoQuota(user, clientIp(req), "check");
    if (!quota.ok) return demoError(quota.error, quota.status);
  }
  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim().slice(0, 400);
  if (!text) return NextResponse.json({ error: "text required" }, { status: 400 });
  try {
    return NextResponse.json({ url: await synthesizeSpeech(text) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "tts failed" }, { status: 502 });
  }
}
