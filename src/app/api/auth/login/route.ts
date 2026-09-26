import { NextResponse } from "next/server";
import { authenticate, createAuthSession } from "@/lib/store";
import { COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/login  { username, password }
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const user = await authenticate(String(body.username || ""), String(body.password || ""));
  if (!user) {
    return NextResponse.json({ error: "아이디 또는 비밀번호가 올바르지 않습니다" }, { status: 401 });
  }
  const token = await createAuthSession(user.id);
  const res = NextResponse.json({ ok: true, username: user.username, role: user.role });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
}
