import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, stat, unlink } from "fs/promises";
import path from "path";
import { aiConfig, hasAIKey } from "./ai";
import { synthesizeSpeech } from "./tts";
import { getPodcastEpisode, updatePodcastEpisode } from "./store";

const execFileP = promisify(execFile);
const AUDIO_DIR = path.join(process.cwd(), "data", "audio");
const SILENCE_FILE = path.join(AUDIO_DIR, "podcast-silence-045.mp3");

async function ffprobeDuration(file: string): Promise<number> {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file,
  ]);
  return Number(stdout.trim()) || 0;
}

async function ensureSilence(): Promise<string> {
  try {
    await stat(SILENCE_FILE);
  } catch {
    await execFileP("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "anullsrc=r=24000:cl=mono",
      "-t", "0.45", "-b:a", "128k", SILENCE_FILE,
    ]);
  }
  return SILENCE_FILE;
}

// ---- script generation (Gemini, chunked for long episodes) ----
async function geminiChunk(opts: {
  topic: string; level: string; count: number;
  prevTail: { en: string; ko: string }[];
  first: boolean; last: boolean;
}): Promise<{ title: string; lines: { en: string; ko: string }[] }> {
  const { apiKey, baseUrl } = aiConfig();
  const { topic, level, count, prevTail, first, last } = opts;
  const flow = [
    first ? "Start with a warm greeting." : "Do NOT greet — continue the episode naturally from the previous lines.",
    last ? "End with a soft encouraging closing line." : "Do not close — more content follows after these lines.",
  ].join(" ");
  const prevText = prevTail.length
    ? ` The episode so far ended with: ${prevTail.map((l) => `"${l.en}"`).join(" / ")}`
    : "";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.TUTOR_MODEL || "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            `You write a gentle English LISTENING podcast for a Korean beginner (CEFR ${level}). Topic: ${topic}. ` +
            `Output JSON only: {"title": string, "lines": [{"en": string, "ko": string}]}. ` +
            `Rules: exactly ${count} short spoken sentences (5-12 words each). A friendly narrator talks directly to the listener. ` +
            `Only simple present/past, everyday words, no idioms. Each ko is a natural Korean translation of en. ${flow} ` +
            `Introduce a NEW small sub-theme of the topic in this chunk. JSON only, no markdown.` + prevText,
        },
        { role: "user", content: `${count} lines about: ${topic}. Level: ${level}.` },
      ],
      response_format: { type: "json_object" },
      temperature: 0.8,
      max_tokens: 6000,
      reasoning_effort: process.env.TUTOR_REASONING || "low",
    }),
    signal: AbortSignal.timeout(90000),
  });
  if (!res.ok) throw new Error(`script chunk failed: ${res.status}`);
  const data = await res.json();
  const content = (data?.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(content);
  const lines = (parsed.lines ?? [])
    .filter((l: any) => l && typeof l.en === "string" && typeof l.ko === "string")
    .map((l: any) => ({ en: String(l.en).trim(), ko: String(l.ko).trim() }));
  if (lines.length === 0) throw new Error("empty chunk");
  return { title: String(parsed.title || topic).slice(0, 80), lines };
}

async function generateScript(topic: string, level: string, linesWanted: number, onProgress?: (p: number) => void): Promise<{ title: string; lines: { en: string; ko: string }[] }> {
  const CHUNK = 35;
  const MAX_CHUNKS = 15; // 안전 상한: 모델이 줄을 적게 줘도 목표를 채우도록 이어갈 수 있음
  let all: { en: string; ko: string }[] = [];
  let title = `${topic} — easy listening`;
  for (let c = 0; c < MAX_CHUNKS && all.length < linesWanted; c++) {
    const remaining = linesWanted - all.length;
    const count = Math.min(CHUNK, remaining);
    const chunk = await geminiChunk({
      topic, level, count,
      prevTail: all.slice(-2),
      first: c === 0,
      last: c === MAX_CHUNKS - 1 || all.length + count >= linesWanted,
    });
    if (c === 0) title = chunk.title;
    all = all.concat(chunk.lines);
    console.log(`[podcast] chunk ${c}: +${chunk.lines.length} lines (total ${all.length}/${linesWanted})`);
    onProgress?.(Math.min(1, all.length / linesWanted));
  }
  if (all.length < 5) throw new Error("script too short");
  return { title, lines: all };
}

// ---- background generation: script -> kokoro per line -> ffmpeg concat ----
export async function generateEpisode(episodeId: string, minutes: number): Promise<void> {
  const ep = await getPodcastEpisode(episodeId);
  if (!ep) return;
  const tmpFiles: string[] = [];
  try {
    if (!hasAIKey()) throw new Error("AI 키가 설정되지 않았어요");
    const linesWanted = Math.max(10, Math.min(500, Math.round(minutes * 15))); // 줄당 약 3.3초

    await updatePodcastEpisode(episodeId, { progress: 0.05 });
    const { title, lines } = await generateScript(ep.topic, ep.level, linesWanted);
    await updatePodcastEpisode(episodeId, { title, progress: 0.15 });

    const silence = await ensureSilence();
    const concatFiles: string[] = [];
    const scriptLines: { en: string; ko: string; offset: number; dur: number }[] = [];
    let offset = 0;

    for (let i = 0; i < lines.length; i++) {
      try {
        const url = await synthesizeSpeech(lines[i].en); // data/audio/<uuid>.mp3
        const file = path.join(AUDIO_DIR, url.replace("/api/audio/", ""));
        tmpFiles.push(file);
        const dur = await ffprobeDuration(file);
        if (dur <= 0) throw new Error("empty clip");
        scriptLines.push({ en: lines[i].en, ko: lines[i].ko, offset: Math.round(offset * 100) / 100, dur: Math.round(dur * 100) / 100 });
        concatFiles.push(file, silence);
        offset += dur + 0.45;
      } catch {
        // 이 줄 음성 생성 실패 시 스크립트에서만 빼고 계속 (에피소드 전체 보호)
      }
      await updatePodcastEpisode(episodeId, { progress: 0.15 + ((i + 1) / lines.length) * 0.75 });
    }

    // concat (mp3 stream copy — clips are all kokoro 24k mono)
    const outName = `podcast-${episodeId}.mp3`;
    const outFile = path.join(AUDIO_DIR, outName);
    const listFile = path.join(AUDIO_DIR, `podcast-list-${episodeId}.txt`);
    tmpFiles.push(listFile);
    await writeFile(listFile, concatFiles.map((f) => `file '${f.replace(/'/g, "")}'`).join("\n") + "\n");
    await execFileP("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outFile]);

    // cleanup per-line clips
    for (const f of tmpFiles.filter((x) => x !== outFile)) await unlink(f).catch(() => {});

    const duration = await ffprobeDuration(outFile);
    await updatePodcastEpisode(episodeId, {
      status: "ready",
      progress: 1,
      lines: scriptLines,
      audio: `/api/audio/${outName}`,
      duration: Math.round(duration),
      title,
    });
  } catch (err) {
    for (const f of tmpFiles) await unlink(f).catch(() => {});
    await updatePodcastEpisode(episodeId, {
      status: "error",
      error: err instanceof Error ? err.message : "생성 실패",
    });
  }
}

export async function readEpisodeAudio(episodeId: string): Promise<Buffer | null> {
  const file = path.join(AUDIO_DIR, `podcast-${episodeId}.mp3`);
  try {
    return await readFile(file);
  } catch {
    return null;
  }
}
