import { NextResponse } from "next/server";
import { getUserFromRequest, unauthorized } from "@/lib/auth";
import { addPhrases, addTurn, createSession, finishSession, recordActivity } from "@/lib/store";
import { saveUserAudio } from "@/lib/tts";
import { reviewUtterances, type LiveUtterance } from "@/lib/live";

export const runtime = "nodejs";
export const maxDuration = 120;

// multipart: meta = JSON {level, minutes, transcript:[{role,text,idx}]}, audio_<idx> = wav clip
// -> saves session (topic "live") + English turns, returns the review.
export async function POST(req: Request) {
  const user = await getUserFromRequest(req);
  if (!user) return unauthorized();
  const form = await req.formData();
  let meta: any = {};
  try { meta = JSON.parse(String(form.get("meta") || "{}")); } catch {}
  const level = ["A2", "B1", "B2"].includes(meta.level) ? meta.level : "B1";
  const lines: { role: string; text: string; idx: number }[] = Array.isArray(meta.transcript) ? meta.transcript : [];
  const userUtts: LiveUtterance[] = lines
    .filter((l) => l && l.role === "user" && typeof l.text === "string" && l.text.trim())
    .map((l) => ({ idx: Number(l.idx), text: l.text.trim().slice(0, 600) }));
  // what the tutor said just before each user line (stored as reply context)
  const prevAssistant = new Map<number, string>();
  let lastA = "";
  for (const l of lines) {
    if (l.role === "assistant") lastA = String(l.text || "");
    else if (l.role === "user") prevAssistant.set(Number(l.idx), lastA);
  }

  let items;
  try {
    items = await reviewUtterances(userUtts, level);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "review failed" }, { status: 502 });
  }

  const sessionId = await createSession("live", level, user.id);
  const out = [];
  for (const it of items) {
    let audioPath: string | null = null;
    const a = form.get(`audio_${it.idx}`);
    if (a && typeof a === "object" && "arrayBuffer" in a && (a as Blob).size > 44) {
      try { audioPath = await saveUserAudio(a as Blob); } catch { audioPath = null; }
    }
    const turnId = await addTurn(sessionId, {
      audio_path: audioPath,
      transcript: it.transcript,
      transcript_cleaned: it.transcript,
      corrected: it.ok ? null : it.corrected,
      reply_en: prevAssistant.get(it.idx) || null,
      reply_audio_path: null,
      coach_note_ko: it.coach_note_ko || null,
      target_phrase: null,
      jev_score: it.score,
      jev_grammar: it.grammar,
      jev_vocab: it.vocab,
      next_difficulty: null,
      next_angle: null,
      next_focus: null,
      errors: it.errors,
    });
    recordActivity("turn", user.id).catch(() => {});
    out.push({ ...it, turn_id: turnId, my_audio: audioPath });
  }
  await finishSession(sessionId);
  // Auto-feed the phrase deck with the extracted phrases (deduped by store).
  const phraseItems = out.flatMap((it) => it.phrases.map((p) => ({ ...p, source_turn_id: it.turn_id })));
  const added = await addPhrases(user.id, phraseItems).catch(() => 0);
  return NextResponse.json({ session_id: sessionId, items: out, phrases_added: added, skipped_korean: userUtts.length - items.length });
}
