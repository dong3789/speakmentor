import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { createPodcastEpisode, getPodcastEpisode, listPodcastEpisodes } from "@/lib/store";
import { generateEpisode } from "@/lib/podcast";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/podcast -> the user's episodes (without full script; use /[id])
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const episodes = await listPodcastEpisodes(user.id);
  return NextResponse.json({
    episodes: episodes.map((e) => ({
      id: e.id, title: e.title, topic: e.topic, level: e.level,
      status: e.status, progress: e.progress, duration: e.duration,
      audio: e.audio, created_at: e.created_at,
    })),
  });
}

// POST /api/podcast/generate happens here: create row, kick off background
// generation, return immediately. The client polls GET until status=ready.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const body = await req.json().catch(() => ({}));
  const topic = String(body.topic || "everyday life").slice(0, 60);
  const level = ["A1", "A2", "B1", "B2"].includes(body.level) ? body.level : "A2";
  const minutes = Math.max(2, Math.min(10, Number(body.minutes) || 4));

  const mine = await listPodcastEpisodes(user.id);
  if (mine.some((e) => e.status === "generating")) {
    return NextResponse.json({ error: "이미 생성 중인 에피소드가 있어요" }, { status: 409 });
  }

  const ep = await createPodcastEpisode(user.id, topic, level);
  // background job — the personal server keeps the process alive.
  generateEpisode(ep.id, minutes).catch(() => {});
  return NextResponse.json({ id: ep.id, status: "generating" });
}
