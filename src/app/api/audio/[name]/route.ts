import { readFile } from "fs/promises";
import path from "path";
import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";

export const runtime = "nodejs";

// Generated audio (tutor replies, user recordings) lives in data/audio and is
// served through this route: public/ only serves files present at build time,
// so runtime-created mp3s would 404 there. Also keeps recordings behind auth.
// Range requests are honored (206) — iOS Safari media playback depends on it.

const AUDIO_DIR = path.join(process.cwd(), "data", "audio");

function contentTypeFor(name: string): string | null {
  return name.endsWith(".mp3") ? "audio/mpeg"
    : name.endsWith(".webm") ? "audio/webm"
    : name.endsWith(".m4a") || name.endsWith(".mp4") ? "audio/mp4"
    : name.endsWith(".wav") ? "audio/wav"
    : name.endsWith(".ogg") ? "audio/ogg"
    : null;
}

export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const { name } = await params;
  // Path traversal guard: allow bare file names only.
  if (!/^[A-Za-z0-9._-]+$/.test(name)) {
    return NextResponse.json({ error: "bad name" }, { status: 400 });
  }
  const type = contentTypeFor(name);
  if (!type) return NextResponse.json({ error: "unsupported" }, { status: 400 });

  let buf: Buffer;
  try {
    buf = await readFile(path.join(AUDIO_DIR, name));
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const total = buf.length;
  const range = req.headers.get("range");
  const base: Record<string, string> = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  };

  const m = range?.match(/bytes=(\d*)-(\d*)/);
  if (m) {
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    if (Number.isNaN(start) || start >= total || end < start) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${total}` },
      });
    }
    return new NextResponse(new Uint8Array(buf.subarray(start, end + 1)), {
      status: 206,
      headers: {
        ...base,
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }

  return new NextResponse(new Uint8Array(buf), {
    headers: { ...base, "Content-Length": String(total) },
  });
}
