import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { getSession } from "@/lib/store";

export const runtime = "nodejs";

// GET -> one session with its turns + errors (replay page).
// Owners see their own session; admins can view anyone's.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const { id } = await params;
  try {
    const result = await getSession(id, user.role === "admin" ? undefined : user.id);
    if (!result) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "load failed" },
      { status: 500 },
    );
  }
}
