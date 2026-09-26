import { NextResponse } from "next/server";
import { deleteAuthSession } from "@/lib/store";
import { COOKIE_NAME } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/logout
export async function POST(req: Request) {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (m) await deleteAuthSession(m[1]);
  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
