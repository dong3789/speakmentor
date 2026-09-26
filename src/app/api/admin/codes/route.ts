import { NextResponse } from "next/server";
import { forbidden, getUserFromRequest, unauthorized } from "@/lib/auth";
import { createInviteCode, listInviteCodes, setInviteCodeActive } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/admin/codes -> invite codes sorted by signups (admin only).
export async function GET(req: Request) {
  const admin = await getUserFromRequest(req);
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return forbidden();
  return NextResponse.json({ codes: await listInviteCodes() });
}

// POST /api/admin/codes  { code?, label? } -> create a code (auto-generated if omitted).
export async function POST(req: Request) {
  const admin = await getUserFromRequest(req);
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return forbidden();
  const body = await req.json().catch(() => ({}));
  try {
    const row = await createInviteCode(admin.username, body.code ? String(body.code) : undefined, body.label ? String(body.label) : undefined);
    return NextResponse.json({ code: row });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "생성 실패" }, { status: 400 });
  }
}

// PATCH /api/admin/codes  { code, active } -> enable/disable a code.
export async function PATCH(req: Request) {
  const admin = await getUserFromRequest(req);
  if (!admin) return unauthorized();
  if (admin.role !== "admin") return forbidden();
  const body = await req.json().catch(() => ({}));
  const ok = await setInviteCodeActive(String(body.code || ""), Boolean(body.active));
  if (!ok) return NextResponse.json({ error: "코드를 찾을 수 없습니다" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
