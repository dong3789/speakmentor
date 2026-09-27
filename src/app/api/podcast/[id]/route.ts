import { NextResponse } from "next/server";
import { unlink } from "fs/promises";
import path from "path";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { deletePodcastEpisode, getPodcastEpisode } from "@/lib/store";

export const runtime = "nodejs";

// GET /api/podcast/[id] -> full episode with script lines (en/ko/offset).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const ep = await getPodcastEpisode(id, user.role === "admin" ? undefined : user.id);
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ episode: ep });
}

// DELETE /api/podcast/[id] -> remove episode row + audio file.
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const { id } = await params;
  const ep = await getPodcastEpisode(id, user.role === "admin" ? undefined : user.id);
  if (!ep) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (ep.audio) {
    const file = path.join(process.cwd(), "data", "audio", ep.audio.replace("/api/audio/", ""));
    await unlink(file).catch(() => {});
  }
  await deletePodcastEpisode(id);
  return NextResponse.json({ ok: true });
}
