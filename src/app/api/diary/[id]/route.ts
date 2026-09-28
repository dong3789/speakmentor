import { NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { deleteDiaryEntry, getDiaryEntry } from "@/lib/store";

export const runtime = "nodejs";

// DELETE /api/diary/[id] -> 일기 + 녹음 파일 삭제
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const row = await getDiaryEntry(id, user.role === "admin" ? undefined : user.id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.audio_path) {
    const file = path.join(process.cwd(), "data", "audio", row.audio_path.replace("/api/audio/", ""));
    await unlink(file).catch(() => {});
  }
  await deleteDiaryEntry(id);
  return NextResponse.json({ ok: true });
}
