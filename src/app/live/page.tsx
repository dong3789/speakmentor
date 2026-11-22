"use client";

// ⚡ 실시간 대화 — Grok realtime voice (WebSocket, PCM16 24 kHz both ways).
// The browser gets a 5-minute client secret from /api/live/token; the real
// xAI key never reaches the client. Mic -> ScriptProcessor -> resample to
// 24 kHz -> input_audio_buffer.append. Server VAD handles turn-taking; when
// the learner starts talking we stop playback (barge-in). Each user
// utterance is also clipped from the same PCM stream into a local WAV so the
// review can replay "my voice" next to the corrected sentence.

import { useEffect, useRef, useState } from "react";
import TabNav from "@/components/TabNav";

const RATE = 24000;
const MAX_MIN = 20;
const SILENCE_MS = 60_000;
const PREROLL = RATE * 1.5; // samples kept before VAD fires
const CLIP_MAX = RATE * 25;

type Line = { id: string; role: "user" | "assistant"; text: string; idx: number; done: boolean };
type ReviewItem = {
  idx: number; turn_id: string; transcript: string; corrected: string; ok: boolean;
  errors: { span: string; type: string; fix: string }[];
  coach_note_ko: string;
  pronunciation_tip: { focus_word: string; note: string } | null;
  phrases: { phrase: string; ko_note: string }[];
  score: number | null; my_audio: string | null;
};
type Review = { items: ReviewItem[]; phrases_added: number; skipped_korean: number; session_id: string };

function b64FromInt16(a: Int16Array): string {
  const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(s);
}
function int16FromB64(b: string): Int16Array {
  const bin = atob(b);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Int16Array(u8.buffer, 0, u8.length >> 1);
}
function resampleTo(input: Float32Array, from: number, to: number): Int16Array {
  const ratio = from / to;
  const n = Math.floor(input.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio, i0 = Math.floor(p), f = p - i0;
    const a = input[i0] ?? 0, b = input[i0 + 1] ?? a;
    const s = Math.max(-1, Math.min(1, a + (b - a) * f));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}
function wavFrom(chunks: Int16Array[]): Blob {
  const len = chunks.reduce((n, c) => n + c.length, 0);
  const buf = new ArrayBuffer(44 + len * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); v.setUint32(4, 36 + len * 2, true); w(8, "WAVE"); w(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, "data"); v.setUint32(40, len * 2, true);
  let o = 44;
  for (const c of chunks) { new Int16Array(buf, o, c.length).set(c); o += c.length * 2; }
  return new Blob([buf], { type: "audio/wav" });
}
function highlight(text: string, spans: string[]) {
  const s = spans.filter(Boolean).sort((a, b) => b.length - a.length);
  if (!s.length) return text;
  const re = new RegExp(`(${s.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((p, i) =>
    s.some((x) => x.toLowerCase() === p.toLowerCase())
      ? <mark key={i} style={{ background: "var(--red-soft)", color: "var(--red-dark)", borderRadius: 3, padding: "0 2px" }}>{p}</mark>
      : <span key={i}>{p}</span>);
}


async function openMic(): Promise<MediaStream> {
  const ideal: MediaStreamConstraints = {
    audio: {
      echoCancellation: { ideal: true },
      noiseSuppression: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    },
  };
  try {
    return await navigator.mediaDevices.getUserMedia(ideal);
  } catch (e: any) {
    const name = String(e?.name || "");
    // Permission / security errors should not be retried with a looser constraint.
    if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") throw e;
    return await navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

function micErrorMessage(e: any): string {
  const name = String(e?.name || "");
  const msg = String(e?.message || "");
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "마이크 권한이 필요해요. 브라우저 설정에서 마이크를 허용해 주세요.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "마이크를 찾지 못했어요. 연결을 확인하고 다시 시도해 주세요.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "마이크를 다른 앱이 사용 중일 수 있어요. 다른 프로그램을 종료한 뒤 다시 시도해 주세요.";
  }
  if (
    name === "OverconstrainedError" ||
    name === "ConstraintNotSatisfiedError" ||
    /invalid constraint/i.test(msg)
  ) {
    return "이 기기에서 마이크를 열지 못했어요. 다른 마이크를 연결하거나 브라우저를 바꾼 뒤 다시 시도해 주세요.";
  }
  if (name === "SecurityError") {
    return "보안 설정 때문에 마이크를 쓸 수 없어요. HTTPS로 접속했는지 확인해 주세요.";
  }
  return msg ? `마이크를 시작하지 못했어요. ${msg}` : "마이크를 시작하지 못했어요. 권한과 연결을 확인해 주세요.";
}

function isMicError(e: any): boolean {
  const name = String(e?.name || "");
  const msg = String(e?.message || "");
  return (
    /NotAllowed|PermissionDenied|NotFound|DevicesNotFound|NotReadable|TrackStart|Overconstrained|ConstraintNotSatisfied|SecurityError|AbortError/i.test(name) ||
    /invalid constraint|getUserMedia|Requested device not found|Permission denied/i.test(msg)
  );
}

export default function LivePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [demoLeft, setDemoLeft] = useState<string>("");
  const [maxMin, setMaxMin] = useState(MAX_MIN);
  const [status, setStatus] = useState<"idle" | "connecting" | "live" | "saving" | "review" | "error">("idle");
  const [err, setErr] = useState("");
  const [level, setLevel] = useState("B1");
  const [lines, setLines] = useState<Line[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [stopReason, setStopReason] = useState("");
  const [aiTalking, setAiTalking] = useState(false);
  const [userTalking, setUserTalking] = useState(false);
  const [review, setReview] = useState<Review | null>(null);
  const [ttsUrls, setTtsUrls] = useState<Record<number, string>>({});
  const [added, setAdded] = useState<Record<number, boolean>>({});
  const [clipUrls, setClipUrls] = useState<Record<number, string>>({});

  const wsRef = useRef<WebSocket | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const procRef = useRef<ScriptProcessorNode | null>(null);
  const srcRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const playRef = useRef<{ next: number; sources: AudioBufferSourceNode[] }>({ next: 0, sources: [] });
  const linesRef = useRef<Line[]>([]);
  const idxRef = useRef(0);
  const ringRef = useRef<{ chunks: Int16Array[]; len: number }>({ chunks: [], len: 0 });
  const recRef = useRef<{ id: string; chunks: Int16Array[]; len: number } | null>(null);
  const clipsRef = useRef<Map<string, Blob>>(new Map());
  const startRef = useRef(0);
  const lastSpeechRef = useRef(0);
  const respRef = useRef<{ active: string | null; cancelled: Set<string> }>({ active: null, cancelled: new Set() });
  const tickRef = useRef<number | null>(null);
  const stoppingRef = useRef(false);

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (r.status === 401) { window.location.href = "/"; return; }
      const d = await r.json().catch(() => ({}));
      if (d.is_demo) {
        setIsDemo(true);
        const mins = Math.max(1, Math.ceil((d.demo?.seconds_left ?? 0) / 60));
        setMaxMin(Math.min(MAX_MIN, mins || 5));
        setDemoLeft(d.demo ? `남은 체험 ${d.demo.turns_left}회 · ${Math.max(0, Math.ceil(d.demo.seconds_left / 60))}분` : "");
      }
      setAuthed(true);
    }).catch(() => setAuthed(true));
    const l = localStorage.getItem("sm_live_level");
    if (l === "A2" || l === "B1" || l === "B2") setLevel(l);
    return () => { teardown(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function commitLines(next: Line[]) { linesRef.current = next; setLines(next); }
  function upsert(id: string, role: Line["role"], patch: (l: Line) => Line) {
    const cur = linesRef.current;
    const i = cur.findIndex((l) => l.id === id);
    if (i === -1) commitLines([...cur, patch({ id, role, text: "", idx: idxRef.current++, done: false })]);
    else { const c = cur.slice(); c[i] = patch(c[i]); commitLines(c); }
  }

  function stopPlayback() {
    const p = playRef.current;
    for (const s of p.sources) { try { s.stop(); } catch {} }
    p.sources = []; p.next = 0; setAiTalking(false);
  }

  function playPcm(pcm: Int16Array) {
    const ctx = ctxRef.current; if (!ctx || !pcm.length) return;
    const buf = ctx.createBuffer(1, pcm.length, RATE); // browser resamples to ctx rate
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const p = playRef.current;
    const at = Math.max(ctx.currentTime + 0.03, p.next);
    src.start(at); p.next = at + buf.duration; p.sources.push(src); setAiTalking(true);
    src.onended = () => { p.sources = p.sources.filter((s) => s !== src); if (!p.sources.length) setAiTalking(false); };
  }

  function onMic(chunk: Int16Array) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: b64FromInt16(chunk) }));
    const r = ringRef.current;
    r.chunks.push(chunk); r.len += chunk.length;
    while (r.len - (r.chunks[0]?.length ?? 0) > PREROLL) r.len -= r.chunks.shift()!.length;
    const rec = recRef.current;
    if (rec && rec.len < CLIP_MAX) { rec.chunks.push(chunk); rec.len += chunk.length; }
  }

  function handle(e: any) {
    switch (e.type) {
      case "session.updated":
        break;
      case "input_audio_buffer.speech_started": {
        lastSpeechRef.current = Date.now(); setUserTalking(true);
        // barge-in: stop the tutor's audio and cancel the in-flight response
        stopPlayback();
        const rs = respRef.current;
        if (rs.active) { rs.cancelled.add(rs.active); wsRef.current?.send(JSON.stringify({ type: "response.cancel" })); rs.active = null; }
        const r = ringRef.current;
        recRef.current = { id: e.item_id, chunks: r.chunks.slice(), len: r.len };
        upsert(e.item_id, "user", (l) => l);
        break;
      }
      case "input_audio_buffer.speech_stopped": {
        setUserTalking(false); lastSpeechRef.current = Date.now();
        const rec = recRef.current;
        if (rec) { clipsRef.current.set(rec.id, wavFrom(rec.chunks)); recRef.current = null; }
        break;
      }
      case "conversation.item.input_audio_transcription.completed":
        lastSpeechRef.current = Date.now();
        upsert(e.item_id, "user", (l) => ({ ...l, text: String(e.transcript || "").trim(), done: true }));
        break;
      case "response.created":
        respRef.current.active = e.response?.id ?? null; break;
      case "response.output_audio.delta":
      case "response.audio.delta":
        if (e.response_id && respRef.current.cancelled.has(e.response_id)) break;
        playPcm(int16FromB64(e.delta)); break;
      case "response.output_audio_transcript.delta":
      case "response.audio_transcript.delta":
        if (e.response_id && respRef.current.cancelled.has(e.response_id)) break;
        upsert(e.item_id, "assistant", (l) => ({ ...l, text: l.text + (e.delta || "") }));
        break;
      case "response.output_audio_transcript.done":
      case "response.audio_transcript.done":
        upsert(e.item_id, "assistant", (l) => ({ ...l, text: e.transcript || l.text, done: true }));
        break;
      case "response.done":
        if (respRef.current.active === e.response?.id) respRef.current.active = null; break;
      case "error":
        console.warn("[live] server error", e);
        if (!/cancel/i.test(JSON.stringify(e))) setErr(e.error?.message || "서버 오류");
        break;
    }
  }

  async function start() {
    setErr(""); setStopReason(""); setReview(null); setTtsUrls({}); setAdded({}); setClipUrls({});
    commitLines([]); idxRef.current = 0; clipsRef.current = new Map(); stoppingRef.current = false;
    respRef.current = { active: null, cancelled: new Set() };
    setStatus("connecting");
    localStorage.setItem("sm_live_level", level);
    // Create + resume the AudioContext synchronously inside the tap (iOS unlock).
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    ctxRef.current = ctx;
    ctx.resume().catch(() => {});
    try { const b = ctx.createBuffer(1, 1, ctx.sampleRate); const s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch {}
    try {
      // Open the mic first so a constraint/permission failure does not spend
      // a demo live slot on a token that will never be used.
      const stream = await openMic();
      streamRef.current = stream;
      const tokRes = await fetch("/api/live/token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ level }) });
      const tok = await tokRes.json();
      if (!tokRes.ok) throw new Error(tok.error || "토큰 발급 실패");
      const limitMin = typeof tok.max_minutes === "number" && tok.max_minutes > 0 ? tok.max_minutes : MAX_MIN;
      setMaxMin(limitMin);
      if (ctx.state !== "running") await ctx.resume().catch(() => {});

      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const mute = ctx.createGain(); mute.gain.value = 0;
      proc.onaudioprocess = (ev) => onMic(resampleTo(ev.inputBuffer.getChannelData(0), ctx.sampleRate, RATE));
      src.connect(proc); proc.connect(mute); mute.connect(ctx.destination);
      srcRef.current = src; procRef.current = proc;

      const ws = new WebSocket(`wss://api.x.ai/v1/realtime?model=${encodeURIComponent(tok.model)}`, [`xai-client-secret.${tok.token}`]);
      wsRef.current = ws;
      ws.onopen = () => {
        ws.send(JSON.stringify({
          type: "session.update",
          session: {
            voice: tok.voice || "iris",
            instructions: tok.instructions,
            turn_detection: { type: "server_vad" },
            audio: { input: { format: { type: "audio/pcm", rate: RATE } }, output: { format: { type: "audio/pcm", rate: RATE } } },
          },
        }));
        ws.send(JSON.stringify({ type: "response.create" })); // tutor greets first
        startRef.current = Date.now(); lastSpeechRef.current = Date.now();
        setStatus("live");
        tickRef.current = window.setInterval(() => {
          const now = Date.now();
          setElapsed(now - startRef.current);
          if (now - startRef.current >= limitMin * 60_000) stop(`${limitMin}분이 지나 자동 종료했어요`);
          else if (now - lastSpeechRef.current >= SILENCE_MS && playRef.current.sources.length === 0) stop("60초 동안 말이 없어 자동 종료했어요");
        }, 1000);
      };
      ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch {} };
      ws.onerror = () => setErr("연결 오류가 났어요");
      ws.onclose = () => { if (!stoppingRef.current) stop("연결이 끊어졌어요"); };
    } catch (e: any) {
      teardown();
      setErr(isMicError(e) ? micErrorMessage(e) : (e?.message || "시작하지 못했어요"));
      setStatus("error");
    }
  }

  function teardown() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    stoppingRef.current = true;
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
    try { procRef.current?.disconnect(); srcRef.current?.disconnect(); } catch {}
    if (procRef.current) procRef.current.onaudioprocess = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    stopPlayback();
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
  }

  async function stop(reason = "") {
    if (stoppingRef.current) return;
    const minutes = (Date.now() - startRef.current) / 60000;
    const rec = recRef.current;
    if (rec) { clipsRef.current.set(rec.id, wavFrom(rec.chunks)); recRef.current = null; }
    teardown();
    setStopReason(reason);
    const final = linesRef.current.filter((l) => l.text.trim());
    const userLines = final.filter((l) => l.role === "user");
    if (!userLines.length) { setStatus("idle"); if (!reason) setStopReason("저장할 내 발화가 없어요"); return; }
    setStatus("saving");
    const urls: Record<number, string> = {};
    const fd = new FormData();
    fd.append("meta", JSON.stringify({ level, minutes, transcript: final.map((l) => ({ role: l.role, text: l.text, idx: l.idx })) }));
    for (const l of userLines) {
      const clip = clipsRef.current.get(l.id);
      if (clip) { fd.append(`audio_${l.idx}`, clip, `live-${l.idx}.wav`); urls[l.idx] = URL.createObjectURL(clip); }
    }
    setClipUrls(urls);
    try {
      const r = await fetch("/api/live/finish", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "저장 실패");
      setReview(j); setStatus("review");
      prefetchTts(j.items);
    } catch (e: any) {
      setErr(e?.message || "교정을 불러오지 못했어요"); setStatus("error");
    }
  }

  async function sayUrl(text: string): Promise<string> {
    const r = await fetch("/api/live/say", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
    const j = await r.json(); return j.url || "";
  }
  async function prefetchTts(items: ReviewItem[]) {
    for (const it of items.slice(0, 15)) {
      try { const u = await sayUrl(it.corrected); if (u) setTtsUrls((m) => ({ ...m, [it.idx]: u })); } catch {}
    }
  }
  async function playCorrected(it: ReviewItem) {
    let u = ttsUrls[it.idx];
    const a = new Audio(); // created inside the tap so iOS allows play()
    if (!u) { u = await sayUrl(it.corrected); setTtsUrls((m) => ({ ...m, [it.idx]: u })); }
    if (u) { a.src = u; a.play().catch(() => {}); }
    else if ("speechSynthesis" in window) { const s = new SpeechSynthesisUtterance(it.corrected); s.lang = "en-US"; speechSynthesis.speak(s); }
  }
  function playMine(it: ReviewItem) {
    const u = clipUrls[it.idx] || it.my_audio; if (!u) return;
    new Audio(u).play().catch(() => {});
  }
  async function addToDeck(it: ReviewItem) {
    const r = await fetch("/api/live/phrase", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ phrase: it.corrected, ko_note: it.coach_note_ko, source_turn_id: it.turn_id }) });
    if (r.ok) setAdded((m) => ({ ...m, [it.idx]: true }));
  }

  const mins = elapsed / 60000;
  const mm = Math.floor(elapsed / 60000), ss = Math.floor((elapsed % 60000) / 1000);

  if (authed === null) return <main className="page"><p className="faint">불러오는 중…</p></main>;

  return (
    <main className="page">
      <a href="/" className="faint" style={{ textDecoration: "none" }}>← 홈</a>
      <h1 className="title">⚡ 실시간 대화</h1>
      <p className="subtitle">Grok과 바로 말로 대화해요. 막히면 한국어로 &ldquo;이거 영어로 뭐라고 해?&rdquo; 하고 물어보세요. 교정은 대화가 끝난 뒤에 한 번에 보여 드려요.</p>
      <TabNav />
      {isDemo && (
        <p className="chip amber" style={{ margin: "0 0 10px" }}>
          데모 체험 중{demoLeft ? ` · ${demoLeft}` : ""} · 실시간 대화는 남은 시간만큼만 이용할 수 있어요.
        </p>
      )}

      {(status === "idle" || status === "error") && (
        <section className="card">
          <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
            {["A2", "B1", "B2"].map((l) => (
              <button key={l} className={`btn small ${level === l ? "" : "secondary"}`} onClick={() => setLevel(l)}>{l}</button>
            ))}
          </div>
          <button className="btn blue" style={{ width: "100%", fontSize: 18, padding: "16px" }} onClick={start}>🎙️ 대화 시작</button>
          <p className="faint" style={{ marginTop: 10, fontSize: 12.5 }}>
            최대 {maxMin}분 · 60초 동안 말이 없으면 자동 종료 · 스피커 소리가 마이크로 들어가면 대화가 끊길 수 있어 이어폰을 권장해요.
          </p>
          {stopReason && <p className="faint">{stopReason}</p>}
          {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
        </section>
      )}

      {(status === "connecting" || status === "live") && (
        <section className="card" style={{ textAlign: "center" }}>
          <div style={{ fontSize: 30, fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>{mm}:{String(ss).padStart(2, "0")}</div>
          <div className="faint">{maxMin}분 후 자동 종료</div>
          <div style={{ margin: "10px 0", fontWeight: 700, color: userTalking ? "var(--green)" : aiTalking ? "var(--blue)" : "var(--muted)" }}>
            {status === "connecting" ? "연결 중…" : userTalking ? "🎤 듣고 있어요" : aiTalking ? "🔊 Iris가 말하는 중 (말하면 끊을 수 있어요)" : "말해 보세요"}
          </div>
          <button className="btn red" style={{ width: "100%", fontSize: 18, padding: "16px" }} onClick={() => stop("")}>⏹ 대화 끝내고 교정 받기</button>
          {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
        </section>
      )}

      {(status === "connecting" || status === "live" || status === "saving") && lines.length > 0 && (
        <section className="card">
          {lines.map((l) => (
            <div key={l.id} style={{ display: "flex", justifyContent: l.role === "user" ? "flex-end" : "flex-start", margin: "6px 0" }}>
              <div className="en" style={{
                maxWidth: "85%", padding: "8px 12px", borderRadius: 12, fontSize: 15.5,
                background: l.role === "user" ? "var(--blue-soft)" : "var(--bg)", border: "1px solid var(--line)",
              }}>{l.text || (l.role === "user" ? "…" : "")}</div>
            </div>
          ))}
        </section>
      )}

      {status === "saving" && <section className="card"><b>교정 중이에요…</b><p className="faint">내 영어 문장을 모아서 한 번에 고치고 점수를 매기고 있어요.</p></section>}

      {status === "review" && review && (
        <>
          <section className="card">
            <b>대화 리뷰</b>
            <p className="faint" style={{ margin: "6px 0 0" }}>
              영어 문장 {review.items.length}개를 교정했어요{review.skipped_korean > 0 ? ` (한국어/짧은 말 ${review.skipped_korean}개는 제외)` : ""}.
              {review.phrases_added > 0 ? ` 표현 ${review.phrases_added}개를 복습 덱에 넣었어요.` : ""} 기록에도 저장됐어요.
            </p>
            <p className="faint" style={{ margin: "8px 0 0", fontSize: 12 }}>
              발음 안내: 음성을 분석해 점수를 매기지 않아요. ▶ 내 녹음과 ▶ 교정 문장을 번갈아 들으며 비교해 보세요. 🗣 표시는 음성 인식 결과가 엉뚱하게 나온 단어로 추정한 팁이에요.
            </p>
            {stopReason && <p className="faint" style={{ fontSize: 12 }}>{stopReason}</p>}
          </section>
          {review.items.length === 0 && <section className="card"><p>교정할 영어 문장이 없었어요. 다음엔 영어로 더 말해 봐요!</p></section>}
          {review.items.map((it) => (
            <section key={it.idx} className="card">
              <div className="en" style={{ fontSize: 15.5, color: "var(--ink-soft)" }}>{highlight(it.transcript, it.errors.map((e) => e.span))}</div>
              {it.ok ? (
                <div style={{ color: "var(--green)", fontWeight: 700, marginTop: 6 }}>✅ 자연스러워요</div>
              ) : (
                <div className="en" style={{ fontSize: 17, fontWeight: 700, marginTop: 6 }}>→ {it.corrected}</div>
              )}
              {it.errors.map((e, i) => (
                <div key={i} className="faint" style={{ fontSize: 13, marginTop: 4 }}>
                  <s>{e.span}</s> → <b>{e.fix}</b> <span style={{ opacity: 0.7 }}>({e.type})</span>
                </div>
              ))}
              {it.coach_note_ko && <p style={{ margin: "8px 0 0", fontSize: 14 }}>💬 {it.coach_note_ko}</p>}
              {it.pronunciation_tip && (
                <p style={{ margin: "6px 0 0", fontSize: 13.5 }}>🗣 <b className="en">{it.pronunciation_tip.focus_word}</b> — {it.pronunciation_tip.note} <span className="faint">(인식 결과 기반 추정)</span></p>
              )}
              {it.score != null && <div className="faint" style={{ fontSize: 12, marginTop: 4 }}>문장 점수 {it.score}/5</div>}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
                <button className="btn small blue" onClick={() => playCorrected(it)}>▶ {it.ok ? "원어민 발음" : "교정 문장"} 듣기</button>
                {(clipUrls[it.idx] || it.my_audio) && <button className="btn small secondary" onClick={() => playMine(it)}>▶ 내 녹음</button>}
                <button className="btn small secondary" disabled={added[it.idx]} onClick={() => addToDeck(it)}>{added[it.idx] ? "✅ 덱에 추가됨" : "+ 복습 덱에 추가"}</button>
              </div>
              {it.phrases.length > 0 && (
                <div className="faint" style={{ fontSize: 12.5, marginTop: 8 }}>
                  덱에 넣은 표현: {it.phrases.map((p) => <span key={p.phrase} className="en"> “{p.phrase}”</span>)}
                </div>
              )}
            </section>
          ))}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn blue" style={{ flex: 1 }} onClick={() => { setStatus("idle"); setReview(null); }}>⚡ 다시 대화하기</button>
            <a href="/review" className="btn secondary" style={{ flex: 1, textDecoration: "none", textAlign: "center" }}>복습하러 가기</a>
          </div>
        </>
      )}
    </main>
  );
}
