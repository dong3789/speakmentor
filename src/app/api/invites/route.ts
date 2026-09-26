import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { createInviteCode, listInviteCodesByUser } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/invites -> the signed-in user's own invite codes (with usage).
// New accounts get one code automatically at signup; admins manage all codes
// in /admin.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const codes = await listInviteCodesByUser(user.username);
  return NextResponse.json({ codes });
}

// POST /api/invites -> let a user mint one extra code (cap: 3 per person,
// so invites can branch without being infinite).
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const mine = await listInviteCodesByUser(user.username);
  if (user.role !== "admin" && mine.length >= 3) {
    return NextResponse.json({ error: "초대 코드는 최대 3개까지 만들 수 있어요" }, { status: 403 });
  }
  const row = await createInviteCode(user.username);
  return NextResponse.json({ code: row });
}
