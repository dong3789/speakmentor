"use client";

import { useEffect, useRef, useState } from "react";

import TabNav from "@/components/TabNav";
const TOPICS = ["daily life", "work", "travel", "free talk"];
const LEVELS = ["A2", "B1", "B2"];
const MAX_TURNS = 8;

type Turn = {
  transcript: string;
  corrected: string;
  errors: { span: string; type: string; fix: string }[];
  pronunciation_tip: { focus_word: string; note: string } | null;
  coach_note_ko: string;
  reply_en: string;
  reply_audio_url: string;
  target_phrase: string;
  score: number | null;
  next_difficulty: string | null;
  next_angle: string | null;
  sample_answers: string[];
  my_audio: string;
};

type Game = {
  xp: number;
  level: number;
  level_title: string;
  level_into: number;
  level_span: number;
  streak_days: number;
  today_turns: number;
  goal: { turns_target: number };
  goal_met: boolean;
  seeds: number;
  seeds_cap: number;
  parrot: { emoji: string; name: string; next: { minLevel: number; emoji: string; name: string } | null };
};

// One shared <audio> element, reused for every clip. iOS Safari only lets a
// page play audio after a user gesture; unlocking this single element on the
// first tap keeps later (non-gesture) plays in hands-free mode working.
let sharedAudio: HTMLAudioElement | null = null;
let onAudioEnd: (() => void) | null = null;
const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=";

function getAudio(): HTMLAudioElement {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.setAttribute("playsinline", "true");
    sharedAudio.onended = () => fireEnd();
    sharedAudio.onerror = () => fireEnd();
  }
  return sharedAudio;
}

function fireEnd() {
  const cb = onAudioEnd;
  onAudioEnd = null;
  cb?.();
}

// Call inside a tap handler.
function unlockAudio() {
  const a = getAudio();
  if (a.dataset.unlocked) return;
  a.dataset.unlocked = "1";
  a.src = SILENT_WAV;
  a.play().catch(() => {});
}

function stopAudio() {
  onAudioEnd = null;
  if (sharedAudio) sharedAudio.pause();
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

function playUrl(url: string) {
  stopAudio();
  const a = getAudio();
  a.src = url;
  a.play().catch(() => {});
}

// onEnd fires once when playback finishes (or fails) — drives hands-free mode.
function speak(url: string, text: string, onEnd?: () => void) {
  stopAudio();
  if (url) {
    const a = getAudio();
    onAudioEnd = onEnd ?? null;
    a.src = url;
    a.play().catch(() => fallbackSpeak(text, onEnd));
  } else {
    fallbackSpeak(text, onEnd);
  }
}

function fallbackSpeak(text: string, onEnd?: () => void) {
  onAudioEnd = null;
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.95;
    if (onEnd) {
      let done = false;
      const once = () => { if (!done) { done = true; onEnd(); } };
      u.onend = once;
      u.onerror = once;
    }
    window.speechSynthesis.speak(u);
  } else {
    onEnd?.();
  }
}

// Hangul anywhere in the text = the learner asked in Korean.
const HANGUL = /[\u3131-\u318E\uAC00-\uD7A3]/;
const SILENCE_MS = 1500; // auto-stop after this much quiet following speech
const NO_SPEECH_MS = 15000; // hands-free gives up if nobody talks
const MAX_REC_MS = 45000;

export default function HomePage() {
  const [phase, setPhase] = useState<"setup" | "live" | "done">("setup");
  const [topic, setTopic] = useState("daily life");
  const [level, setLevel] = useState("A2");
  const [sessionId, setSessionId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [target, setTarget] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [demo, setDemo] = useState(false);
  const [typed, setTyped] = useState("");
  const [liveText, setLiveText] = useState(""); // interim text from browser speech recognition
  const [listening, setListening] = useState(false);
  const [useRecorder, setUseRecorder] = useState(false); // record-then-upload fallback (iOS Safari)
  const [sttMode, setSttMode] = useState<"live" | "accurate">("live"); // live = browser SR, accurate = record + Gemini STT
  const [micDenied, setMicDenied] = useState(false);
  const [micOk, setMicOk] = useState(true);
  const [game, setGame] = useState<Game | null>(null);
  const [dueCount, setDueCount] = useState(0);
  const [xpFloat, setXpFloat] = useState<{ id: number; text: string } | null>(null);
  const [showSamples, setShowSamples] = useState(false);
  type Me = {
    username: string;
    role: string;
    is_demo?: boolean;
    demo?: { turns_left: number; seconds_left: number; turns_limit: number; minutes_limit: number };
  };
  const [me, setMe] = useState<Me | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authForm, setAuthForm] = useState({ username: "", password: "", invite: "" });
  const [authError, setAuthError] = useState("");
  const [myCodes, setMyCodes] = useState<{ code: string; uses: number; used_by: string[] }[]>([]);
  const [copied, setCopied] = useState("");
  const [koreanHint, setKoreanHint] = useState<string | null>(null);
  const [extraSample, setExtraSample] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState<string | null>(null);
  const [handsFree, setHandsFree] = useState(false);
  const [askKorean, setAskKorean] = useState(false); // next recording is a Korean question
  const [help, setHelp] = useState<{ ko: string; en: string; note: string; audio: string } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const handsFreeRef = useRef(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const vadRef = useRef<{ raf: number; timer: number } | null>(null);
  const sendTurnRef = useRef<(blob: Blob | null, text: string, koreanHelp?: boolean) => Promise<void>>(async () => {});
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recRef = useRef<any>(null);

  useEffect(() => () => { window.speechSynthesis?.cancel(); stopAudio(); handsFreeRef.current = false; }, []);

  useEffect(() => {
    const saved = localStorage.getItem("sm_stt_mode");
    if (saved === "accurate" || saved === "live") setSttMode(saved);
    const params = new URLSearchParams(window.location.search);
    const invite = params.get("invite");
    if (invite) {
      setAuthMode("signup");
      setAuthForm((f) => ({ ...f, invite }));
    }
  }, []);
  function switchMode(m: "live" | "accurate") {
    setSttMode(m);
    localStorage.setItem("sm_stt_mode", m);
  }

  function loadGame() {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => {
        if (!d.error) {
          setGame(d.game ?? null);
          setDueCount(d.review?.due ?? 0);
        }
      })
      .catch(() => {});
  }

  useEffect(() => {
    fetch("/api/auth/me")
      .then(async (r) => {
        if (r.ok) {
          const d = await r.json();
          setMe(d);
          loadGame();
          if (!d.is_demo) {
            fetch("/api/invites").then((r2) => r2.json()).then((d2) => setMyCodes(d2.codes || [])).catch(() => {});
          }
        }
      })
      .catch(() => {})
      .finally(() => setAuthChecked(true));
  }, []);

  async function submitAuth() {
    setAuthError("");
    const res = await fetch(`/api/auth/${authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(authForm),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAuthError(d.error || "실패했습니다");
      return;
    }
    setMe({ username: d.username, role: d.role, is_demo: Boolean(d.is_demo), demo: d.demo });
    window.dispatchEvent(new Event("sm-auth-changed"));
    loadGame();
    if (!d.is_demo) {
      fetch("/api/invites").then((r) => r.json()).then((d2) => setMyCodes(d2.codes || [])).catch(() => {});
    }
  }

  async function startDemo() {
    setAuthError("");
    const res = await fetch("/api/auth/demo", { method: "POST" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setAuthError(d.error || "데모를 시작하지 못했습니다");
      return;
    }
    setMe({ username: d.username, role: d.role, is_demo: true, demo: d.demo });
    window.dispatchEvent(new Event("sm-auth-changed"));
    loadGame();
  }

  function shareLink(code: string): string {
    return `${window.location.origin}/?invite=${code}`;
  }
  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(shareLink(code));
      setCopied(code);
      setTimeout(() => setCopied(""), 2000);
    } catch {}
  }

  async function getHint(kind: "korean" | "example") {
    if (hintBusy) return;
    setHintBusy(kind);
    setKoreanHint(kind === "korean" ? "..." : koreanHint);
    try {
      const res = await fetch("/api/hint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, question: prompt, level, samples: samples.slice(0, 2) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setKoreanHint(kind === "korean" ? d.error || "실패" : koreanHint);
        return;
      }
      if (d.seeds !== undefined) setGame((g) => (g ? { ...g, seeds: d.seeds } : g));
      if (kind === "korean") setKoreanHint(d.content);
      else setExtraSample(d.content);
    } finally {
      setHintBusy(null);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setMe(null);
    window.dispatchEvent(new Event("sm-auth-changed"));
    setGame(null);
    setDueCount(0);
    setPhase("setup");
    setTurns([]);
  }

  async function startSession() {
    unlockAudio();
    setProcessing(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, level }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "세션을 시작하지 못했습니다.");
        return;
      }
      setSessionId(data.session_id);
      setPrompt(data.opening_en);
      setTarget(data.opening_target || "");
      setTurns([]);
      setPhase("live");
      setHelp(null);
      speak(data.opening_audio_url || "", data.opening_en);
    } finally {
      setProcessing(false);
    }
  }

  // Browser-native streaming STT (Chrome/Edge). Free, no API key, and the
  // sentence appears on screen while you speak. Whisper upload remains the
  // fallback for browsers without SpeechRecognition (e.g. Firefox).
  function browserSTTSupported(): boolean {
    return typeof window !== "undefined" &&
      Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  }

  function startListening() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      startRecording(); // record-then-upload path
      return;
    }
    try {
      const rec = new SR();
      rec.lang = "en-US";
      rec.interimResults = true; // live text while speaking
      rec.continuous = false; // end on pause: one sentence per turn
      rec.maxAlternatives = 1;
      let finalText = "";
      rec.onresult = (e: any) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i];
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        setLiveText((finalText + " " + interim).trim());
      };
      rec.onend = () => {
        setListening(false);
        const text = finalText.trim();
        setLiveText("");
        if (text) sendTurn(null, text, HANGUL.test(text));
      };
      rec.onerror = (e: any) => {
        setListening(false);
        const err = e?.error || "";
        if (err === "not-allowed" || err === "service-not-allowed" || err === "audio-capture" || err === "network") {
          // iOS Safari and locked-down browsers: switch to record-then-upload.
          setUseRecorder(true);
          if (err === "not-allowed") setMicDenied(true);
        }
      };
      recRef.current = rec;
      setListening(true);
      rec.start();
    } catch {
      setUseRecorder(true); // SR exists but failed to start (common on iOS)
    }
  }

  function stopListening() {
    recRef.current?.stop(); // onend sends the turn
  }

  // MediaRecorder picks the first codec the browser actually supports.
  // iOS Safari only does audio/mp4 (AAC); desktop Chrome does webm/opus.
  function pickMime(): string {
    const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
    for (const m of candidates) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
    }
    return "";
  }

  // autoStop: watch mic level with a Web Audio analyser and stop after
  // SILENCE_MS of quiet once speech was heard (hands-free mode).
  async function startRecording(opts: { autoStop?: boolean; korean?: boolean } = {}) {
    const korean = Boolean(opts.korean);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicOk(true);
      const mime = pickMime();
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      chunksRef.current = [];
      let heard = false;
      let cancelled = false;
      recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
      recorder.onstop = async () => {
        clearVad();
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        if (cancelled || (opts.autoStop && !heard)) {
          // nobody spoke: pause hands-free instead of sending silence
          if (opts.autoStop && !heard) stopHandsFree();
          return;
        }
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        await sendTurnRef.current(blob, "", korean);
      };
      mediaRef.current = recorder;
      (recorder as any)._cancel = () => { cancelled = true; };
      recorder.start();
      setRecording(true);

      if (opts.autoStop) {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!Ctx) return;
        if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
        const ctx = audioCtxRef.current!;
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const src = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        src.connect(analyser);
        const buf = new Uint8Array(analyser.fftSize);
        const started = Date.now();
        let lastLoud = Date.now();
        const tick = () => {
          if (recorder.state !== "recording") return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0;
          for (let i = 0; i < buf.length; i++) {
            const v = (buf[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buf.length);
          const now = Date.now();
          if (rms > 0.02) {
            heard = true;
            lastLoud = now;
          }
          if (
            (heard && now - lastLoud > SILENCE_MS) ||
            (!heard && now - started > NO_SPEECH_MS) ||
            now - started > MAX_REC_MS
          ) {
            src.disconnect();
            recorder.stop();
            return;
          }
          if (vadRef.current) vadRef.current.raf = requestAnimationFrame(tick);
        };
        vadRef.current = { raf: requestAnimationFrame(tick), timer: 0 };
      }
    } catch {
      setMicOk(false); // typed fallback appears
      stopHandsFree();
    }
  }

  function clearVad() {
    if (vadRef.current) cancelAnimationFrame(vadRef.current.raf);
    vadRef.current = null;
  }

  function stopRecording() {
    setRecording(false);
    mediaRef.current?.stop();
  }

  // ---- hands-free: tap once, then listen → send → tutor speaks → listen ----
  function startHandsFree() {
    unlockAudio();
    const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (Ctx && !audioCtxRef.current) audioCtxRef.current = new Ctx();
    audioCtxRef.current?.resume().catch(() => {});
    handsFreeRef.current = true;
    setHandsFree(true);
    startRecording({ autoStop: true });
  }

  function stopHandsFree() {
    setAskKorean(false);
    handsFreeRef.current = false;
    setHandsFree(false);
    clearVad();
    const r = mediaRef.current;
    if (r && r.state === "recording") {
      (r as any)._cancel?.();
      r.stop();
    }
  }

  // Tutor audio finished: in hands-free mode, start listening again.
  function afterSpeak() {
    setSpeaking(false);
    if (handsFreeRef.current) startRecording({ autoStop: true });
  }

  function say(url: string, text: string) {
    setSpeaking(true);
    speak(url, text, afterSpeak);
  }

  // "한국어로 물어보기" button: record a Korean question (STT asked for Korean).
  function askInKorean() {
    unlockAudio();
    if (handsFreeRef.current) {
      // stop the current English listen; next take is Korean
      const r = mediaRef.current;
      if (r && r.state === "recording") {
        (r as any)._cancel?.();
        r.stop();
      }
      stopAudio();
      setSpeaking(false);
      setTimeout(() => startRecording({ autoStop: true, korean: true }), 150);
      return;
    }
    setAskKorean(true);
    startRecording({ autoStop: true, korean: true });
  }

  async function sendTurn(blob: Blob | null, text: string, koreanHelp = false) {
    setProcessing(true);
    try {
      const form = new FormData();
      if (blob) form.append("audio", blob, "turn.webm");
      if (text) form.append("transcript", text);
      form.append("stt_lang", koreanHelp ? "ko" : "auto");
      if (koreanHelp) form.append("korean_help", "1");
      form.append("question", prompt);
      form.append("session_id", sessionId);
      form.append("topic", topic);
      form.append("level", level);
      form.append("target_phrase", target);
      form.append("turn_index", String(turns.length));
      const res = await fetch("/api/turns", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "turn failed");
      setDemo(Boolean(data.demo));
      if (!sessionId && data.session_id) setSessionId(data.session_id);
      if (data.korean_help) {
        // Not an answer: same question stays; show + speak the suggestion.
        setAskKorean(false);
        setTyped("");
        setHelp({ ko: data.transcript || text, en: data.suggestion_en || "", note: data.note_ko || "", audio: data.suggestion_audio_url || "" });
        if (data.suggestion_en) say(data.suggestion_audio_url || "", data.suggestion_en);
        else afterSpeak();
        return;
      }
      const turn: Turn = {
        transcript: data.transcript_cleaned || data.transcript,
        corrected: data.corrected,
        errors: data.errors || [],
        pronunciation_tip: data.pronunciation_tip,
        coach_note_ko: data.coach_note_ko,
        reply_en: data.reply_en,
        reply_audio_url: data.reply_audio_url || "",
        target_phrase: data.target_phrase || "",
        score: typeof data.score === "number" ? data.score : null,
        next_difficulty: data.next_difficulty || null,
        next_angle: data.next_angle || null,
        sample_answers: Array.isArray(data.sample_answers) ? data.sample_answers : [],
        my_audio: data.my_audio || "",
      };
      const next = [...turns, turn];
      setTurns(next);
      setPrompt(data.reply_en);
      setTarget(data.target_phrase || "");
      setShowSamples(false);
      setKoreanHint(null);
      setExtraSample(null);
      setHelp(null);
      setTyped("");
      setXpFloat({ id: Date.now(), text: "+5 XP" });
      if (next.length >= MAX_TURNS) {
        stopHandsFree();
        speak(data.reply_audio_url || "", data.reply_en);
        finish(next.length);
      } else {
        say(data.reply_audio_url || "", data.reply_en);
      }
    } catch (e) {
      stopHandsFree();
      alert(e instanceof Error ? e.message : "오류가 발생했습니다.");
    } finally {
      setProcessing(false);
    }
  }
  sendTurnRef.current = sendTurn;

  async function finish(count: number) {
    stopHandsFree();
    setPhase("done");
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: sessionId, action: "finish", turn_count: count }),
    });
    loadGame();
  }

  // ---- end-screen takeaways ----
  const errorCounts: Record<string, number> = {};
  for (const t of turns) for (const e of t.errors) errorCounts[e.type] = (errorCounts[e.type] || 0) + 1;
  const topError = Object.entries(errorCounts).sort((a, b) => b[1] - a[1])[0];
  const fixes = turns.flatMap((t) => t.errors.map((e) => e.fix));
  const tomorrowPhrase = [...turns].reverse().find((t) => t.target_phrase)?.target_phrase ?? "";

  const goalPct = game ? Math.min(100, Math.round((game.today_turns / game.goal.turns_target) * 100)) : 0;
  const levelPct = game ? Math.round((game.level_into / game.level_span) * 100) : 0;

  const goodTurns = [...turns].reverse().filter((t) => (t.score ?? 0) >= 3.5 && t.errors.length === 0).slice(0, 2);
  const fixTurns = [...turns].reverse().filter((t) => t.errors.length > 0).slice(0, 3);
  const scoredTurns = turns.filter((t) => typeof t.score === "number");
  const avgScore = scoredTurns.length
    ? Math.round((scoredTurns.reduce((s, t) => s + (t.score ?? 0), 0) / scoredTurns.length) * 10) / 10
    : null;
  const lastDifficulty = turns.length ? turns[turns.length - 1].next_difficulty : null;
  const lastAngle = turns.length ? turns[turns.length - 1].next_angle : null;
  const baseSamples = turns.length ? turns[turns.length - 1].sample_answers : [];
  const samples = extraSample ? [...baseSamples, extraSample] : baseSamples;
  const DIFF_LABEL: Record<string, string> = { easier: "↓ 쉽게", same: "→ 유지", harder: "↑ 도전" };
  const ANGLE_LABEL: Record<string, string> = {
    detail_followup: "🔍 꼬리질문",
    hypothetical: "🤔 가정법",
    opinion_reason: "💭 의견·이유",
    past_story: "📖 경험 이야기",
    comparison: "⚖️ 비교하기",
  };

  return (
    <main className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 className="title" style={{ margin: 0 }}>SpeakMentor</h1>
        <span style={{
          width: 34, height: 34, borderRadius: 10, background: "var(--ink)", color: "#fdfbf6",
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          fontFamily: "var(--serif)", fontSize: 17, fontWeight: 700,
        }}>S</span>
      </div>
      <p className="subtitle">말하면 고쳐주고, 틀린 문장은 복습 카드가 되는 영어 튜터</p>

      <TabNav />

      {!authChecked && <p className="muted">확인 중...</p>}

      {authChecked && !me && (
        <section className="card">
          <div className="segmented" style={{ marginBottom: 14 }}>
            <button className={authMode === "login" ? "on" : ""} onClick={() => setAuthMode("login")}>로그인</button>
            <button className={authMode === "signup" ? "on" : ""} onClick={() => setAuthMode("signup")}>회원가입</button>
          </div>
          <input
            value={authForm.username}
            onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
            placeholder="아이디 (영문/숫자 3~20자)"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", fontSize: 16, marginBottom: 8 }}
          />
          <input
            type="password"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            onKeyDown={(e) => e.key === "Enter" && submitAuth()}
            placeholder="비밀번호 (6자 이상)"
            style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", fontSize: 16, marginBottom: 8 }}
          />
          {authMode === "signup" && (
            <input
              value={authForm.invite}
              onChange={(e) => setAuthForm({ ...authForm, invite: e.target.value })}
              placeholder="초대 코드 (있는 경우)"
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", fontSize: 16, marginBottom: 8 }}
            />
          )}
          {authError && <p style={{ color: "var(--red)", fontSize: 13 }}>{authError}</p>}
          <button onClick={submitAuth} className="btn" style={{ width: "100%", marginTop: 8 }}>
            {authMode === "login" ? "로그인" : "가입하기"}
          </button>
          <div className="faint" style={{ textAlign: "center", margin: "14px 0 8px" }}>또는</div>
          <button onClick={startDemo} className="btn secondary" style={{ width: "100%" }}>
            데모로 체험하기
          </button>
          <p className="faint" style={{ marginTop: 10, fontSize: 12.5, textAlign: "center" }}>
            로그인 없이 5분 또는 10마디까지 체험할 수 있어요. 기록은 따로 저장되며 다른 사람과 섞이지 않습니다.
          </p>
        </section>
      )}

      {me && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "-4px 2px 10px" }}>
          <span className="faint">
            {me.is_demo ? (
              <>데모 체험 중{me.demo ? ` · 대화 ${me.demo.turns_left}회, ${Math.max(0, Math.ceil(me.demo.seconds_left / 60))}분 남음` : ""}</>
            ) : (
              <>
                {me.username} 님{me.role === "admin" ? " (관리자)" : ""}
                {me.role === "admin" && <> · <a href="/admin">학습 현황 보기 →</a></>}
              </>
            )}
          </span>
          <button onClick={logout} className="btn secondary small">{me.is_demo ? "체험 종료" : "로그아웃"}</button>
        </div>
      )}
      {me?.is_demo && (
        <p className="chip amber" style={{ margin: "0 0 10px" }}>
          데모는 5분 또는 10마디까지 이용할 수 있어요. 가입하면 기록을 남기고 더 연습할 수 있습니다.
        </p>
      )}

      {me && game && (
        <>
          <div className="kicker">TODAY</div>
          <div className="numbers">
            <div className="n"><b>{game.streak_days}일</b><span>연속 학습</span></div>
            <div className="n"><b>Lv.{game.level}</b><span>{game.level_title}</span></div>
            <div className="n"><b>{game.seeds}</b><span>씨앗</span></div>
            <div className="n"><b>{game.goal_met ? "달성" : `${goalPct}%`}</b><span>오늘 {game.today_turns}/{game.goal.turns_target}</span></div>
          </div>

          <section className="card" style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 18px" }}>
            <span style={{ fontSize: 40 }}>{game.parrot.emoji}</span>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <b style={{ fontSize: 16 }}>성장 {game.parrot.name}</b>
                <span className="faint">{game.parrot.next ? `다음 ${game.parrot.next.name}` : "최고 단계"}</span>
              </div>
              <div className="progressbar" style={{ margin: "8px 0 6px" }}>
                <div style={{ width: `${levelPct}%` }} />
              </div>
              <div className="faint">{game.xp} XP{game.parrot.next ? ` · ${game.level_span - game.level_into} XP 남음` : ""}</div>
            </div>
          </section>
        </>
      )}

      {game && !game.goal_met && (
        <div style={{ margin: "-2px 2px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
            <span>Lv.{game.level + 1}까지</span>
            <span>{game.level_into}/{game.level_span} XP</span>
          </div>
          <div className="progressbar">
            <div style={{ width: `${levelPct}%` }} />
          </div>
        </div>
      )}

      {me && !me.is_demo && myCodes.length > 0 && phase !== "live" && (
        <section className="card" style={{ padding: "14px 18px" }}>
          <div className="faint" style={{ fontWeight: 700, marginBottom: 6 }}>내 초대 코드 — 링크를 보내면 바로 가입할 수 있어요</div>
          {myCodes.slice(0, 3).map((c) => (
            <div key={c.code} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", flexWrap: "wrap" }}>
              <b style={{ fontSize: 15, letterSpacing: "0.04em" }}>{c.code}</b>
              <span className="faint">가입 {c.uses}회</span>
              <button className="btn small secondary" onClick={() => copyLink(c.code)}>
                {copied === c.code ? "✅ 복사됨" : "🔗 공유 링크 복사"}
              </button>
            </div>
          ))}
        </section>
      )}

      {me && dueCount > 0 && phase !== "live" && (
        <a href="/review" className="big-cta">
          <div>
            <div className="num">{dueCount}장</div>
            <div style={{ fontSize: 14, opacity: 0.95 }}>복습할 카드가 기다리고 있어요</div>
          </div>
          <span className="arrow">→</span>
        </a>
      )}

      {me && phase !== "live" && (
        <a href="/live" className="big-cta" style={{ background: "var(--blue)" }}>
          <div>
            <div className="num" style={{ fontSize: 24 }}>⚡ 실시간 대화</div>
            <div style={{ fontSize: 14, opacity: 0.95 }}>Grok과 바로 말로 대화 · 끝나면 교정</div>
          </div>
          <span className="arrow">→</span>
        </a>
      )}

      {me && phase === "setup" && (
        <section className="card">
          <h3 style={{ margin: "0 0 8px", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", color: "var(--muted)" }}>1. 오늘의 주제</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {TOPICS.map((tp) => (
              <button key={tp} onClick={() => setTopic(tp)} className={topic === tp ? "btn small" : "btn small secondary"}>
                {tp}
              </button>
            ))}
          </div>
          <h3 style={{ margin: "18px 0 8px", fontSize: 13, fontWeight: 800, letterSpacing: "0.04em", color: "var(--muted)" }}>2. 수준</h3>
          <div style={{ display: "flex", gap: 8 }}>
            {LEVELS.map((lv) => (
              <button key={lv} onClick={() => setLevel(lv)} className={level === lv ? "btn small" : "btn small secondary"}>
                {lv}
              </button>
            ))}
          </div>
          <button onClick={startSession} disabled={processing} className="btn" style={{ width: "100%", marginTop: 20 }}>
            {processing ? "준비 중..." : "대화 시작"}
          </button>
          <p className="faint" style={{ marginTop: 12 }}>
            Chrome/Edge·Safari에서 말하면 실시간 인식됩니다. 키가 없으면 데모 튜터, 있으면 Gemini 교정으로 동작해요.
          </p>
        </section>
      )}

      {me && phase === "live" && (
        <>
          {demo && (
            <p className="chip amber" style={{ margin: "8px 0" }}>데모 모드 — API 키 없이 로컬 규칙 튜터 동작 중</p>
          )}
          <section className="card" style={{ background: "var(--blue-soft)", borderColor: "#b8e6ff" }}>
            <div className="kicker" style={{ margin: "0 0 6px" }}>TUTOR · TURN {turns.length + 1}/{MAX_TURNS}</div>
            <div className="en" style={{ fontSize: 22, fontWeight: 500, margin: "6px 0", lineHeight: 1.4 }}>{prompt}</div>
            <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
              {target && <div style={{ fontSize: 13, color: "var(--green-dark)" }}>이번에 써볼 표현: <b>{target}</b></div>}
              {lastAngle && (
                <span className="chip" style={{ fontSize: 12 }}>
                  {ANGLE_LABEL[lastAngle] ?? lastAngle}
                </span>
              )}
              {lastDifficulty && lastDifficulty !== "same" && (
                <span className="chip amber" style={{ fontSize: 12 }}>
                  난이도 {DIFF_LABEL[lastDifficulty] ?? lastDifficulty}
                </span>
              )}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
              <button onClick={() => (handsFree && !recording && !processing ? say("", prompt) : speak("", prompt))} className="btn secondary small">
                🔊 다시 듣기
              </button>
              {samples.length > 0 && (
                <button onClick={() => setShowSamples(!showSamples)} className="btn secondary small">
                  {showSamples ? "예시 숨기기" : "답변 예시 보기"}
                </button>
              )}
              {game && (
                <button
                  className="btn secondary small"
                  disabled={hintBusy === "korean" || game.seeds < 5}
                  title={game.seeds < 5 ? "씨앗이 부족해요" : "씨앗 5개로 말할 내용 힌트 받기"}
                  onClick={() => getHint("korean")}
                >
                  {hintBusy === "korean" ? "..." : "한글 힌트 · 씨앗 5"}
                </button>
              )}
              {showSamples && game && (
                <button
                  className="btn secondary small"
                  disabled={hintBusy === "example" || game.seeds < 3}
                  onClick={() => getHint("example")}
                >
                  {hintBusy === "example" ? "..." : "예시 추가 · 씨앗 3"}
                </button>
              )}
            </div>
            {koreanHint && (
              <div style={{ marginTop: 10, background: "var(--yellow-soft)", border: "2px dashed var(--yellow)", borderRadius: 12, padding: "10px 14px" }}>
                <div className="faint" style={{ fontWeight: 700 }}>이런 내용을 담아 말해보세요:</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#7a5c00" }}>{koreanHint}</div>
              </div>
            )}
            {showSamples && samples.length > 0 && (
              <div style={{ marginTop: 10, background: "#fff", border: "2px dashed var(--blue)", borderRadius: 12, padding: "10px 14px" }}>
                <div className="faint" style={{ fontWeight: 700, marginBottom: 4 }}>이런 답변은 어때요? (그대로 말하지 말고 참고만!)</div>
                {samples.map((sa, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: i < samples.length - 1 ? "1px solid var(--line)" : "none" }}>
                    <span style={{ flex: 1, fontSize: 15 }}>“{sa}”</span>
                    <button className="btn secondary small" onClick={(e) => { e.stopPropagation(); speak("", sa); }}>🔊</button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {help && (
            <section className="card" style={{ background: "var(--green-soft)", borderColor: "#a7d7b9" }}>
              <div className="kicker" style={{ margin: "0 0 6px" }}>이렇게 말해보세요</div>
              <div className="faint">“{help.ko}”</div>
              {help.en ? (
                <div className="en" style={{ fontSize: 24, fontWeight: 700, margin: "8px 0", lineHeight: 1.35, color: "#14532d" }}>{help.en}</div>
              ) : null}
              {help.note && <div style={{ fontSize: 14, color: "var(--muted)" }}>{help.note}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {help.en && (
                  <button className="btn secondary small" onClick={() => (handsFree && !recording && !processing ? say(help.audio, help.en) : speak(help.audio, help.en))}>🔊 다시 듣기</button>
                )}
                <button className="btn secondary small" onClick={() => setHelp(null)}>닫기</button>
              </div>
              <div className="faint" style={{ marginTop: 6 }}>이제 이 문장(또는 내 말로 바꿔서)을 영어로 말해보세요. 점수는 영어 답변에만 매겨져요.</div>
            </section>
          )}

          <section className="card">
            {!micOk && (
              <p style={{ color: "var(--red)", fontSize: 13 }}>
                마이크를 사용할 수 없어요. 아래에 문장을 직접 입력해 주세요.
              </p>
            )}
            {micDenied && (
              <p style={{ color: "var(--red)", fontSize: 13 }}>
                마이크 권한이 막혀 있어요. iPhone: 설정 &gt; 앱 &gt; Safari &gt; 마이크 허용,
                그리고 설정 &gt; Siri 및 검색에서 받아쓰기를 켜주세요.
              </p>
            )}
            <div className="segmented" style={{ marginBottom: 10 }}>
              <button className={sttMode === "live" ? "on" : ""} onClick={() => switchMode("live")}>⚡ 실시간 인식 (빠름)</button>
              <button className={sttMode === "accurate" ? "on" : ""} onClick={() => switchMode("accurate")}>🎯 정확 모드 (녹음)</button>
            </div>
            {micOk && (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                {!handsFree ? (
                  <button onClick={startHandsFree} disabled={processing || recording || listening} className="btn blue" style={{ flex: 1 }}>
                    🎙️ 자동 대화 시작 (한 번만 탭)
                  </button>
                ) : (
                  <button onClick={() => { stopHandsFree(); stopAudio(); setSpeaking(false); }} className="btn red" style={{ flex: 1 }}>
                    ⏸ 자동 대화 멈추기
                  </button>
                )}
                <button
                  onClick={askInKorean}
                  disabled={processing || (recording && !handsFree) || listening}
                  className="btn secondary"
                >
                  🇰🇷 한국어로 물어보기
                </button>
              </div>
            )}
            {micOk && handsFree && (
              <p className="muted" style={{ fontSize: 14, margin: "0 0 6px" }}>
                {recording
                  ? "듣고 있어요... 말이 끝나고 잠시 조용하면 자동으로 보내요"
                  : processing
                    ? "분석 중..."
                    : speaking
                      ? "튜터가 말하는 중... 끝나면 다시 들을게요"
                      : "잠시만요..."}
              </p>
            )}
            {micOk && !handsFree && recording && askKorean && (
              <p className="muted" style={{ fontSize: 14, margin: "0 0 6px" }}>한국어로 말해주세요... 멈추면 자동으로 보내요</p>
            )}
            {micOk && !handsFree && (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {!listening && !recording && (
                  <button
                    onClick={() => { unlockAudio(); if (sttMode === "accurate" || useRecorder) startRecording(); else startListening(); }}
                    disabled={processing}
                    className="btn blue"
                  >
                    {sttMode === "accurate" || useRecorder ? "녹음하기" : "말하기"}
                  </button>
                )}
                {listening && (
                  <button onClick={stopListening} className="btn red">말하기 종료</button>
                )}
                {recording && (
                  <button onClick={stopRecording} className="btn red">녹음 종료</button>
                )}
                <span className="muted" style={{ fontSize: 14 }}>
                  {listening
                    ? "듣고 있어요... 말하고 잠시 멈추면 자동 전송"
                    : recording
                      ? "녹음 중... 다 말했으면 종료를 누르세요"
                      : processing
                        ? "분석 중..."
                        : useRecorder || sttMode === "accurate"
                          ? "탭하고 말하세요. 종료를 누르면 정확하게 전사돼요"
                          : "버튼을 누르고 영어로 대답하세요"}
                </span>
              </div>
            )}
            {liveText && (
              <div style={{
                marginTop: 10, padding: "10px 14px", borderRadius: 12,
                background: "var(--green-soft)", border: "1px dashed #a7d7b9", fontSize: 16, color: "#14532d",
              }}>
                🎧 {liveText}
              </div>
            )}
            {(!micOk || (!listening && !recording && !handsFree)) && !processing && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && typed.trim() && sendTurn(null, typed.trim(), HANGUL.test(typed))}
                  placeholder="영어로 입력 (한국어로 쓰면 영어 표현을 알려줘요)"
                  style={{ flex: 1, padding: "12px 14px", borderRadius: 12, border: "1px solid var(--line)", fontSize: 16 }}
                />
                <button onClick={() => typed.trim() && sendTurn(null, typed.trim(), HANGUL.test(typed))} className="btn">전송</button>
              </div>
            )}
          </section>

          {[...turns].reverse().map((t, i) => (
            <section key={i} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="kicker" style={{ margin: 0 }}>YOU SAID</div>
                {typeof t.score === "number" && (
                  <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    {t.score >= 3.5 && t.errors.length === 0 && <span className="chip green">잘했어요</span>}
                    {t.score < 2.5 && <span className="chip amber">다시 도전</span>}
                    <span className="chip">{t.score}/5</span>
                  </span>
                )}
              </div>
              <p className="en" style={{ margin: "4px 0 0", fontSize: 17 }}>{t.transcript}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                {t.my_audio && (
                  <button className="btn secondary small" onClick={() => playUrl(t.my_audio)}>
                    🎤 내 발음 듣기
                  </button>
                )}
                {t.reply_audio_url && (
                  <button className="btn secondary small" onClick={() => playUrl(t.reply_audio_url)}>
                    🔊 튜터 음성
                  </button>
                )}
              </div>
              {t.errors.length > 0 && (
                <p style={{ margin: "6px 0", color: "var(--green)", fontSize: 15 }}>
                  {t.errors[0].span} → <b>{t.errors[0].fix}</b>
                  <span className="faint"> ({t.errors[0].type})</span>
                </p>
              )}
              {t.pronunciation_tip && (
                <p style={{ margin: "6px 0", color: "#b45309", fontSize: 14 }}>
                  🗣️ {t.pronunciation_tip.focus_word}: {t.pronunciation_tip.note}
                </p>
              )}
              {t.coach_note_ko && (
                <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)" }}>{t.coach_note_ko}</p>
              )}
            </section>
          ))}

          {turns.length >= 2 && (
            <button onClick={() => finish(turns.length)} className="btn secondary" style={{ width: "100%" }}>
              일찍 마치기
            </button>
          )}
        </>
      )}

      {me && phase === "done" && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 34, fontWeight: 700, margin: "14px 0 6px" }}>Well done.</p>
          <p className="muted" style={{ margin: "0 0 10px", fontWeight: 700, fontSize: 16 }}>세션 완료 · {turns.length}턴</p>
          <p className="muted" style={{ margin: "0 0 4px" }}>+{turns.length * 5 + 20} XP 획득</p>
          {avgScore !== null && (
            <p style={{ margin: "0 0 8px" }}>
              평균 문장 점수 <b style={{ color: avgScore >= 4 ? "var(--green)" : avgScore >= 3 ? "#b45309" : "var(--red)" }}>{avgScore}/5</b>
              <span className="faint"> — Jev 채점</span>
            </p>
          )}
          <ul style={{ textAlign: "left", lineHeight: 1.9, fontSize: 15, padding: "0 0 0 20px", margin: "0 0 14px" }}>
            <li>
              가장 많이 나온 오류:{" "}
              {topError ? <b>{topError[0]}</b> : "없음 — 오류 없이 대화했어요!"}
            </li>
            <li>
              오늘 배운 표현:{" "}
              {fixes.length ? <b>{[...new Set(fixes)].slice(0, 3).join(", ")}</b> : "—"}
            </li>
            <li>
              내일 꼭 써볼 표현:{" "}
              {tomorrowPhrase ? <b>{tomorrowPhrase}</b> : "오늘 대화에서 가장 좋았던 문장"}
            </li>
          </ul>
          {goodTurns.length > 0 && (
            <div style={{ textAlign: "left", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--green)", marginBottom: 6 }}>잘한 문장 — 이대로 유지하고 더 잘해보자</div>
              {goodTurns.map((t, i) => (
                <div key={i} style={{ background: "var(--green-soft)", border: "2px solid var(--green)", borderRadius: 12, padding: "10px 14px", margin: "6px 0" }}>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{t.transcript}</div>
                  <div className="faint">{t.score}/5</div>
                </div>
              ))}
            </div>
          )}
          {fixTurns.length > 0 && (
            <div style={{ textAlign: "left", marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--red)", marginBottom: 6 }}>고친 문장 — 복습 카드로 다시 만나요</div>
              {fixTurns.map((t, i) => (
                <div key={i} style={{ background: "var(--red-soft)", border: "2px solid var(--red)", borderRadius: 12, padding: "10px 14px", margin: "6px 0" }}>
                  <div style={{ fontSize: 14, color: "var(--muted)", textDecoration: "line-through" }}>{t.transcript}</div>
                  {t.corrected && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--green-dark)" }}>→ {t.corrected}</div>}
                </div>
              ))}
            </div>
          )}
          {dueCount > 0 && (
            <a href="/review" className="big-cta" style={{ textAlign: "left" }}>
              <div>
                <div className="num">{dueCount}장</div>
                <div style={{ fontSize: 14, opacity: 0.95 }}>방금 배운 표현도 복습하고 레벨업!</div>
              </div>
              <span className="arrow">→</span>
            </a>
          )}
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={() => { setPhase("setup"); setTurns([]); }} className="btn secondary" style={{ flex: 1 }}>새 세션</button>
            <a href="/history" className="btn" style={{ flex: 1, textDecoration: "none" }}>기록 보기</a>
          </div>
        </section>
      )}

      {xpFloat && <div className="xp-float" key={xpFloat.id}>{xpFloat.text}</div>}
    </main>
  );
}
