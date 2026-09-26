import { hasAIKey } from "./ai";
import { copyFile, stat } from "fs/promises";
import path from "path";
import { transcribeAudio } from "./stt";
import { saveUserAudio, synthesizeSpeech } from "./tts";
import { callTutor, TutorResult } from "./tutor";
import { localTutor } from "./local-tutor";
import { evaluateTurn } from "./jev";
import { addPhrases, addTurn, cleanupOldAudio, createSession, getLastTurn, getTutorMemory, recordActivity } from "./store";

// One full turn of the loop:
//   mic audio -> STT -> tutor (one structured JSON call) -> TTS -> persist
//   -> Jev decision pass (sentence score + next difficulty)
// Without an API key it degrades gracefully to the local demo tutor and
// browser speech synthesis, so the loop is demoable before keys exist.

export const OPENINGS: Record<string, { en: string; target: string }[]> = {
  "daily life": [
    { en: "Hey! How was your day today?", target: "It was ..." },
    { en: "What did you do this morning?", target: "I ... this morning." },
    { en: "What did you eat today? Any good food?", target: "I ate ..." },
    { en: "Did anything fun happen today?", target: "Today I ..." },
    { en: "How are you doing these days?", target: "These days I ..." },
  ],
  work: [
    { en: "Hi! What do you usually do at work?", target: "I usually ..." },
    { en: "Tell me about your day at work today.", target: "Today at work I ..." },
    { en: "Who do you work with? What are they like?", target: "My coworker is ..." },
    { en: "What was the hardest thing at work this week?", target: "The hardest thing was ..." },
    { en: "Do you like your job? Why?", target: "I like it because ..." },
  ],
  travel: [
    { en: "Hi! What's the best trip you've ever taken?", target: "I went to ..." },
    { en: "If you could travel anywhere next month, where would you go?", target: "I would go to ..." },
    { en: "Tell me about a city you want to visit again.", target: "I want to visit ... again." },
    { en: "What do you pack first when you travel?", target: "I always pack ..." },
    { en: "Beach or mountains? Tell me why!", target: "I prefer ... because ..." },
  ],
  "free talk": [
    { en: "Hey! What's on your mind today?", target: "I think ..." },
    { en: "What made you smile recently?", target: "Recently, ... made me smile." },
    { en: "If you had a free day tomorrow, what would you do?", target: "I would ..." },
    { en: "What's something new you want to try?", target: "I want to try ..." },
    { en: "What did you watch or read lately?", target: "I watched / read ..." },
  ],
};

export function pickOpening(topic: string): { opening: { en: string; target: string }; index: number } {
  const list = OPENINGS[topic] ?? OPENINGS["free talk"];
  const index = Math.floor(Math.random() * list.length);
  return { opening: list[index], index };
}

export async function startSession(topic: string, level: string, userId: string) {
  // Privacy policy (ARCHITECTURE.md): audio is personal. Delete files older
  // than AUDIO_RETENTION_DAYS (default 14) opportunistically at session start.
  cleanupOldAudio().catch(() => {});
  const sessionId = await createSession(topic, level, userId);
  const { opening, index } = pickOpening(topic);

  // Openings are a fixed pool — synthesize once per variant, reuse after.
  // Session start drops from ~1.4s to ~0.1s warm.
  const slug = topic.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "free-talk";
  const cachedPath = path.join(process.cwd(), "data", "audio", `opening-${slug}-${index}.mp3`);
  const cachedUrl = `/api/audio/opening-${slug}-${index}.mp3`;
  let openingAudioUrl = "";
  const cached = await stat(cachedPath).then(() => true, () => false);
  if (cached) {
    openingAudioUrl = cachedUrl;
  } else if (hasAIKey()) {
    try {
      const url = await synthesizeSpeech(opening.en);
      if (url) {
        const src = path.join(process.cwd(), "data", "audio", url.replace("/api/audio/", ""));
        await copyFile(src, cachedPath).catch(() => {});
        openingAudioUrl = cachedUrl;
      }
    } catch {
      openingAudioUrl = ""; // client falls back to speechSynthesis
    }
  }
  return { session_id: sessionId, opening_en: opening.en, opening_target: opening.target, opening_audio_url: openingAudioUrl };
}

export async function handleTurn(form: FormData, userId: string) {
  const topic = String(form.get("topic") || "free talk");
  const level = String(form.get("level") || "A2");
  const targetPhrase = String(form.get("target_phrase") || "");
  const turnIndex = Number(form.get("turn_index") || 0);
  const audio = form.get("audio");
  const audioBlob = audio && typeof audio === "object" && "arrayBuffer" in audio && (audio as Blob).size > 0 ? (audio as Blob) : null;

  let sessionId = String(form.get("session_id") || "");
  if (!sessionId) sessionId = await createSession(topic, level, userId);

  // 1. STT (typed transcript is the no-mic / no-key fallback)
  let transcript = "";
  let sttFailed = false;
  if (hasAIKey() && audioBlob) {
    try {
      transcript = await transcribeAudio(audioBlob);
    } catch {
      sttFailed = true;
    }
  } else {
    transcript = String(form.get("transcript") || "").trim();
  }
  if (!transcript) {
    transcript = "(no speech detected)";
    sttFailed = true;
  }

  // 2. Tutor: real LLM when keyed, local rules otherwise.
  //    Memory snapshot + the difficulty directive Jev decided on the
  //    PREVIOUS turn, so the conversation adapts to the learner.
  const [memory, lastTurn] = await Promise.all([getTutorMemory(userId), getLastTurn(sessionId)]);
  const input = {
    topic, level, targetPhrase, transcript, memory,
    difficultyDirective: lastTurn?.next_difficulty || "",
    angleDirective: lastTurn?.next_angle || "",
    focusDirective: lastTurn?.next_focus || "",
  };
  let result: TutorResult;
  let demo = !hasAIKey();
  if (hasAIKey()) {
    try {
      result = await callTutor(input);
    } catch (err) {
      // Surface why the LLM failed instead of silently degrading to demo mode.
      console.error("[tutor] LLM call failed, falling back to local tutor:", err);
      result = localTutor(input, turnIndex);
      demo = true;
    }
  } else {
    result = localTutor(input, turnIndex);
  }

  if (sttFailed && result.transcript_cleaned === "(no speech detected)") {
    result = {
      ...result,
      coach_note_ko: "음성 인식이 잘 안 됐어요. 조금 천천히 다시 말해 주세요.",
      reply_en: "Sorry, I didn't catch that. Can you say it again, a little slower?",
      errors: [],
      target_phrase_for_next_turn: "",
    };
  }

  // 3 + 4.5. TTS and the Jev decision pass run in PARALLEL — both depend only
  // on the tutor result, so total wait is max(TTS, Jev), not the sum.
  let replyAudioUrl = "";
  const ttsP = hasAIKey() && !demo
    ? synthesizeSpeech(result.reply_en)
        .then((u) => { replyAudioUrl = u; })
        .catch(() => {})
    : Promise.resolve();
  const jevP = evaluateTurn({
    level,
    transcript: result.transcript_cleaned || transcript,
    corrected: result.natural_versions[0] || result.errors[0]?.fix || "",
  })
    .then((v) => {
      result.jev_score = v?.score ?? null;
      result.jev_grammar = v?.grammar ?? null;
      result.jev_vocab = v?.vocab ?? null;
      result.next_difficulty = v?.difficulty ?? null;
      result.next_angle = v?.angle ?? null;
      result.next_focus = v?.focus ?? null;
    })
    .catch(() => {});
  await Promise.all([ttsP, jevP]);
  if (result.jev_score === undefined) result.jev_score = null;
  if (result.jev_grammar === undefined) result.jev_grammar = null;
  if (result.jev_vocab === undefined) result.jev_vocab = null;
  if (result.next_difficulty === undefined) result.next_difficulty = null;
  if (result.next_angle === undefined) result.next_angle = null;
  if (result.next_focus === undefined) result.next_focus = null;

  // 4. Persist
  let audioPath: string | null = null;
  if (audioBlob) {
    try {
      audioPath = await saveUserAudio(audioBlob);
    } catch {
      audioPath = null;
    }
  }

  const turnId = await addTurn(sessionId, {
    audio_path: audioPath,
    transcript,
    transcript_cleaned: result.transcript_cleaned,
    corrected: result.natural_versions[0] ?? (result.errors[0]?.fix ?? null),
    reply_en: result.reply_en,
    reply_audio_path: replyAudioUrl || null,
    coach_note_ko: result.coach_note_ko,
    target_phrase: result.target_phrase_for_next_turn,
    jev_score: result.jev_score,
    jev_grammar: result.jev_grammar,
    jev_vocab: result.jev_vocab,
    next_difficulty: result.next_difficulty,
    next_angle: result.next_angle,
    next_focus: result.next_focus,
    errors: result.errors,
  });

  // 5. Feed the phrase bank with what this conversation produced
  await addPhrases(
    userId,
    result.phrases.map((p) => ({ ...p, source_turn_id: turnId })),
  );

  // 6. XP for practicing (gamification; failures tolerated)
  recordActivity("turn", userId).catch(() => {});

  return {
    session_id: sessionId,
    demo,
    phrases_saved: result.phrases.length,
    transcript,
    transcript_cleaned: result.transcript_cleaned,
    corrected: result.natural_versions[0] ?? (result.errors[0]?.fix ?? ""),
    errors: result.errors,
    pronunciation_tip: result.pronunciation_tip,
    coach_note_ko: result.coach_note_ko,
    reply_en: result.reply_en,
    reply_audio_url: replyAudioUrl,
    target_phrase: result.target_phrase_for_next_turn,
    score: result.jev_score,
    grammar: result.jev_grammar,
    vocab: result.jev_vocab,
    next_difficulty: result.next_difficulty,
    next_angle: result.next_angle,
    my_audio: audioPath,
    sample_answers: result.sample_answers,
  };
}
