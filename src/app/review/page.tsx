"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import RemixCard from "@/components/RemixCard";

type Phrase = {
  id: string;
  phrase: string;
  ko_note: string | null;
  first_seen: string;
  last_used: string | null;
  times_seen: number;
  times_correct: number;
  ease: number;
  interval_days: number;
  due_at: string;
};

type Game = {
  seeds: number;
  xp: number;
  level: number;
  level_title: string;
  level_into: number;
  level_span: number;
  streak_days: number;
  today_reviews: number;
  goal: { reviews_target: number };
  goal_met: boolean;
};

type Deck = "all" | "phrase" | "sentence";

type SummaryTurn = { transcript: string; corrected: string | null; score: number | null; coach_note_ko: string | null };
type Summary = {
  session: { id: string; topic: string; level: string; created_at: string; turn_count: number };
  avg_score: number | null;
  good: SummaryTurn[];
  fix: SummaryTurn[];
  new_phrases: { phrase: string; ko_note: string | null }[];
  tomorrow: string | null;
} | null;

function isPhrase(p: Phrase): boolean {
  return p.phrase.trim().split(/\s+/).length <= 5;
}

function speak(text: string) {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = 0.9;
    window.speechSynthesis.speak(u);
  }
}

export default function ReviewPage() {
  const [phrases, setPhrases] = useState<Phrase[]>([]);
  const [deck, setDeck] = useState<Deck>("all");
  const [queue, setQueue] = useState<Phrase[]>([]);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [autoSound, setAutoSound] = useState(true);
  const [done, setDone] = useState(0);
  const [correct, setCorrect] = useState(0);
  const [combo, setCombo] = useState(0);
  const [maxCombo, setMaxCombo] = useState(0);
  const [sessionXp, setSessionXp] = useState(0);
  const [xpFloat, setXpFloat] = useState<{ id: number; text: string } | null>(null);
  const [shake, setShake] = useState(0);
  const [game, setGame] = useState<Game | null>(null);
  const [summary, setSummary] = useState<Summary>(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);


  const load = useCallback(() => {
    Promise.all([
      fetch("/api/phrases").then((r) => r.json()),
      fetch("/api/stats").then((r) => r.json()),
      fetch("/api/summary").then((r) => r.json()),
    ])
      .then(([p, s, sum]) => {
        setPhrases(p.phrases || []);
        setGame(s.game ?? null);
        setSummary(sum.summary ?? null);
      })
      .catch(() => setError("불러오기 실패"));
  }, []);

  useEffect(() => {
    load();
    return () => window.speechSynthesis?.cancel();
  }, [load]);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setMe(r.ok ? { username: "" } : null))
      .catch(() => setMe(null))
      .finally(() => setAuthChecked(true));
  }, []);

  // Rebuild the queue whenever the deck filter or data changes.
  const buildQueue = useCallback((list: Phrase[], d: Deck) => {
    const filtered = list.filter((p) => d === "all" || (d === "phrase") === isPhrase(p));
    const now = Date.now();
    const due = filtered.filter((p) => new Date(p.due_at).getTime() <= now);
    const ahead = filtered.filter((p) => new Date(p.due_at).getTime() > now);
    const byDue = (a: Phrase, b: Phrase) => a.due_at.localeCompare(b.due_at);
    return [...due.sort(byDue), ...ahead.sort(byDue)];
  }, []);

  useEffect(() => {
    setQueue(buildQueue(phrases, deck));
    setIndex(0);
    setFlipped(false);
  }, [phrases, deck, buildQueue]);

  const current = queue[index];
  const dueCount = useMemo(
    () => phrases.filter((p) => new Date(p.due_at).getTime() <= Date.now()).length,
    [phrases],
  );

  async function mark(good: boolean) {
    if (!current) return;
    const xp = good ? 10 : 2;
    fetch("/api/phrases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: current.id, correct: good }),
    }).catch(() => {});

    const nextCombo = good ? combo + 1 : 0;
    setCombo(nextCombo);
    setMaxCombo((m) => Math.max(m, nextCombo));
    setCorrect((c) => c + (good ? 1 : 0));
    setSessionXp((x) => x + xp);
    setXpFloat({ id: Date.now(), text: `+${xp} XP${nextCombo >= 3 ? ` · ${nextCombo} 콤보` : ""}` });
    if (!good) setShake((s) => s + 1);
    setDone((d) => d + 1);
    setFlipped(false);
    setIndex((i) => i + 1);
  }

  function toggleFlip() {
    const next = !flipped;
    setFlipped(next);
    if (next && autoSound && current) speak(current.phrase);
  }

  const progress = queue.length ? (done / queue.length) * 100 : 0;
  const finished = queue.length > 0 && index >= queue.length;
  const accuracy = done ? Math.round((correct / done) * 100) : 0;
  const goalPct = game ? Math.min(100, Math.round((game.today_reviews / game.goal.reviews_target) * 100)) : 0;

  return (
    <main className="page">
      <a href="/" className="faint" style={{ textDecoration: "none" }}>← 홈</a>
      <h1 className="title">표현 복습</h1>
      <p className="subtitle">대화에서 나온 문장을 SM-2 간격 반복으로 암기해요</p>

      <nav className="nav">
        <a href="/"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg><span>대화</span></a>
        <a href="/review" className="on"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3-5 3V4z"/></svg><span>복습</span></a>
        <a href="/stats"><svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><span>통계</span></a>
        <a href="/podcast"><svg viewBox="0 0 24 24"><path d="M4 14v-3a8 8 0 0 1 16 0v3M4 14h3v7H4zM17 14h3v7h-3z"/></svg><span>팟캐스트</span></a>
        <a href="/history"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3"/></svg><span>기록</span></a>
      </nav>

      {game && (
        <div className="numbers">
          <div className="n"><b>{game.streak_days}일</b><span>연속 학습</span></div>
          <div className="n"><b>{game.seeds}</b><span>씨앗</span></div>
          <div className="n"><b>Lv.{game.level}</b><span>{game.level_title}</span></div>
          <div className="stat">
            <b>{game.goal_met ? "달성" : `${goalPct}%`}</b>
            <span>오늘 목표 {game.today_reviews}/{game.goal.reviews_target}</span>
          </div>
        </div>
      )}

      {authChecked && !me && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🔒</p>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>로그인이 필요합니다</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      )}
      {me && error && <p style={{ color: "var(--red)" }}>{error}</p>}

      {game && !finished && (
        <div className="card" style={{ padding: "12px 16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 6 }}>
            <span className="muted">다음 레벨까지</span>
            <span className="muted">{game.level_into}/{game.level_span} XP</span>
          </div>
          <div className="progressbar">
            <div style={{ width: `${Math.round((game.level_into / game.level_span) * 100)}%` }} />
          </div>
        </div>
      )}

      {summary && !finished && (
        <section className="card" style={{ borderColor: "var(--blue)", background: "var(--blue-soft)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b style={{ fontSize: 15 }}>지난 세션 평가</b>
            <span className="faint">
              {summary.session.topic} · {new Date(summary.session.created_at).toLocaleDateString("ko-KR")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 6, margin: "8px 0", flexWrap: "wrap" }}>
            <span className="chip">{summary.session.turn_count}턴</span>
            {summary.avg_score !== null && <span className="chip amber">평균 {summary.avg_score}/5</span>}
            <span className="chip green">표현 +{summary.new_phrases.length}</span>
          </div>
          {summary.good.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--green-dark)", marginBottom: 4 }}>잘한 문장 — 이대로 유지</div>
              {summary.good.map((t, i) => (
                <div key={i} style={{ background: "#fff", border: "2px solid var(--green)", borderRadius: 10, padding: "8px 12px", margin: "4px 0" }}>
                  <div className="en" style={{ fontSize: 16, fontWeight: 500 }}>{t.transcript}</div>
                  <div className="faint">{typeof t.score === "number" ? `${t.score}/5 · ` : ""}{t.coach_note_ko ?? ""}</div>
                </div>
              ))}
            </div>
          )}
          {summary.fix.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--red)", marginBottom: 4 }}>고친 문장 — 복습해서 다시 말해봐요</div>
              {summary.fix.map((t, i) => (
                <div key={i} style={{ background: "#fff", border: "2px solid var(--line)", borderRadius: 10, padding: "8px 12px", margin: "4px 0" }}>
                  <div className="en" style={{ fontSize: 14, color: "var(--muted)" }}>{t.transcript}</div>
                  {t.corrected && <div style={{ fontSize: 15, fontWeight: 700, color: "var(--green-dark)" }}>→ {t.corrected}</div>}
                </div>
              ))}
            </div>
          )}
          {summary.tomorrow && (
            <p style={{ fontSize: 13, color: "var(--blue-dark)", fontWeight: 700, margin: "10px 0 0" }}>
              🎯 다음에 써볼 표현: {summary.tomorrow}
            </p>
          )}
        </section>
      )}

      {!finished && queue.length > 0 && (
        <>
          <div className="segmented" style={{ margin: "12px 0" }}>
            <button className={deck === "all" ? "on" : ""} onClick={() => setDeck("all")}>전체 {phrases.length}</button>
            <button className={deck === "phrase" ? "on" : ""} onClick={() => setDeck("phrase")}>
              표현 {phrases.filter(isPhrase).length}
            </button>
            <button className={deck === "sentence" ? "on" : ""} onClick={() => setDeck("sentence")}>
              문장 {phrases.filter((p) => !isPhrase(p)).length}
            </button>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, color: "var(--muted)", margin: "4px 2px" }}>
            <span>{done} / {queue.length} 장</span>
            <span style={{ display: "flex", gap: 10 }}>
              {combo >= 2 && <b style={{ color: "#8a6100" }}>{combo} 콤보</b>}
              <button
                onClick={() => setAutoSound(!autoSound)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 14, color: autoSound ? "var(--ink)" : "var(--faint)" }}
              >
                {autoSound ? "자동발음 켬" : "자동발음 끔"}
              </button>
            </span>
          </div>
          <div className="progressbar" style={{ marginBottom: 4 }}>
            <div style={{ width: `${progress}%` }} />
          </div>

          {current && (
            <div className="flip-scene" key={`${current.id}-${shake}`}>
              <div className={`flip-inner ${flipped ? "flipped" : ""}`} onClick={toggleFlip}>
                <div className="flip-face">
                  <span className={`badge ${isPhrase(current) ? "phrase" : "sentence"}`} style={{ position: "absolute", top: 14, left: 14 }}>
                    {isPhrase(current) ? "표현" : "문장"}
                  </span>
                  <div className="en" style={{ fontSize: 25, fontWeight: 500, lineHeight: 1.35 }}>{current.phrase}</div>
                  <div className="faint" style={{ marginTop: 14 }}>탭해서 뜻 보기</div>
                  <button
                    className="btn secondary small"
                    style={{ position: "absolute", bottom: 14, right: 14 }}
                    onClick={(e) => { e.stopPropagation(); speak(current.phrase); }}
                  >
                    발음
                  </button>
                </div>
                <div className="flip-face back">
                  <div style={{ fontSize: 19, lineHeight: 1.55 }}>{current.ko_note || "(노트 없음)"}</div>
                  <div style={{ fontSize: 16, color: "var(--blue)", marginTop: 12, fontWeight: 600 }}>{current.phrase}</div>
                  <div className="faint" style={{ marginTop: 12 }}>
                    연습 {current.times_seen}회 · 성공 {current.times_correct}회 · 복습 주기 {current.interval_days}일
                  </div>
                  <button
                    className="btn secondary small"
                    style={{ position: "absolute", bottom: 14, right: 14 }}
                    onClick={(e) => { e.stopPropagation(); speak(current.phrase); }}
                  >
                    따라하기
                  </button>
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            <button className="btn red" style={{ flex: 1 }} onClick={() => mark(false)}>
              다시 볼게요 <span style={{ fontSize: 12, opacity: 0.8 }}>+2 XP</span>
            </button>
            <button className="btn green" style={{ flex: 1 }} onClick={() => mark(true)}>
              외웠어요! <span style={{ fontSize: 12, opacity: 0.8 }}>+10 XP</span>
            </button>
          </div>
          <button
            className="btn secondary"
            style={{ width: "100%", marginTop: 8 }}
            onClick={() => { setFlipped(false); setIndex((i) => i + 1); }}
          >
            건너뛰기 →
          </button>
        </>
      )}

      {queue.length === 0 && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontWeight: 700, fontSize: 18, margin: "8px 0" }}>아직 저장된 표현이 없어요</p>
          <p className="muted" style={{ fontSize: 14 }}>대화를 하면 내가 말한 문장과 고친 표현이 자동으로 카드가 됩니다.</p>
          <a href="/" className="btn" style={{ display: "inline-flex", marginTop: 10, textDecoration: "none" }}>대화하러 가기</a>
        </section>
      )}

      {finished && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 700, margin: "12px 0 6px" }}>Nice work.</p>
          <p className="muted" style={{ margin: "0 0 14px", fontWeight: 700, fontSize: 15 }}>{done}장 복습 완료 · 정답률 {accuracy}% · 최대 {maxCombo} 콤보</p>
          <p className="muted" style={{ margin: "0 0 14px" }}></p>
          <div className="numbers" style={{ margin: "0 0 14px" }}>
            <div className="n"><b className="pop" style={{ color: "var(--green)" }}>+{sessionXp}</b><span>이번 세션 XP</span></div>
            <div className="n"><b>{game?.today_reviews ?? done}</b><span>오늘 복습</span></div>
            <div className="n"><b>{dueCount}</b><span>남은 카드</span></div>
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button className="btn secondary" style={{ flex: 1 }} onClick={load}>카드 새로고침</button>
            <a href="/" className="btn" style={{ flex: 1, textDecoration: "none" }}>대화하러 가기</a>
          </div>
        </section>
      )}

      {me && !finished && (
        <RemixCard />
      )}

      {xpFloat && (
        <div className="xp-float" key={xpFloat.id}>{xpFloat.text}</div>
      )}
    </main>
  );
}
