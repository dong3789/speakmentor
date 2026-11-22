import { aiConfig, ttsConfig, hasAIKey } from "./ai";
import { sanitizeTutorResult, type TutorResult } from "./tutor";
import { evaluateTurn } from "./jev";
import { hasHangul } from "./korean-help";

// ⚡ Live mode (Grok realtime voice). The browser talks to xAI directly with a
// short-lived client secret minted here; the real key never leaves the server.
// After the session, the learner's English utterances are reviewed in ONE
// batched LLM call (instead of one call per sentence) + Jev scoring per line.

export const REALTIME_MODEL = "grok-voice-latest";
export const LIVE_MAX_MINUTES = 20;
export const LIVE_PRICE_PER_MIN = 0.08;

export function realtimeKey(): string {
  return process.env.XAI_API_KEY || ttsConfig().apiKey;
}

export async function mintRealtimeToken(seconds = 300): Promise<{ value: string; expires_at: number }> {
  const res = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${realtimeKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`client_secrets failed: ${res.status}`);
  const j = await res.json();
  if (!j?.value) throw new Error("client_secrets returned no token");
  return { value: String(j.value), expires_at: Number(j.expires_at) || 0 };
}

export function liveInstructions(level: string): string {
  return `# Role
You are Iris, a warm, upbeat English conversation partner for a Korean adult learner (around CEFR ${level}, intermediate). This is a live spoken chat, not a lesson.

# Style
- Keep every reply SHORT: 1-2 spoken sentences. Then ask ONE natural follow-up question.
- Use common, natural spoken English. Speak a little slowly and clearly.
- Do NOT correct grammar or lecture during the chat. Corrections happen after the session. If meaning is unclear, just ask what they meant.
- React to what they said like a friend (interest, small opinions), then keep the conversation moving.

# When the learner speaks Korean or asks how to say something
If the learner speaks Korean, mixes Korean, or asks "how do I say ... in English?" / "영어로 뭐라고 해?":
1. Immediately give ONE natural English sentence that says what they meant. Say it clearly.
2. Ask them to say it: e.g. "Try saying it: ..."
3. After they repeat it (even imperfectly), give a quick "Nice!" and continue the conversation with a follow-up question.
Never explain grammar at length. Never answer in long Korean; at most a few Korean words if truly needed.

# Start
Begin by greeting them briefly and asking a light question about their day.`;
}

export type LiveUtterance = { text: string; idx: number };

export type LiveReviewItem = {
  idx: number;
  transcript: string;
  corrected: string;
  errors: { span: string; type: string; fix: string }[];
  coach_note_ko: string;
  pronunciation_tip: { focus_word: string; note: string } | null;
  phrases: { phrase: string; ko_note: string }[];
  ok: boolean; // already natural
  score: number | null;
  grammar: number | null;
  vocab: number | null;
};

const REVIEW_PROMPT = `You are SpeakMentor, a kind spoken-English coach for a Korean learner.
You receive the learner's utterances from a live voice chat (speech-to-text transcripts, so punctuation may be off).
For EACH utterance return a review. Rules:
- corrected: the most natural spoken version keeping their meaning (same if already fine).
- errors: up to 2 most useful issues: {span (exact words they said), type: tense|article|preposition|word_choice|agreement|other, fix}.
- ok: true if the sentence is already natural (then errors = []).
- coach_note_ko: one short, kind, specific Korean sentence.
- pronunciation_tip: ONLY if the transcript contains a word that looks like a speech-recognition mishearing (e.g. a wrong word that sounds similar to what fits), give {focus_word, note} where note in Korean says which word was probably heard instead and how to pronounce it. Otherwise null. Never invent pronunciation problems.
- phrases: 0-2 reusable natural spoken phrases from the corrected version: {phrase, ko_note (Korean meaning)}.
Ignore filler words. Output JSON only: {"items":[{"idx":number,"corrected":string,"ok":boolean,"errors":[...],"coach_note_ko":string,"pronunciation_tip":{...}|null,"phrases":[...]}]}`;

function extractJson(content: string): any {
  const cleaned = content.replace(/```json|```/g, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s === -1 || e === -1) throw new Error("review returned no JSON");
  return JSON.parse(cleaned.slice(s, e + 1));
}

export function englishOnly(utts: LiveUtterance[]): LiveUtterance[] {
  return utts.filter((u) => u.text.trim().split(/\s+/).length >= 2 && !hasHangul(u.text));
}

// One LLM call for the whole session + Jev per line in parallel.
export async function reviewUtterances(utts: LiveUtterance[], level: string): Promise<LiveReviewItem[]> {
  const list = englishOnly(utts).slice(0, 40);
  if (list.length === 0) return [];
  let raw: any[] = [];
  if (hasAIKey()) {
    const { apiKey, baseUrl } = aiConfig();
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.TUTOR_MODEL || "grok-4.20-non-reasoning",
        messages: [
          { role: "system", content: REVIEW_PROMPT },
          { role: "user", content: JSON.stringify({ level, utterances: list.map((u) => ({ idx: u.idx, text: u.text })) }) },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1500 + list.length * 300,
        ...(process.env.TUTOR_REASONING ? { reasoning_effort: process.env.TUTOR_REASONING } : {}),
      }),
      signal: AbortSignal.timeout(90000),
    });
    if (!res.ok) throw new Error(`review LLM failed: ${res.status}`);
    const data = await res.json();
    raw = extractJson(data.choices?.[0]?.message?.content ?? "{}")?.items ?? [];
  }
  const byIdx = new Map<number, any>(raw.filter((r) => r && typeof r.idx === "number").map((r) => [r.idx, r]));
  const items = list.map((u): LiveReviewItem => {
    const r = byIdx.get(u.idx) ?? {};
    const t: TutorResult = sanitizeTutorResult({ ...r, natural_versions: r.corrected ? [r.corrected] : [] }, u.text);
    const errors = Array.isArray(r.errors)
      ? sanitizeTutorResult({ errors: r.errors.slice(0, 1) }, u.text).errors.concat(
          r.errors.length > 1 ? sanitizeTutorResult({ errors: [r.errors[1]] }, u.text).errors : [],
        )
      : [];
    const ok = Boolean(r.ok) && errors.length === 0;
    return {
      idx: u.idx,
      transcript: u.text,
      corrected: String(r.corrected || u.text).slice(0, 400),
      errors,
      coach_note_ko: r.coach_note_ko ? t.coach_note_ko : hasAIKey() ? "" : "AI 키가 없어 교정을 할 수 없어요.",
      pronunciation_tip: t.pronunciation_tip,
      phrases: t.phrases.slice(0, 2),
      ok,
      score: null,
      grammar: null,
      vocab: null,
    };
  });
  await Promise.all(
    items.map((it) =>
      evaluateTurn({ level, transcript: it.transcript, corrected: it.ok ? "" : it.corrected })
        .then((v) => { it.score = v?.score ?? null; it.grammar = v?.grammar ?? null; it.vocab = v?.vocab ?? null; })
        .catch(() => {}),
    ),
  );
  return items;
}
