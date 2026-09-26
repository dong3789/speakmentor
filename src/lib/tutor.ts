import { aiConfig } from "./ai";

// One structured LLM call per turn. JSON in, JSON out.
// Mirrors prompts/tutor_turn.md — keep them in sync.
//
// The tutor is a LONG-TERM personal coach: every turn receives a memory
// snapshot (recent error types + phrases already learned) and returns
// phrases extracted from THIS conversation for the phrase bank.

export type Phrase = { phrase: string; ko_note: string };

export type TutorMemory = {
  recent_error_types: string[];
  learned_phrases: string[];
};

export type TutorResult = {
  transcript_cleaned: string;
  level_estimate: "A2" | "B1" | "B2";
  errors: { span: string; type: string; fix: string }[];
  natural_versions: string[];
  pronunciation_tip: { focus_word: string; note: string } | null;
  coach_note_ko: string;
  reply_en: string;
  target_phrase_for_next_turn: string;
  phrases: Phrase[];
  jev_score?: number | null;
  jev_grammar?: number | null;
  jev_vocab?: number | null;
  next_difficulty?: string | null;
  next_angle?: string | null;
  next_focus?: string | null;
  sample_answers?: string[];
};

export type TutorInput = {
  topic: string;
  level: string;
  targetPhrase: string;
  transcript: string;
  memory?: TutorMemory;
  difficultyDirective?: string;
  angleDirective?: string;
  focusDirective?: string;
};

const SYSTEM_PROMPT = `You are SpeakMentor, a patient spoken-English tutor and the user's ongoing personal English coach.
The user is a Korean speaker practicing out loud. They may make mistakes. That is expected.
You remember their history. You are not a one-off chatbot — you are their tutor over weeks.

Goals:
1. Keep the conversation going in simple spoken English.
2. Correct only the most useful issue in this turn. Do not list every error.
3. Give one pronunciation tip only if a common word is likely hard.
4. Ask a follow-up that makes them reuse the corrected phrase.
5. Extract 1-3 phrases from this turn that the user actually said or could reuse tomorrow. These go into their long-term phrase bank, so pick REAL spoken English, not textbook sentences.

Rules:
- Spoken reply (reply_en): max 2 short sentences, spoken English only.
- difficulty_directive ("easier"|"same"|"harder") comes from an evaluator model: pitch reply_en accordingly.
  "easier" = shorter sentences, very common words, yes/no or two-choice questions.
  "harder" = invite a longer answer, richer vocabulary, follow-up detail questions.
- recent_replies = questions you ALREADY asked. Ask something NEW every turn:
  change the angle, topic detail, or question word. Never copy a recent reply.
- question_angle picks the TYPE of your question (reply_en must follow it):
  detail_followup = who/where/when/how about their answer; hypothetical = fun
  "what if" related to their answer; opinion_reason = their opinion + why;
  past_story = a past memory or story; comparison = compare two things.
- sample_answers: TWO short example answers to YOUR question (reply_en),
  matched to the learner's level. Different content each — show the range of
  what a good answer looks like. Plain spoken English, one sentence each.
- practice_focus picks WHAT the question should make them practice:
  fix_recent_error = recycle their latest corrected mistake so they retry it
  right; target_phrase_reuse = weave previous_target_phrase into the question;
  describe_more = invite adjectives and feelings; free_fluency = long answer.
- coach_note_ko: one short Korean sentence, kind and specific.
- If a phrase from their learned history fits naturally, encourage reuse; do not force it.
- If the transcript looks like an STT failure, set reply_en to a short "please say that again" question.
- Prefer high-frequency spoken English over textbook English.
- Output JSON only. No markdown.

Output JSON with EXACTLY these keys (no extras, no renames):
{
  "transcript_cleaned": "string",
  "level_estimate": "A2" | "B1" | "B2",
  "errors": [{ "span": "string", "type": "tense|article|preposition|word_choice|agreement|other", "fix": "string" }],
  "natural_versions": ["string"],
  "pronunciation_tip": { "focus_word": "string", "note": "string" } | null,
  "coach_note_ko": "string",
  "reply_en": "string",
  "target_phrase_for_next_turn": "string",
  "phrases": [{ "phrase": "string", "ko_note": "string" }],
  "sample_answers": ["string"]
}`;

export function buildTutorMessages(input: TutorInput) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: JSON.stringify({
        user_level: input.level,
        topic: input.topic,
        previous_target_phrase: input.targetPhrase,
        memory: input.memory ?? { recent_error_types: [], learned_phrases: [] },
        difficulty_directive: input.difficultyDirective || "same",
        question_angle: input.angleDirective || "detail_followup",
        practice_focus: input.focusDirective || "free_fluency",
        transcript: input.transcript,
      }),
    },
  ];
}

function extractJson(content: string): any {
  const cleaned = content.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("tutor returned no JSON");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Enforce product rules even if the model disobeys:
// - at most ONE error (one high-value fix per turn)
// - at most 3 phrases per turn
// - fields always exist and stay short
// Error types are an enum so /stats can chart them reliably.
const ERROR_TYPES = ["tense", "article", "preposition", "word_choice", "agreement", "other"] as const;

function normalizeErrorType(raw: any): string {
  const t = String(raw || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (ERROR_TYPES as readonly string[]).includes(t) ? t : "other";
}

export function sanitizeTutorResult(raw: any, transcript: string): TutorResult {
  // Tolerate common field-name aliases the model may emit despite the schema.
  const naturalVersions: any[] = Array.isArray(raw?.natural_versions) && raw.natural_versions.length
    ? raw.natural_versions
    : raw?.corrected_sentence
      ? [raw.corrected_sentence]
      : [];
  const phrasesRaw: any[] = Array.isArray(raw?.phrases)
    ? raw.phrases
    : Array.isArray(raw?.phrase_bank_additions)
      ? raw.phrase_bank_additions.map((p: any) => (typeof p === "string" ? { phrase: p } : p))
      : [];
  const errors = Array.isArray(raw?.errors)
    ? raw.errors
        .filter((e: any) => e && typeof e.span === "string" && typeof e.fix === "string")
        .map((e: any) => ({
          span: e.span.slice(0, 120),
          type: normalizeErrorType(e.type),
          fix: e.fix.slice(0, 200),
        }))
    : [];
  const level = ["A2", "B1", "B2"].includes(raw?.level_estimate) ? raw.level_estimate : "A2";
  const tip =
    raw?.pronunciation_tip && typeof raw.pronunciation_tip.focus_word === "string"
      ? {
          focus_word: raw.pronunciation_tip.focus_word.slice(0, 60),
          note: String(raw.pronunciation_tip.note ?? "").slice(0, 200),
        }
      : null;
  const phrases = phrasesRaw
    .filter((p: any) => p && typeof p.phrase === "string" && p.phrase.trim().length > 1)
    .map((p: any) => ({
      phrase: p.phrase.trim().slice(0, 160),
      ko_note: String(p.ko_note ?? "").slice(0, 200),
    }));
  return {
    transcript_cleaned: String(raw?.transcript_cleaned || transcript).slice(0, 500),
    level_estimate: level,
    errors: errors.slice(0, 1),
    natural_versions: naturalVersions.filter((s: any) => typeof s === "string").slice(0, 3),
    pronunciation_tip: tip,
    coach_note_ko: String(raw?.coach_note_ko || "잘했어요! 계속 이어가 보세요.").slice(0, 300),
    reply_en: String(raw?.reply_en || "Interesting! Tell me more.").slice(0, 300),
    target_phrase_for_next_turn: String(raw?.target_phrase_for_next_turn || "").slice(0, 120),
    phrases: phrases.slice(0, 3),
    sample_answers: Array.isArray(raw?.sample_answers)
      ? raw.sample_answers.filter((x: any) => typeof x === "string" && x.trim().length > 2).slice(0, 2)
      : [],
  };
}

export async function callTutor(input: TutorInput): Promise<TutorResult> {
  const { apiKey, baseUrl } = aiConfig();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
      body: JSON.stringify({
        model: process.env.TUTOR_MODEL || "gpt-4o-mini",
        messages: buildTutorMessages(input),
        response_format: { type: "json_object" },
        temperature: 0.4,
        // Thinking models (e.g. Gemini 3.x flash) spend part of this budget on
        // reasoning; too small a cap truncates the JSON mid-object.
        max_tokens: 2000,
        // Latency: low thinking cuts ~7s -> ~2.5s with no JSON-quality loss.
        reasoning_effort: process.env.TUTOR_REASONING || "low",
      }),
  });
  if (!res.ok) {
    throw new Error(`tutor LLM failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const content: string = data.choices?.[0]?.message?.content ?? "";
  return sanitizeTutorResult(extractJson(content), input.transcript);
}
