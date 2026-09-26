import { NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/auth";

export const runtime = "nodejs";

// GET /api/auth/me -> { username, role } | 401
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다" }, { status: 401 });
  return NextResponse.json({ username: user.username, role: user.role });
}
