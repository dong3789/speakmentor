// Jev (TypeSafe) — decision-making API. One request returns parallel verdicts:
// a 1-5 score for the learner's sentence and the difficulty for the next
// tutor question. ~70ms, output tokens free, failures must never break a turn.

const JEVD_URL = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";

export type JevVerdict = {
  score: number | null;
  difficulty: string | null;
  angle: string | null; // question type for the next prompt
  focus: string | null; // what the next question should practice
  grammar: number | null;
  vocab: number | null;
};

export async function evaluateTurn(input: {
  level: string;
  transcript: string;
  corrected: string;
}): Promise<JevVerdict | null> {
  const apiKey = process.env.TYPESAFE_API_KEY || "";
  if (!apiKey) return null;

  const state = [
    `Learner level: ${input.level}`,
    `What the learner said: "${input.transcript}"`,
    `Tutor's corrected version: "${input.corrected || "(no correction needed)"}"`,
  ].join("\n");

  const body = {
    state,
    model: MODEL,
    questions: {
      sentence_score: {
        type: "score",
        instructions:
          "How well did this Korean learner of English construct their spoken sentence overall? Judge the sentence they said, not the corrected version.",
        criteria: [
          "1 - broken: meaning is hard to recover",
          "2 - poor: several errors, meaning partly unclear",
          "3 - okay: understandable but has clear errors",
          "4 - good: minor errors only",
          "5 - excellent: natural and correct",
        ],
      },
      grammar_score: {
        type: "score",
        instructions: "How grammatically correct was the learner sentence?",
        criteria: [
          "1 - many grammar errors",
          "2 - several grammar errors",
          "3 - some grammar errors",
          "4 - minor grammar issues",
          "5 - grammatically perfect",
        ],
      },
      vocab_score: {
        type: "score",
        instructions: "How rich and appropriate was the vocabulary?",
        criteria: [
          "1 - very basic or wrong words",
          "2 - limited vocabulary",
          "3 - adequate simple vocabulary",
          "4 - varied vocabulary",
          "5 - rich natural vocabulary",
        ],
      },
      next_difficulty: {
        type: "choice",
        instructions:
          "What difficulty should the English tutor pitch the NEXT question at for this learner? Base it on the sentence quality.",
        criteria: {
          easier:
            "overall score is below 2.5 or the meaning barely came through: use shorter, simpler sentences and easy vocabulary",
          same: "overall score is around 3: understandable with clear errors — keep practicing at this level",
          harder:
            "overall score is 3.5 or above: the learner is comfortable — invite longer, more complex answers",
        },
      },
      question_angle: {
        type: "choice",
        instructions:
          "Which TYPE of next question helps this learner most right now? Vary the type between turns.",
        criteria: {
          detail_followup: "ask more detail about what they just said (who/where/when/how)",
          hypothetical: "fun what-if question related to their answer",
          opinion_reason: "ask their opinion and why",
          past_story: "ask them to tell a past story or memory",
          comparison: "ask them to compare two things",
        },
      },
      practice_focus: {
        type: "choice",
        instructions:
          "What should the NEXT question make the learner practice, given their errors and level?",
        criteria: {
          fix_recent_error:
            "recycle their recent corrected mistake so they retry the pattern correctly",
          target_phrase_reuse: "make them reuse the target phrase naturally",
          describe_more: "practice descriptive words and feelings",
          free_fluency: "just keep them talking at length",
        },
      },
    },
  };

  try {
    const res = await fetch(JEVD_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000), // never hold a turn hostage
    });
    if (!res.ok) return null;
    const data = await res.json();
    console.log("[jev] answered keys:", Object.keys(data?.answers ?? {}).join(","));
    const answers = data?.answers ?? {};
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n * 10) / 10 : null;
    };
    const choice = (v: unknown) => (typeof v === "string" && v ? v : null);
    return {
      score: num(answers.sentence_score?.score),
      difficulty: choice(answers.next_difficulty?.choice),
      angle: choice(answers.question_angle?.choice),
      focus: choice(answers.practice_focus?.choice),
      grammar: num(answers.grammar_score?.score),
      vocab: num(answers.vocab_score?.score),
    };
  } catch {
    return null;
  }
}
