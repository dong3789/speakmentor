import { NextResponse } from "next/server";
import { COOKIE_NAME, DEMO_COOKIE_OPTIONS, getUserFromRequest } from "@/lib/auth";
import { clientIp, getDemoStatus, isDemoUser, startDemoSession } from "@/lib/demo";

export const runtime = "nodejs";

// POST /api/auth/demo — start a throwaway guest session (no signup).
export async function POST(req: Request) {
  const existing = await getUserFromRequest(req);
  if (existing && !isDemoUser(existing)) {
    return NextResponse.json({ error: "이미 로그인되어 있습니다" }, { status: 400 });
  }
  if (existing && isDemoUser(existing)) {
    const demo = await getDemoStatus(existing);
    if (demo && demo.seconds_left > 0 && demo.turns_left > 0) {
      return NextResponse.json({
        ok: true,
        username: existing.username,
        role: existing.role,
        is_demo: true,
        demo,
      });
    }
    // Expired demo cookie: fall through and try to open a new session
    // (still subject to per-IP / global caps).
  }

  const result = await startDemoSession(clientIp(req));
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  const res = NextResponse.json({
    ok: true,
    username: result.user.username,
    role: result.user.role,
    is_demo: true,
    demo: result.demo,
  });
  res.cookies.set(COOKIE_NAME, result.token, DEMO_COOKIE_OPTIONS);
  return res;
}
