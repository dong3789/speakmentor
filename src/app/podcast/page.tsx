"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Episode = {
  id: string;
  title: string;
  topic: string;
  level: string;
  status: "generating" | "ready" | "error";
  progress: number;
  duration: number;
  audio: string | null;
  created_at: string;
};

type Line = { en: string; ko: string; offset: number; dur: number };

const LEVELS = ["A1", "A2", "B1", "B2"];
const TOPICS = ["daily life", "food", "work", "travel", "weather", "hobbies"];
const LENGTHS = [
  { minutes: 3, label: "3분 (약 18문장)" },
  { minutes: 5, label: "5분 (약 30문장)" },
  { minutes: 8, label: "8분 (약 48문장)" },
];

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function PodcastPage() {
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [topic, setTopic] = useState("daily life");
  const [customTopic, setCustomTopic] = useState("");
  const [level, setLevel] = useState("A2");
  const [minutes, setMinutes] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [detail, setDetail] = useState<{ episode: Episode; lines: Line[] } | null>(null);
  const [showKo, setShowKo] = useState(true);
  const [rate, setRate] = useState(1);
  const [nowLine, setNowLine] = useState(-1);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const scriptRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/podcast").then((r) => r.json()).catch(() => null);
    if (d?.episodes) setEpisodes(d.episodes);
    return d?.episodes ?? [];
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? setMe({ username: "" }) : null))
      .catch(() => setMe(null))
      .finally(() => setAuthChecked(true));
    load();
  }, [load]);

  // generating 중이면 3초마다 폴링
  useEffect(() => {
    const generating = episodes.some((e) => e.status === "generating");
    if (!generating) return;
    const t = setInterval(async () => {
      const list = await load();
      const gen = list.find((e: Episode) => e.status === "generating");
      if (!gen) {
        const ready = list.find((e: Episode) => e.status === "ready");
        if (ready && detail?.episode.id === ready.id) openEpisode(ready.id);
      }
    }, 3000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [episodes]);

  async function createEpisode() {
    setBusy(true);
    setError("");
    try {
      const t = customTopic.trim() || topic;
      const res = await fetch("/api/podcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: t, level, minutes }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(d.error || "생성 실패");
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function openEpisode(id: string) {
    const d = await fetch(`/api/podcast/${id}`).then((r) => r.json()).catch(() => null);
    if (d?.episode && d.episode.status === "ready") {
      setDetail({ episode: d.episode, lines: d.episode.lines });
      setNowLine(-1);
      load();
    }
  }

  async function removeEpisode(id: string) {
    await fetch(`/api/podcast/${id}`, { method: "DELETE" });
    if (detail?.episode.id === id) setDetail(null);
    load();
  }

  function onTimeUpdate() {
    const a = audioRef.current;
    if (!a || !detail) return;
    const t = a.currentTime;
    let idx = -1;
    detail.lines.forEach((l, i) => {
      if (t >= l.offset - 0.05 && t < l.offset + l.dur) idx = i;
    });
    setNowLine(idx);
    if (idx >= 0 && scriptRef.current) {
      const el = scriptRef.current.children[idx] as HTMLElement | undefined;
      if (el && el.dataset.scrolled !== "1") {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.dataset.scrolled = "1";
        window.setTimeout(() => { if (el) el.dataset.scrolled = ""; }, 8000);
      }
    }
  }

  function applyRate(r: number) {
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  }

  return (
    <main className="page">
      <h1 className="title">팟캐스트</h1>
      <p className="subtitle">쉬운 영어로 계속 들려주는 리스닝 — 일하면서 귀를 트세요</p>

      <nav className="nav">
        <a href="/"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg><span>대화</span></a>
        <a href="/review"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3-5 3V4z"/></svg><span>복습</span></a>
        <a href="/stats"><svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><span>통계</span></a>
        <a href="/podcast" className="on"><svg viewBox="0 0 24 24"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v7H4zM17 14h3v7h-3z"/></svg><span>팟캐스트</span></a>
        <a href="/history"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3"/></svg><span>기록</span></a>
      </nav>

      {authChecked && !me && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>로그인이 필요합니다</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      )}

      {me && (
        <>
          <section className="card">
            <div className="kicker" style={{ marginTop: 0 }}>NEW EPISODE</div>
            <div className="segmented" style={{ marginBottom: 10 }}>
              {TOPICS.map((t) => (
                <button key={t} className={!customTopic.trim() && topic === t ? "on" : ""} onClick={() => { setTopic(t); setCustomTopic(""); }}>
                  {t}
                </button>
              ))}
            </div>
            <input
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              placeholder="또는 자유 주제 직접 입력 (예: my cat)"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 14, margin: "8px 0" }}
            />
            <div className="segmented" style={{ marginBottom: 10 }}>
              {LEVELS.map((lv) => (
                <button key={lv} className={level === lv ? "on" : ""} onClick={() => setLevel(lv)}>{lv}</button>
              ))}
            </div>
            <div className="segmented" style={{ marginBottom: 12 }}>
              {LENGTHS.map((l) => (
                <button key={l.minutes} className={minutes === l.minutes ? "on" : ""} onClick={() => setMinutes(l.minutes)}>{l.label}</button>
              ))}
            </div>
            <button className="btn" style={{ width: "100%" }} disabled={busy} onClick={createEpisode}>
              {busy ? "생성 중..." : "에피소드 만들기"}
            </button>
            <p className="faint" style={{ marginTop: 8 }}>
              스크립트 작성 → 문장별 음성 생성 → 하나의 mp3로 합칩니다. 1~2분 걸려요.
            </p>
            {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
          </section>

          {episodes.some((e) => e.status === "generating") && (
            <section className="card">
              {episodes.filter((e) => e.status === "generating").map((e) => (
                <div key={e.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
                    <b>{e.title}</b><span className="faint">{Math.round(e.progress * 100)}%</span>
                  </div>
                  <div className="progressbar"><div style={{ width: `${e.progress * 100}%` }} /></div>
                </div>
              ))}
            </section>
          )}

          <div className="kicker">LISTEN</div>
          {episodes.filter((e) => e.status !== "generating").map((e) => (
            <div key={e.id} className="card" style={{ padding: "14px 18px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                <button
                  style={{ all: "unset", cursor: "pointer" }}
                  onClick={() => e.status === "ready" && openEpisode(e.id)}
                >
                  <b style={{ fontSize: 15 }}>{e.title}</b>
                  <div className="faint">{e.topic} · {e.level} · {e.duration ? fmt(e.duration) : ""} · {new Date(e.created_at).toLocaleDateString("ko-KR")}</div>
                </button>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {e.status === "error" && <span className="chip amber">실패</span>}
                  {e.audio && (
                    <button className="btn secondary small" onClick={() => removeEpisode(e.id)}>삭제</button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {episodes.filter((e) => e.status !== "generating").length === 0 && (
            <p className="muted" style={{ fontSize: 14 }}>아직 에피소드가 없습니다. 위에서 첫 에피소드를 만들어 보세요.</p>
          )}

          {detail && (
            <section className="card" style={{ marginTop: 16 }}>
              <div className="kicker" style={{ marginTop: 0 }}>NOW PLAYING — {detail.episode.title}</div>
              <audio
                ref={audioRef}
                controls
                autoPlay
                src={detail.episode.audio ?? undefined}
                onTimeUpdate={onTimeUpdate}
                style={{ width: "100%", marginBottom: 10 }}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                {[0.75, 1, 1.25].map((r) => (
                  <button key={r} className={`btn small ${rate === r ? "" : "secondary"}`} onClick={() => applyRate(r)}>{r}x</button>
                ))}
                <button
                  className="btn small secondary"
                  onClick={() => setShowKo(!showKo)}
                >
                  {showKo ? "한국어 번역 끄기 (귀트 모드)" : "한국어 번역 켜기"}
                </button>
              </div>
              <div ref={scriptRef} style={{ maxHeight: 420, overflowY: "auto", paddingRight: 4 }}>
                {detail.lines.map((l, i) => (
                  <div
                    key={i}
                    onClick={() => { if (audioRef.current) { audioRef.current.currentTime = l.offset + 0.01; audioRef.current.play(); } }}
                    style={{
                      padding: "9px 12px",
                      margin: "4px 0",
                      borderRadius: 10,
                      cursor: "pointer",
                      background: nowLine === i ? "var(--blue-soft)" : "transparent",
                      border: nowLine === i ? "1.5px solid var(--blue)" : "1.5px solid transparent",
                    }}
                  >
                    <div className="en" style={{ fontSize: nowLine === i ? 17 : 15.5, fontWeight: nowLine === i ? 700 : 500, lineHeight: 1.4 }}>{l.en}</div>
                    {showKo && <div className="muted" style={{ fontSize: 13.5, marginTop: 2 }}>{l.ko}</div>}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </main>
  );
}
