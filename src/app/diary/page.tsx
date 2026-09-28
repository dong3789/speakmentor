"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RemixCard from "@/components/RemixCard";

type Entry = {
  id: string;
  date: string;
  text: string;
  corrected: string | null;
  ko: string | null;
  audio_path: string | null;
  created_at: string;
};

function pickMime(): string {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

export default function DiaryPage() {
  const [me, setMe] = useState<boolean | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [showKo, setShowKo] = useState<Record<string, boolean>>({});
  const [showFixed, setShowFixed] = useState<Record<string, boolean>>({});
  const [micOk, setMicOk] = useState(true);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = useCallback(async () => {
    const d = await fetch("/api/diary").then((r) => r.json()).catch(() => null);
    if (d?.entries) setEntries(d.entries);
  }, []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setMe(r.ok))
      .catch(() => setMe(false))
      .finally(() => setAuthChecked(true));
    if (me) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (me) load();
  }, [me, load]);

  async function submitAudio(blob: Blob) {
    setSaving(true);
    setStatus("받아쓰기 · 번역 · 교정 중...");
    try {
      const form = new FormData();
      form.append("audio", blob, "diary.audio");
      const res = await fetch("/api/diary", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(d.error || "저장 실패");
        return;
      }
      setStatus("일기 저장 완료");
      setTyped("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function submitTyped() {
    if (!typed.trim()) return;
    setSaving(true);
    setStatus("번역 · 교정 중...");
    try {
      const form = new FormData();
      form.append("text", typed.trim());
      const res = await fetch("/api/diary", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(d.error || "저장 실패");
        return;
      }
      setTyped("");
      setStatus("일기 저장 완료");
      setTyped("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  function startRecording() {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        setMicOk(true);
        const mime = pickMime();
        const rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
        chunksRef.current = [];
        rec.ondataavailable = (e) => chunksRef.current.push(e.data);
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
          await submitAudio(blob);
        };
        mediaRef.current = rec;
        rec.start();
        setRecording(true);
      })
      .catch(() => setMicOk(false));
  }

  function stopRecording() {
    setRecording(false);
    mediaRef.current?.stop();
  }

  function play(url: string) {
    if (audioRef.current) audioRef.current.pause();
    audioRef.current = new Audio(url);
    audioRef.current.play().catch(() => {});
  }

  async function removeEntry(id: string) {
    await fetch(`/api/diary/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <main className="page">
      <h1 className="title">영어 일기</h1>
      <p className="subtitle">말하면 받아써져서 일기가 되고, 내 목소리는 저장돼요</p>

      <nav className="nav">
        <a href="/"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg><span>대화</span></a>
        <a href="/review"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3-5 3V4z"/></svg><span>복습</span></a>
        <a href="/diary" className="on"><svg viewBox="0 0 24 24"><path d="M12 21c-4-3-7-5-7-9a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 4-3 6-7 9z"/></svg><span>일기</span></a>
        <a href="/podcast"><svg viewBox="0 0 24 24"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v7H4zM17 14h3v7h-3z"/></svg><span>팟캐스트</span></a>
        <a href="/stats"><svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><span>통계</span></a>
        <a href="/history"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3"/></svg><span>기록</span></a>
      </nav>

      {!authChecked && <p className="muted">확인 중...</p>}

      {authChecked && !me && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>로그인이 필요합니다</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      )}

      {me && (
        <>
          <section className="card">
            <div className="kicker" style={{ marginTop: 0 }}>NEW ENTRY</div>
            {micOk ? (
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                {!recording ? (
                  <button className="btn blue" onClick={startRecording} disabled={saving}>말하기</button>
                ) : (
                  <button className="btn red" onClick={stopRecording}>저장하고 끝내기</button>
                )}
                <span className="muted" style={{ fontSize: 14 }}>
                  {recording ? "오늘 하루를 영어로 말해요" : saving ? "일기로 만드는 중..." : "탭하고 오늘 하루를 영어로"}
                </span>
              </div>
            ) : (
              <p style={{ color: "var(--red)", fontSize: 13 }}>마이크를 사용할 수 없어요. 아래에 직접 써 주세요.</p>
            )}
            <textarea
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="또는 여기에 영어로 쓰기"
              rows={3}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 15, marginTop: 10, fontFamily: "var(--serif)" }}
            />
            <button className="btn secondary small" style={{ width: "100%", marginTop: 8 }} disabled={!typed.trim() || saving} onClick={submitTyped}>
              {saving ? "저장 중..." : "텍스트로 저장"}
            </button>
            {status && <p className="faint" style={{ marginTop: 8 }}>{status}</p>}
          </section>

          <div className="kicker">ENTRIES</div>
          {entries.length === 0 && (
            <p className="muted" style={{ fontSize: 14 }}>아직 일기가 없어요. 위에서 첫 일기를 써 보세요.</p>
          )}
          {entries.map((e) => (
            <section key={e.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="kicker" style={{ margin: 0 }}>{e.date}</div>
                <button className="btn secondary small" onClick={() => removeEntry(e.id)}>삭제</button>
              </div>
              <p className="en" style={{ margin: "8px 0 4px", fontSize: 17, lineHeight: 1.5 }}>{e.text}</p>
              {e.corrected && e.corrected !== e.text && (
                <>
                  <button className="btn secondary small" style={{ marginTop: 6 }} onClick={() => setShowFixed({ ...showFixed, [e.id]: !showFixed[e.id] })}>
                    {showFixed[e.id] ? "교정본 숨기기" : "고친 버전 보기"}
                  </button>
                  {showFixed[e.id] && (
                    <p className="en" style={{ margin: "8px 0 0", fontSize: 16, color: "var(--green)", lineHeight: 1.5 }}>{e.corrected}</p>
                  )}
                </>
              )}
              {e.ko && (
                <>
                  <button className="btn secondary small" style={{ marginTop: 6, marginLeft: 6 }} onClick={() => setShowKo({ ...showKo, [e.id]: !showKo[e.id] })}>
                    {showKo[e.id] ? "한국어 숨기기" : "한국어 번역"}
                  </button>
                  {showKo[e.id] && <p className="muted" style={{ margin: "8px 0 0", fontSize: 14, lineHeight: 1.5 }}>{e.ko}</p>}
                </>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {e.audio_path && (
                  <button className="btn secondary small" onClick={() => play(e.audio_path!)}>내 발음 듣기</button>
                )}
              </div>
            </section>
          ))}

          {entries.some((e) => e.audio_path) && (
            <RemixCard
              endpoint="/api/diary/remix"
              title="내 일기 노래"
              hint="일기 녹음들을 비트에 얹어 노래로 만들어 듣습니다. 톤(자연/밝게/느긋)도 바꿔 보세요."
            />
          )}
        </>
      )}
    </main>
  );
}
