import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { handleTurn } from "@/lib/pipeline";
import { assertDemoQuota, clientIp, demoError, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  if (isDemoUser(user)) {
    const quota = await assertDemoQuota(user, clientIp(req), "turn");
    if (!quota.ok) return demoError(quota.error, quota.status);
  }
  const form = await req.formData();
  if (!form.get("audio") && !form.get("transcript")) {
    return NextResponse.json({ error: "audio or transcript required" }, { status: 400 });
  }
  try {
    const result = await handleTurn(form, user.id);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "turn failed" },
      { status: 500 },
    );
  }
}
