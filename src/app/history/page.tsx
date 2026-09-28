"use client";

import { useEffect, useState } from "react";

let currentAudio: HTMLAudioElement | null = null;
function playUrl(url: string) {
  if (currentAudio) currentAudio.pause();
  currentAudio = new Audio(url);
  currentAudio.play().catch(() => {});
}

type Turn = {
  id: string;
  transcript: string;
  corrected: string | null;
  reply_en: string | null;
  coach_note_ko: string | null;
  target_phrase: string | null;
  audio_path: string | null;
  reply_audio_path: string | null;
  jev_score: number | null;
  errors: { span: string; type: string; fix: string }[];
};

type Session = {
  id: string;
  topic: string;
  level: string;
  created_at: string;
  turn_count: number;
};

export default function HistoryPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [detail, setDetail] = useState<{ session: Session; turns: Turn[] } | null>(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);


  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => setSessions(d.sessions || []))
      .catch(() => setError("목록을 불러오지 못했습니다."));
  }, []);

  async function open(id: string) {
    const r = await fetch(`/api/sessions/${id}`);
    const d = await r.json();
    if (r.ok) setDetail(d);
    else setError(d.error || "불러오기 실패");
  }


  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setMe(r.ok ? { username: "" } : null))
      .catch(() => setMe(null))
      .finally(() => setAuthChecked(true));
  }, []);

  return (
    <main className="page">
      <h1 className="title">지난 세션</h1>
      <p className="subtitle">녹음과 교정이 남은 대화 기록</p>

      <nav className="nav">
        <a href="/"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg><span>대화</span></a>
        <a href="/review"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3-5 3V4z"/></svg><span>복습</span></a>
        <a href="/stats"><svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><span>통계</span></a>
        <a href="/diary"><svg viewBox="0 0 24 24"><path d="M12 21c-4-3-7-5-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-3 6-7 9z"/></svg><span>일기</span></a>
        <a href="/podcast"><svg viewBox="0 0 24 24"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v7H4zM17 14h3v7h-3z"/></svg><span>팟캐스트</span></a>
        <a href="/history" className="on"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3"/></svg><span>기록</span></a>
      </nav>

      {authChecked && !me && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🔒</p>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>로그인이 필요합니다</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      )}
      {me && error && <p style={{ color: "var(--red)" }}>{error}</p>}

      {!detail && (
        <>
          {sessions.map((s) => (
            <div key={s.id} className="card" style={{ padding: 0, overflow: "hidden" }}>
              <button onClick={() => open(s.id)} style={{ all: "unset", cursor: "pointer", width: "100%", padding: "16px 18px", boxSizing: "border-box" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ fontSize: 16 }}>{s.topic} · {s.level}</b>
                  <span className="chip">{s.turn_count}턴</span>
                </div>
                <div className="faint" style={{ marginTop: 4 }}>
                  {new Date(s.created_at).toLocaleString("ko-KR")}
                </div>
              </button>
            </div>
          ))}
          {sessions.length === 0 && <p className="muted">아직 완료한 세션이 없습니다.</p>}
        </>
      )}

      {detail && (
        <section>
          <button onClick={() => setDetail(null)} className="btn secondary small">← 목록으로</button>
          <h2 style={{ fontSize: 20, margin: "14px 0 4px" }}>{detail.session.topic} · {detail.session.level}</h2>
          {detail.turns.map((t, i) => (
            <div key={t.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="faint" style={{ fontWeight: 600 }}>Turn {i + 1} — You said</div>
                <div style={{ display: "flex", gap: 6 }}>
                  {t.audio_path && (
                    <button className="btn secondary small" onClick={() => playUrl(t.audio_path!)}>
                      내 발음
                    </button>
                  )}
                  {t.reply_audio_path && (
                    <button className="btn secondary small" onClick={() => playUrl(t.reply_audio_path!)}>
                      튜터
                    </button>
                  )}
                  {typeof t.jev_score === "number" && <span className="chip" style={{ fontSize: 12 }}>{t.jev_score}/5</span>}
                </div>
              </div>
              <p style={{ margin: "3px 0", fontSize: 16 }}>{t.transcript}</p>
              {t.errors?.length > 0 && (
                <p style={{ margin: "6px 0", color: "var(--green)", fontSize: 15 }}>
                  {t.errors[0].span} → <b>{t.errors[0].fix}</b> ({t.errors[0].type})
                </p>
              )}
              {t.coach_note_ko && <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--muted)" }}>{t.coach_note_ko}</p>}
              {t.reply_en && <p style={{ margin: "6px 0 0", color: "var(--blue)", fontSize: 14 }}>{t.reply_en}</p>}
              {t.target_phrase && <p style={{ margin: "6px 0 0", fontSize: 13, color: "#b45309" }}>{t.target_phrase}</p>}
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
