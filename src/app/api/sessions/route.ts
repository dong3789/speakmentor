import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { startSession } from "@/lib/pipeline";
import { finishSession, listSessions, recordActivity } from "@/lib/store";
import { assertDemoQuota, clientIp, demoError, isDemoUser } from "@/lib/demo";

export const runtime = "nodejs";

// POST { topic, level }            -> create session, return opening question
// POST { session_id, action:"finish" } -> mark session done
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  try {
    if (body.action === "finish" && body.session_id) {
      await finishSession(String(body.session_id));
      recordActivity("session_bonus", user.id).catch(() => {});
      return NextResponse.json({ ok: true });
    }
    if (isDemoUser(user)) {
      const quota = await assertDemoQuota(user, clientIp(req), "check");
      if (!quota.ok) return demoError(quota.error, quota.status);
    }
    const topic = String(body.topic || "free talk");
    const level = String(body.level || "A2");
    return NextResponse.json(await startSession(topic, level, user.id));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "session failed" },
      { status: 500 },
    );
  }
}

// GET -> recent sessions for the history page
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  try {
    const sessions = await listSessions(user.id);
    return NextResponse.json({ sessions });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "list failed" },
      { status: 500 },
    );
  }
}
