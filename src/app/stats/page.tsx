"use client";

import { useEffect, useState } from "react";

type Stats = {
  game: {
    xp: number;
    level: number;
    level_title: string;
    level_into: number;
    level_span: number;
    streak_days: number;
    today_reviews: number;
    today_turns: number;
    goal: { reviews_target: number; turns_target: number };
    goal_met: boolean;
    last7: { date: string; reviews: number; turns: number }[];
  };
  week: { sessions: number; turns: number; estimated_minutes: number; unique_phrases: number };
  top_errors: { type: string; count: number }[];
  phrase_reuse: { assigned: number; reused: number; rate: number };
  review: { total_phrases: number; due: number; learned: number };
  all_time: { sessions: number; turns: number };
};

const ERROR_LABELS: Record<string, string> = {
  tense: "시제",
  article: "관사",
  preposition: "전치사",
  word_choice: "단어 선택",
  agreement: "주어-동사 일치",
  other: "기타",
};

const DAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export default function StatsPage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [me, setMe] = useState<{ username: string } | null>(null);
  const [authChecked, setAuthChecked] = useState(false);


  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setStats(d)))
      .catch(() => setError("통계를 불러오지 못했습니다."));
  }, []);

  const tile = (label: string, value: React.ReactNode) => (
    <div className="stat" style={{ flex: 1, minWidth: 110 }}>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );

  const maxActivity = stats ? Math.max(1, ...stats.game.last7.map((d) => d.reviews + d.turns)) : 1;
  const levelPct = stats ? Math.round((stats.game.level_into / stats.game.level_span) * 100) : 0;


  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => setMe(r.ok ? { username: "" } : null))
      .catch(() => setMe(null))
      .finally(() => setAuthChecked(true));
  }, []);

  return (
    <main className="page">
      <h1 className="title">학습 통계</h1>
      <p className="subtitle">이력서 &quot;성과&quot; 섹션에 그대로 쓸 수 있는 숫자들</p>

      <nav className="nav">
        <a href="/"><svg viewBox="0 0 24 24"><path d="M4 5h16v11H9l-5 4V5z"/></svg><span>대화</span></a>
        <a href="/review"><svg viewBox="0 0 24 24"><path d="M7 4h10v16l-5-3-5 3V4z"/></svg><span>복습</span></a>
        <a href="/stats" className="on"><svg viewBox="0 0 24 24"><path d="M5 20V10M12 20V4M19 20v-7"/></svg><span>통계</span></a>
        <a href="/history"><svg viewBox="0 0 24 24"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 3"/></svg><span>기록</span></a>
      </nav>

      {authChecked && !me && (
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🔒</p>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>로그인이 필요합니다</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      )}
      {me && error && <p style={{ color: "var(--red)" }}>{error}</p>}

      {stats && (
        <>
          <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <div>
                <span style={{ fontSize: 15 }} className="chip">Lv.{stats.game.level} {stats.game.level_title}</span>
                <span className="chip amber" style={{ marginLeft: 6 }}>연속 {stats.game.streak_days}일</span>
              </div>
              <span className="muted" style={{ fontSize: 13 }}>{stats.game.xp} XP</span>
            </div>
            <div className="progressbar" style={{ marginTop: 12 }}>
              <div style={{ width: `${levelPct}%` }} />
            </div>
            <div className="faint" style={{ marginTop: 6 }}>
              다음 레벨까지 {stats.game.level_span - stats.game.level_into} XP
            </div>
          </section>

          <h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>최근 7일 활동</h3>
          <section className="card" style={{ padding: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", height: 90 }}>
              {stats.game.last7.map((d) => {
                const total = d.reviews + d.turns;
                const dt = new Date(d.date + "T12:00:00");
                const isToday = d.date === stats.game.last7[6].date;
                return (
                  <div key={d.date} style={{ flex: 1, textAlign: "center" }}>
                    <div style={{ height: 70, display: "flex", alignItems: "flex-end", gap: 2 }}>
                      <div style={{ flex: 1, height: `${(d.turns / maxActivity) * 100}%`, minHeight: total ? 4 : 2, background: "var(--blue)", borderRadius: 3, opacity: isToday ? 1 : 0.55 }} title={`대화 ${d.turns}`} />
                      <div style={{ flex: 1, height: `${(d.reviews / maxActivity) * 100}%`, minHeight: total ? 4 : 2, background: "var(--green)", borderRadius: 3, opacity: isToday ? 1 : 0.55 }} title={`복습 ${d.reviews}`} />
                    </div>
                    <div className="faint" style={{ marginTop: 4, fontWeight: isToday ? 700 : 400 }}>{DAY_LABELS[dt.getDay()]}</div>
                  </div>
                );
              })}
            </div>
            <div className="faint" style={{ marginTop: 8, textAlign: "center" }}>
              <span style={{ color: "var(--blue)" }}>■</span> 대화 · <span style={{ color: "var(--green)" }}>■</span> 복습
            </div>
          </section>

          <h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>최근 7일</h3>
          <div className="strip" style={{ flexWrap: "wrap" }}>
            {tile("완료 세션", stats.week.sessions)}
            {tile("연습 턴", stats.week.turns)}
            {tile("말하기 (추정)", `${stats.week.estimated_minutes}분`)}
            {tile("고유 표현", stats.week.unique_phrases)}
          </div>

          <h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>오류 유형 (7일)</h3>
          <section className="card errorchart">
            {stats.top_errors.length === 0 && <p className="muted" style={{ margin: 0 }}>최근 7일간 오류가 없어요.</p>}
            {stats.top_errors.map(({ type, count }) => (
              <div key={type} style={{ margin: "8px 0" }}>
                <div className="bar-label">
                  <span>{ERROR_LABELS[type] ?? type}</span>
                  <span className="muted">{count}회</span>
                </div>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(count / stats.top_errors[0].count) * 100}%` }} />
                </div>
              </div>
            ))}
          </section>

          <h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>교정 표현 재사용</h3>
          <section className="card">
            <p style={{ margin: 0, fontSize: 15 }}>
              교정받은 표현 {stats.phrase_reuse.assigned}개 중 <b>{stats.phrase_reuse.reused}개</b>를 이후 대화에서 다시 말했어요 —{" "}
              <b style={{ color: "var(--green)" }}>{stats.phrase_reuse.rate}%</b>
            </p>
            <p className="faint" style={{ margin: "8px 0 0" }}>
              교정이 진짜 학습으로 이어졌는지 보는 핵심 지표예요.
            </p>
          </section>

          <h3 style={{ margin: "18px 0 4px", fontSize: 15 }}>복습 현황</h3>
          <div className="strip" style={{ flexWrap: "wrap" }}>
            {tile("저장된 표현", stats.review.total_phrases)}
            {tile("복습할 카드", stats.review.due)}
            {tile("장기 기억", stats.review.learned)}
          </div>

          <p className="faint" style={{ marginTop: 18 }}>
            전체 누적: {stats.all_time.sessions}세션 · {stats.all_time.turns}턴
          </p>
        </>
      )}
    </main>
  );
}
