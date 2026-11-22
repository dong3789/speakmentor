import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";
import { getDemoStatus, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";

// GET /api/auth/me -> { username, role, is_demo, demo? } | 401
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  const demo = isDemoUser(user) ? await getDemoStatus(user) : null;
  return NextResponse.json({
    username: user.username,
    role: user.role,
    is_demo: Boolean(demo),
    demo,
  });
}
