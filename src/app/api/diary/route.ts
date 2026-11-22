import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { demoFeatureBlocked, isDemoUser } from "@/lib/demo";
import { addDiaryEntry, listDiaryEntries } from "@/lib/store";
import { hasAIKey, aiConfig } from "@/lib/ai";
import { transcribeAudio } from "@/lib/stt";
import { saveDiaryAudio } from "@/lib/tts";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/diary -> the user's entries, newest first.
export async function GET(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const entries = await listDiaryEntries(user.id);
  return NextResponse.json({ entries });
}

// POST /api/diary  multipart: audio? | text?  (하나는 필수)
// audio -> whisper 전사로 일기 생성. text -> 타이핑 일기.
// Gemini가 한국어 번역 + 부드러운 교정본을 함께 만들어 저장.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  if (isDemoUser(user)) return demoFeatureBlocked();
  const form = await req.formData();
  const audio = form.get("audio");
  const audioBlob = audio && typeof audio === "object" && "arrayBuffer" in audio && (audio as Blob).size > 0 ? (audio as Blob) : null;
  const typed = String(form.get("text") || "").trim();

  let text = typed;
  if (!text && audioBlob && hasAIKey()) {
    try {
      text = await transcribeAudio(audioBlob);
    } catch {
      return NextResponse.json({ error: "음성 전사에 실패했어요. 다시 녹음해 주세요." }, { status: 502 });
    }
  }
  if (!text || text === "(no speech detected)") {
    return NextResponse.json({ error: "일기 내용이 비어 있어요" }, { status: 400 });
  }
  text = text.slice(0, 2000);

  let audioPath: string | null = null;
  if (audioBlob) {
    try {
      audioPath = await saveDiaryAudio(audioBlob);
    } catch {
      audioPath = null;
    }
  }

  // Gemini: 한국어 번역 + 교정본 (실패해도 일기는 저장)
  let ko: string | null = null;
  let corrected: string | null = null;
  if (hasAIKey()) {
    try {
      const { apiKey, baseUrl } = aiConfig();
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: process.env.TUTOR_MODEL || "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "A Korean learner wrote an English diary entry. Return JSON only: " +
                '{"ko": "자연스러운 한국어 번역", "corrected": "the entry with grammar/spelling gently corrected, keeping their voice, ideas and length"}. ' +
                "If the entry is already correct, corrected = the entry unchanged. JSON only, no markdown.",
            },
            { role: "user", content: text },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 2000,
          reasoning_effort: process.env.TUTOR_REASONING || "low",
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        const data = await res.json();
        const raw = (data?.choices?.[0]?.message?.content ?? "{}").replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(raw);
        if (typeof parsed.ko === "string") ko = parsed.ko.slice(0, 1000);
        if (typeof parsed.corrected === "string") corrected = parsed.corrected.slice(0, 2000);
      }
    } catch {
      // 번역/교정 실패는 일기 저장을 막지 않음
    }
  }

  const entry = await addDiaryEntry(user.id, { text, corrected, ko, audio_path: audioPath });
  return NextResponse.json({ entry });
}
