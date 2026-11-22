import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { liveInstructions, mintRealtimeToken, realtimeKey, REALTIME_MODEL, LIVE_MAX_MINUTES, LIVE_PRICE_PER_MIN } from "@/lib/live";
import { assertDemoQuota, clientIp, DEMO_SESSION_MINUTES, demoError, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";

// POST -> short-lived xAI realtime client secret (the real key stays here).
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  if (!realtimeKey()) return NextResponse.json({ error: "xAI 키가 설정되지 않았어요" }, { status: 500 });
  let maxMinutes = LIVE_MAX_MINUTES;
  let tokenSeconds = 300;
  if (isDemoUser(user)) {
    const quota = await assertDemoQuota(user, clientIp(req), "live");
    if (!quota.ok) return demoError(quota.error, quota.status);
    tokenSeconds = Math.max(0, Math.min(DEMO_SESSION_MINUTES * 60, quota.demo.seconds_left));
    if (tokenSeconds < 15) return demoError(quota.demo.seconds_left <= 0
      ? "데모 체험 시간이 끝났어요. 가입하면 계속 연습할 수 있습니다."
      : "남은 데모 시간이 너무 짧아 실시간 대화를 시작하기 어려워요.", 429);
    maxMinutes = Math.max(1, Math.ceil(tokenSeconds / 60));
  }
  const body = await req.json().catch(() => ({}));
  const level = ["A2", "B1", "B2"].includes(body?.level) ? body.level : "B1";
  try {
    const tok = await mintRealtimeToken(tokenSeconds);
    return NextResponse.json({
      token: tok.value,
      expires_at: tok.expires_at,
      model: REALTIME_MODEL,
      voice: process.env.TTS_VOICE || "iris",
      instructions: liveInstructions(level),
      max_minutes: maxMinutes,
      price_per_min: LIVE_PRICE_PER_MIN,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "token failed" }, { status: 502 });
  }
}
