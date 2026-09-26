import type { TutorInput, TutorResult } from "./tutor";

// Zero-key fallback so `npm run dev` works before any API key is set.
// It is a simple rule-based tutor: it catches a handful of classic
// Korean-learner error patterns and otherwise keeps the conversation going.
// Label it as demo mode in the UI — it is NOT a replacement for the LLM tutor.

type Rule = {
  re: RegExp;
  type: string;
  fix: (m: RegExpMatchArray) => string;
  span: (m: RegExpMatchArray) => string;
  ko: string;
};

const PAST = /\b(go|eat|see|meet|watch|do|have|make|take|buy|come|get)\b/gi;
const PAST_FORM: Record<string, string> = {
  go: "went", eat: "ate", see: "saw", meet: "met", watch: "watched",
  do: "did", have: "had", make: "made", take: "took", buy: "bought",
  come: "came", get: "got",
};

const RULES: Rule[] = [
  {
    // "I go to Busan yesterday" — verb may not sit right next to "yesterday"
    re: /\b(I|we|they|you|he|she)\s+(go|eat|see|meet|watch|do|have|make|take|buy|come|get)\b(?=[\s\S]{0,30}\byesterday\b)/i,
    type: "tense",
    span: (m) => `${m[1]} ${m[2]} ... yesterday`,
    fix: (m) => `${m[1]} ${PAST_FORM[m[2].toLowerCase()]}`,
    ko: "과거 이야기예요. 동사를 과거형으로 바꿔 말해 보세요.",
  },
  {
    re: /\bmore better\b/i,
    type: "word_choice",
    span: () => "more better",
    fix: () => "much better",
    ko: "비교급은 하나만 써요. \"much better\"라고 합니다.",
  },
  {
    re: /\bI am agree\b/i,
    type: "word_choice",
    span: () => "I am agree",
    fix: () => "I agree",
    ko: "agree는 동사라서 am이 필요 없어요. \"I agree\"라고 합니다.",
  },
  {
    re: /\bhe (don't|doesn't|isn't go|not go)\b/i,
    type: "agreement",
    span: (m) => `he ${m[1]}`,
    fix: () => "he doesn't",
    ko: "he/she는 doesn't를 써요. \"he doesn't\"라고 합니다.",
  },
  {
    re: /\ba (apple|egg|orange|umbrella|idea|airport|hour)\b/i,
    type: "article",
    span: (m) => `a ${m[1]}`,
    fix: (m) => `an ${m[1]}`,
    ko: "모음으로 시작하는 단어 앞에는 an을 써요.",
  },
  {
    re: /\binterested (about|to)\b/i,
    type: "preposition",
    span: (m) => `interested ${m[1]}`,
    fix: () => "interested in",
    ko: "\"interested in\"이 자연스러워요.",
  },
];

const FOLLOWUPS: Record<string, string[]> = {
  "daily life": [
    "Nice! What did you do after that?",
    "Cool. Who were you with?",
    "Sounds good. Was it fun?",
    "Oh really? How did you feel?",
  ],
  work: [
    "Got it. How did that meeting go?",
    "Interesting. What happened next?",
    "I see. Was it difficult?",
    "Okay. What did your team say?",
  ],
  travel: [
    "Oh nice! When did you go there?",
    "Great. What did you see?",
    "Wow. What food did you try?",
    "Cool! Would you go back?",
  ],
  "free talk": [
    "Interesting! Tell me more.",
    "Oh really? What happened next?",
    "Nice. How did that feel?",
    "Cool. Why did you do that?",
  ],
};

export function localTutor(input: TutorInput, turnIndex: number): TutorResult {
  const t = input.transcript.trim() || "(no speech detected)";
  const topic = FOLLOWUPS[input.topic] ? input.topic : "free talk";
  const pool = FOLLOWUPS[topic];
  const reply = pool[turnIndex % pool.length];

  if (t === "(no speech detected)") {
    return {
      transcript_cleaned: t,
      level_estimate: "A2",
      errors: [],
      natural_versions: [],
      pronunciation_tip: null,
      coach_note_ko: "음성이 잡히지 않았어요. 조금 더 크게 다시 말해 주세요.",
      reply_en: "Sorry, I couldn't hear you. Can you say that again?",
      target_phrase_for_next_turn: "",
      phrases: [],
    };
  }

  for (const rule of RULES) {
    const m = t.match(rule.re);
    if (m) {
      const corrected = t.replace(rule.re, rule.fix(m));
      return {
        transcript_cleaned: t,
        level_estimate: "A2",
        errors: [{ span: rule.span(m), type: rule.type, fix: rule.fix(m) }],
        natural_versions: [corrected],
        pronunciation_tip: null,
        coach_note_ko: rule.ko,
        reply_en: reply,
        target_phrase_for_next_turn: rule.fix(m),
        phrases: [
          { phrase: rule.fix(m), ko_note: "오늘 교정된 표현 — 꼭 기억하세요" },
          ...(t.length < 120 ? [{ phrase: t, ko_note: "내가 실제로 말한 문장" }] : []),
        ],
      };
    }
  }

  const words = t.split(/\s+/).filter((w) => w.length >= 6);
  const focus = words[turnIndex % Math.max(words.length, 1)] ?? "because";
  return {
    transcript_cleaned: t,
    level_estimate: "A2",
    errors: [],
    natural_versions: [],
    pronunciation_tip: {
      focus_word: focus,
      note: `Stress the strong syllable of "${focus}" clearly.`,
    },
    coach_note_ko: "문법 오류는 없었어요. 어조와 강세에 집중해 보세요!",
    reply_en: reply,
    target_phrase_for_next_turn: "",
    phrases: t.length < 120 ? [{ phrase: t, ko_note: "오늘 말한 문장 — 복습해 보세요" }] : [],
  };
}
