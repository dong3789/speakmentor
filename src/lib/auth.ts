import { getUserByToken, UserRow } from "./store";

export const COOKIE_NAME = "sm_session";

export async function getUserFromRequest(req: Request): Promise<UserRow | null> {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!m) return null;
  return getUserByToken(m[1]);
}

export const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 30, // 30 days
};

// Demo cookies are short-lived so a leftover guest session cannot linger.
export const DEMO_COOKIE_OPTIONS = {
  ...COOKIE_OPTIONS,
  maxAge: 60 * 15, // 15 minutes (practice cap is 5 minutes; leftover time is for the "limit reached" screen)
};

export function unauthorized() {
  return Response.json({ error: "로그인이 필요합니다" }, { status: 401 });
}

export function forbidden() {
  return Response.json({ error: "관리자만 접근할 수 있습니다" }, { status: 403 });
}
