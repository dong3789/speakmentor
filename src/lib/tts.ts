import { randomUUID } from "crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { ttsConfig } from "./ai";

// TTS for the tutor's spoken reply only. Teaching notes never go to audio.
// Files are written to data/audio and served via /api/audio/[name] — public/
// only serves assets present at build time, so runtime files would 404 there.
// Returns a URL, or "" when TTS is unavailable (the client then falls back to
// the browser SpeechSynthesis API).

const AUDIO_DIR = path.join(process.cwd(), "data", "audio");

export async function synthesizeSpeech(text: string): Promise<string> {
  const { apiKey, baseUrl } = ttsConfig();
  const res = await fetch(`${baseUrl}/audio/speech`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.TTS_MODEL || "tts-1",
      voice: process.env.TTS_VOICE || "nova",
      input: text,
    }),
  });
  if (!res.ok) {
    throw new Error(`TTS failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(AUDIO_DIR, { recursive: true });
  const name = `${randomUUID()}.mp3`;
  await writeFile(path.join(AUDIO_DIR, name), buf);
  return `/api/audio/${name}`;
}

export async function saveUserAudio(audio: Blob): Promise<string> {
  await mkdir(AUDIO_DIR, { recursive: true });
  const ext = audio.type.includes("mp4") || audio.type.includes("aac")
    ? ".m4a"
    : audio.type.includes("wav")
      ? ".wav"
      : audio.type.includes("mpeg")
        ? ".mp3"
        : ".webm";
  const name = `user-${randomUUID()}${ext}`;
  await writeFile(path.join(AUDIO_DIR, name), Buffer.from(await audio.arrayBuffer()));
  return `/api/audio/${name}`;
}
