"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Line = { transcript: string; corrected: string | null; score: number | null; audio: string };

const STYLES = {
  lofi: { bpm: 88, label: "🎧 로파이" },
  dance: { bpm: 124, label: "🕺 댄스" },
  ballad: { bpm: 74, label: "🌙 발라드" },
} as const;
type StyleKey = keyof typeof STYLES;

// ---- synth helpers (no audio assets — the beat is generated) ----

function kick(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.setValueAtTime(150, t);
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + 0.25);
}

function snare(ctx: BaseAudioContext, dest: AudioNode, t: number) {
  const len = 0.16;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1800; bp.Q.value = 0.8;
  const g = ctx.createGain(); g.gain.value = 0.5;
  src.connect(bp); bp.connect(g); g.connect(dest);
  src.start(t);
}

function hat(ctx: BaseAudioContext, dest: AudioNode, t: number, quiet = false) {
  const len = 0.05;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * len), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 8000;
  const g = ctx.createGain(); g.gain.value = quiet ? 0.12 : 0.22;
  src.connect(hp); hp.connect(g); g.connect(dest);
  src.start(t);
}

const CHORD_ROOTS = [45, 41, 48, 43]; // A2 F2 C3 G2
function bassNote(ctx: BaseAudioContext, dest: AudioNode, t: number, midi: number, len: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "triangle";
  o.frequency.value = 440 * Math.pow(2, (midi - 69) / 12);
  g.gain.setValueAtTime(0.32, t);
  g.gain.exponentialRampToValueAtTime(0.01, t + len);
  o.connect(g); g.connect(dest);
  o.start(t); o.stop(t + len + 0.05);
}

function pad(ctx: BaseAudioContext, dest: AudioNode, t: number, midi: number, len: number) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.07, t + 0.4);
  g.gain.linearRampToValueAtTime(0, t + len);
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 1200;
  g.connect(lp); lp.connect(dest);
  [0, 4, 7].forEach((iv) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = 440 * Math.pow(2, (midi + iv - 69) / 12);
    o.detune.value = iv === 0 ? -4 : 4;
    o.connect(g);
    o.start(t); o.stop(t + len + 0.05);
  });
}

// One bar of drums+bass for the given style, starting at t.
function bar(ctx: BaseAudioContext, dest: AudioNode, t: number, beat: number, style: StyleKey, barIndex: number) {
  const root = CHORD_ROOTS[barIndex % CHORD_ROOTS.length];
  if (style === "dance") {
    for (let b = 0; b < 4; b++) kick(ctx, dest, t + b * beat);
    hat(ctx, dest, t + beat * 0.5); hat(ctx, dest, t + beat * 1.5);
    hat(ctx, dest, t + beat * 2.5); hat(ctx, dest, t + beat * 3.5);
    bassNote(ctx, dest, t + beat, root, beat * 0.8);
    bassNote(ctx, dest, t + beat * 3, root + 12, beat * 0.8);
  } else if (style === "lofi") {
    kick(ctx, dest, t); kick(ctx, dest, t + beat * 2);
    snare(ctx, dest, t + beat); snare(ctx, dest, t + beat * 3);
    hat(ctx, dest, t + beat * 0.5, true); hat(ctx, dest, t + beat * 2.5, true);
    bassNote(ctx, dest, t, root - 12, beat * 3.6);
  } else {
    kick(ctx, dest, t);
    snare(ctx, dest, t + beat * 2);
    pad(ctx, dest, t, root + 12, beat * 4);
    bassNote(ctx, dest, t, root - 12, beat * 3.5);
  }
}

function scheduleBeatRange(ctx: BaseAudioContext, dest: AudioNode, from: number, dur: number, bpm: number, style: StyleKey) {
  const beat = 60 / bpm;
  let pos = 0;
  let bi = 0;
  while (pos < dur - 1e-3) {
    bar(ctx, dest, from + pos, beat, style, bi++);
    pos += beat * 4;
  }
}

// Total song length: 2 intro bars + each clip rounded up to whole bars + 1 outro bar.
function songLength(clips: AudioBuffer[], bpm: number): number {
  const bar = (60 / bpm) * 4;
  let bars = 2;
  for (const c of clips) bars += Math.max(1, Math.ceil((c.duration + 0.2) / bar));
  return (bars + 1) * bar;
}

// Places voice clips and the backing beat; works for live AND offline render.
function scheduleSong(ctx: BaseAudioContext, clips: AudioBuffer[], bpm: number, style: StyleKey, startAt: number): { endTime: number; slots: number[][] } {
  const beat = 60 / bpm;
  const bar = beat * 4;
  let t = startAt;
  const slots: number[][] = [];
  scheduleBeatRange(ctx, ctx.destination, t, bar * 2, bpm, style);
  t += bar * 2;
  for (const clip of clips) {
    const bars = Math.max(1, Math.ceil((clip.duration + 0.2) / bar));
    slots.push([t, t + bars * bar]);
    const src = ctx.createBufferSource();
    src.buffer = clip;
    const g = ctx.createGain(); g.gain.value = 1.0;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = style === "lofi" ? 7000 : 13000;
    src.connect(g); g.connect(lp); lp.connect(ctx.destination);
    src.start(t);
    scheduleBeatRange(ctx, ctx.destination, t, bars * bar, bpm, style);
    t += bars * bar;
  }
  scheduleBeatRange(ctx, ctx.destination, t, bar, bpm, style);
  return { endTime: t + bar, slots };
}

function toWav(buffer: AudioBuffer): Blob {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (off: number, str: string) => { for (let i = 0; i < str.length; i++) data.setUint8(off + i, str.charCodeAt(i)); };
  w(0, "RIFF"); data.setUint32(4, 36 + len * ch * 2, true); w(8, "WAVEfmt ");
  data.setUint32(16, 16, true); data.setUint16(20, 1, true); data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true); data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true); data.setUint16(34, 16, true); w(36, "data");
  data.setUint32(40, len * ch * 2, true);
  let off = 44;
  const chans = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([data.buffer], { type: "audio/wav" });
}

// ---- component ----

export default function RemixCard() {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [style, setStyle] = useState<StyleKey>("lofi");
  const [status, setStatus] = useState<"idle" | "loading" | "playing" | "error">("idle");
  const [nowLine, setNowLine] = useState(-1);
  const [wav, setWav] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const slotsRef = useRef<number[][]>([]);

  useEffect(() => {
    if (!open || lines) return;
    fetch("/api/remix")
      .then((r) => r.json())
      .then((d) => setLines(d.lines || []))
      .catch(() => setStatus("error"));
  }, [open, lines]);

  const stop = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    setStatus("idle");
    setNowLine(-1);
  }, []);

  useEffect(() => () => stop(), [stop]);

  async function loadClips(list: Line[], ctx: BaseAudioContext): Promise<AudioBuffer[]> {
    const buffers: AudioBuffer[] = [];
    for (const l of list) {
      const res = await fetch(l.audio);
      const arr = await res.arrayBuffer();
      buffers.push(await ctx.decodeAudioData(arr));
    }
    return buffers;
  }

  function play() {
    if (!lines || lines.length === 0) return;
    stop();
    const ctx = new AudioContext();
    ctxRef.current = ctx;
    setStatus("loading");
    loadClips(lines, ctx)
      .then((clips) => {
        const startAt = ctx.currentTime + 0.15;
        const { endTime, slots } = scheduleSong(ctx, clips, STYLES[style].bpm, style, startAt);
        slotsRef.current = slots;
        timerRef.current = setInterval(() => {
          const now = ctx.currentTime;
          const idx = slotsRef.current.findIndex(([s, e]) => now >= s && now < e);
          setNowLine(idx);
        }, 120);
        setNowLine(-1);
        setStatus("playing");
        // 곡이 끝나면 자동 정지
        const waitMs = Math.max(0, (endTime - ctx.currentTime) * 1000) + 300;
        setTimeout(() => {
          if (ctxRef.current === ctx) stop();
        }, waitMs);
      })
      .catch(() => {
        setStatus("error");
      });
  }

  async function download() {
    if (!lines || lines.length === 0) return;
    setRendering(true);
    try {
      const ctx = new OfflineAudioContext(2, 44100, 44100);
      const clips = await loadClips(lines, ctx);
      const bpm = STYLES[style].bpm;
      const len = songLength(clips, bpm);
      const off = new OfflineAudioContext(2, Math.ceil(len * 44100), 44100);
      scheduleSong(off, clips, bpm, style, 0);
      const rendered = await off.startRendering();
      const blob = toWav(rendered);
      const url = URL.createObjectURL(blob);
      setWav(url);
    } catch {
      setWav(null);
    } finally {
      setRendering(false);
    }
  }

  const bpm = STYLES[style].bpm;

  return (
    <section className="card" style={{ borderColor: "var(--purple)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b style={{ fontSize: 15 }}>🎵 리듬 복습 — 내 목소리 리믹스</b>
        <button className="btn secondary small" onClick={() => setOpen(!open)}>
          {open ? "접기" : "열기"}
        </button>
      </div>
      {!open && <p className="faint" style={{ margin: "6px 0 0" }}>저장된 내 녹음으로 비트에 맞춘 노래를 만들어 듣고, WAV로 저장할 수 있어요.</p>}

      {open && (
        <>
          <p className="faint" style={{ margin: "8px 0" }}>
            내가 말한 문장들이 비트에 올라갑니다. 들으면서 따라 불러보세요 🎤
          </p>
          <div className="segmented" style={{ marginBottom: 10 }}>
            {(Object.keys(STYLES) as StyleKey[]).map((k) => (
              <button key={k} className={style === k ? "on" : ""} onClick={() => { if (status !== "playing") setStyle(k); }}>
                {STYLES[k].label}
              </button>
            ))}
          </div>
          {status === "error" && <p style={{ color: "var(--red)", fontSize: 13 }}>불러오기에 실패했어요.</p>}
          {lines && lines.length === 0 && <p className="muted" style={{ fontSize: 14 }}>음성 녹음이 있는 대화를 먼저 해 주세요.</p>}
          {lines && lines.length > 0 && (
            <>
              {status !== "playing" ? (
                <button className="btn" style={{ width: "100%" }} onClick={play}>
                  ▶️ 리믹스 재생 ({lines.length}문장 · {bpm} BPM)
                </button>
              ) : (
                <button className="btn red" style={{ width: "100%" }} onClick={stop}>
                  ⏹️ 정지
                </button>
              )}
              {status === "loading" && <p className="faint" style={{ marginTop: 6 }}>오디오 불러오는 중...</p>}
              {nowLine >= 0 && lines[nowLine] && (
                <div className="card pop" style={{ margin: "10px 0 0", background: "var(--blue-soft)", borderColor: "var(--blue)" }}>
                  <div style={{ fontSize: 16, fontWeight: 700 }}>🎤 {lines[nowLine].transcript}</div>
                  {lines[nowLine].corrected && (
                    <div style={{ fontSize: 14, color: "var(--green-dark)", marginTop: 2 }}>✓ {lines[nowLine].corrected}</div>
                  )}
                </div>
              )}
              {status === "playing" && (
                <button className="btn secondary small" style={{ width: "100%", marginTop: 8 }} disabled={rendering} onClick={download}>
                  {rendering ? "렌더링 중..." : "💾 WAV 파일로 저장"}
                </button>
              )}
              {rendering && <p className="faint" style={{ marginTop: 4 }}>곡을 만들고 있어요... (몇 초 걸려요)</p>}
              {wav && (
                <a className="btn green" style={{ width: "100%", marginTop: 8, textDecoration: "none" }} href={wav} download="speakmentor-remix.wav">
                  ⬇️ 저장된 곡 다운로드
                </a>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
