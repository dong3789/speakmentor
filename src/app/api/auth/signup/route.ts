import { NextResponse } from "next/server";
import { authenticate, consumeInviteCode, createAuthSession, createInviteCode, createUser, inviteCodeIsValid } from "@/lib/store";
import { COOKIE_NAME, COOKIE_OPTIONS } from "@/lib/auth";

export const runtime = "nodejs";

// POST /api/auth/signup  { username, password, invite }
// Signup always requires an active invite code (multi-use; usage is tracked
// per code so the admin can see which codes brought people in).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const invite = String(body.invite || "");

  if (!invite) {
    return NextResponse.json({ error: "초대 코드를 입력해 주세요" }, { status: 403 });
  }
  if (!(await inviteCodeIsValid(invite))) {
    return NextResponse.json({ error: "유효하지 않은 초대 코드입니다" }, { status: 403 });
  }
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return NextResponse.json({ error: "아이디는 영문/숫자/_ 3~20자로 입력하세요" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "비밀번호는 6자 이상으로 입력하세요" }, { status: 400 });
  }

  const user = await createUser(username, password);
  if (!user) {
    return NextResponse.json({ error: "이미 존재하는 아이디입니다" }, { status: 409 });
  }
  await consumeInviteCode(invite, user.username);
  // Every new account gets its own invite code so invites can chain.
  await createInviteCode(user.username, undefined, `${user.username}님의 초대 코드`);
  const token = await createAuthSession(user.id);
  const res = NextResponse.json({ ok: true, username: user.username, role: user.role });
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTIONS);
  return res;
}
