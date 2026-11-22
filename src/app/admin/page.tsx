"use client";

import { useCallback, useEffect, useState } from "react";

import TabNav from "@/components/TabNav";
type UserRow = {
  id: string;
  username: string;
  role: string;
  created_at: string;
  sessions: number;
  turns: number;
  avg_score: number | null;
  phrases: number;
  due: number;
  xp: number;
  level: number;
  level_title: string;
  streak_days: number;
  last_active: string | null;
};

type Detail = {
  user: { id: string; username: string; created_at: string };
  game: { xp: number; level: number; level_title: string; streak_days: number; last7: { date: string; reviews: number; turns: number }[] };
  sessions: { id: string; topic: string; level: string; turn_count: number; created_at: string }[];
  recent_turns: { created_at: string; transcript: string; corrected: string | null; score: number | null; coach_note_ko: string | null }[];
  stats: { turns: number; sessions: number; phrases: number; avg_score: number | null; reuse: { assigned: number; reused: number; rate: number }; error_counts: Record<string, number> };
};

type InviteCode = {
  code: string;
  label: string;
  active: boolean;
  uses: number;
  used_by: string[];
  created_by: string;
  created_at: string;
};

const ERROR_LABELS: Record<string, string> = {
  tense: "시제", article: "관사", preposition: "전치사",
  word_choice: "단어 선택", agreement: "주어-동사 일치", other: "기타",
};

export default function AdminPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [resetPw, setResetPw] = useState<{ id: string; username: string; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [newCode, setNewCode] = useState("");

  const load = useCallback(async () => {
    const me = await fetch("/api/auth/me").then((r) => (r.ok ? r.json() : null));
    if (!me || me.role !== "admin") {
      setAllowed(false);
      return;
    }
    setAllowed(true);
    const d = await fetch("/api/admin/users").then((r) => r.json());
    setUsers(d.users || []);
  }, []);

  const loadCodes = useCallback(async () => {
    const d = await fetch("/api/admin/codes").then((r) => r.json()).catch(() => ({}));
    setCodes(d.codes || []);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (allowed) loadCodes();
  }, [allowed, loadCodes]);

  async function createCode() {
    const res = await fetch("/api/admin/codes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newCode ? { code: newCode } : {}),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      setNotice(d.error || "생성 실패");
      return;
    }
    setNewCode("");
    setNotice(`코드 "${d.code.code}" 생성 완료`);
    loadCodes();
  }

  async function toggleCode(code: string, active: boolean) {
    await fetch("/api/admin/codes", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, active }),
    });
    loadCodes();
  }

  async function openDetail(id: string) {
    const d = await fetch(`/api/admin/users/${id}`).then((r) => r.json());
    if (!d.error) setDetail(d);
  }

  async function submitReset() {
    if (!resetPw) return;
    const res = await fetch(`/api/admin/users/${resetPw.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: resetPw.value }),
    });
    const d = await res.json().catch(() => ({}));
    setNotice(res.ok ? `${resetPw.username}님의 비밀번호가 변경되었습니다` : d.error || "실패");
    setResetPw(null);
  }

  if (allowed === null) {
    return <main className="page"><p className="muted">확인 중...</p></main>;
  }

  if (!allowed) {
    return (
      <main className="page">
        <h1 className="title">관리자</h1>
        <section className="card" style={{ textAlign: "center", padding: 32 }}>
          <p style={{ fontSize: 36, margin: 0 }}>🔒</p>
          <p style={{ fontWeight: 700, margin: "8px 0" }}>관리자 계정으로 로그인해 주세요</p>
          <a href="/" className="btn" style={{ display: "inline-flex", textDecoration: "none" }}>로그인하러 가기</a>
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <h1 className="title">학습 현황 관리</h1>
      <p className="subtitle">모든 계정의 학습 상태를 한눈에 봅니다</p>

      <TabNav />

      {notice && <p className="chip green">{notice}</p>}

      {!detail && (
        <section className="card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div className="faint" style={{ fontWeight: 600 }}>초대 코드 — 가입에는 코드가 필요합니다 (여러 번 사용 가능)</div>
              <span className="chip">{codes.length}개</span>
            </div>
            {codes.length === 0 && <p className="muted" style={{ margin: "4px 0" }}>코드가 없습니다. 아래에서 만들어 주세요.</p>}
            {codes.map((c) => (
              <div key={c.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: "1px solid var(--line)", flexWrap: "wrap" }}>
                <div>
                  <b style={{ fontSize: 15, letterSpacing: "0.03em" }}>{c.code}</b>
                  <div className="faint">
                    가입 {c.uses}회{c.used_by.length > 0 && ` · ${c.used_by.join(", ")}`}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span className={`chip ${c.active ? "green" : "amber"}`}>{c.active ? "사용 중" : "중지됨"}</span>
                  <button className="btn secondary small" onClick={() => toggleCode(c.code, !c.active)}>
                    {c.active ? "중지" : "활성화"}
                  </button>
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={newCode}
                onChange={(e) => setNewCode(e.target.value)}
                placeholder="새 코드 (비우면 자동 생성)"
                style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 15 }}
              />
              <button onClick={createCode} className="btn small">코드 만들기</button>
            </div>
        </section>
      )}

      {!detail && (
        <>
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            {users.map((u) => (
              <button
                key={u.id}
                onClick={() => openDetail(u.id)}
                style={{ all: "unset", cursor: "pointer", display: "block", width: "100%", boxSizing: "border-box", padding: "14px 18px", borderBottom: "1px solid var(--line)" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <b style={{ fontSize: 16 }}>
                    {u.username}{u.role === "admin" && <span className="chip" style={{ marginLeft: 6, fontSize: 11 }}>관리자</span>}
                  </b>
                  <span className="faint">
                    {u.last_active ? `최근 활동 ${new Date(u.last_active).toLocaleDateString("ko-KR")}` : "기록 없음"}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                  <span className="chip">Lv.{u.level} {u.level_title}</span>
                  <span className="chip amber">🔥 {u.streak_days}일</span>
                  <span className="chip green">{u.xp} XP</span>
                  <span className="faint">{u.sessions}세션 · {u.turns}턴 · 표현 {u.phrases}개 · 복습 {u.due}장</span>
                  {u.avg_score !== null && <span className="faint">· 평균 {u.avg_score}/5</span>}
                </div>
              </button>
            ))}
          </div>
          <p className="faint">계정을 누르면 상세 학습 현황과 비밀번호 초기화를 할 수 있어요.</p>
        </>
      )}

      {detail && (
        <>
          <button onClick={() => setDetail(null)} className="btn secondary small">← 전체 목록</button>
          <h2 style={{ fontSize: 20, margin: "14px 0 2px" }}>
            {detail.user.username}
            <span className="chip" style={{ marginLeft: 8 }}>Lv.{detail.game.level} {detail.game.level_title}</span>
            <span className="chip amber" style={{ marginLeft: 6 }}>🔥 {detail.game.streak_days}일</span>
          </h2>
          <p className="faint">가입일 {new Date(detail.user.created_at).toLocaleDateString("ko-KR")} · {detail.game.xp} XP</p>

          <div className="strip" style={{ flexWrap: "wrap" }}>
            <div className="stat" style={{ flex: 1, minWidth: 100 }}><b>{detail.stats.sessions}</b><span>세션</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 100 }}><b>{detail.stats.turns}</b><span>턴</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 100 }}><b>{detail.stats.avg_score ?? "—"}</b><span>평균 점수</span></div>
            <div className="stat" style={{ flex: 1, minWidth: 100 }}><b>{detail.stats.reuse.rate}%</b><span>표현 재사용</span></div>
          </div>

          <div className="card">
            <div className="faint" style={{ fontWeight: 600, marginBottom: 6 }}>오류 유형 분포</div>
            {Object.keys(detail.stats.error_counts).length === 0 && <p className="muted" style={{ margin: 0 }}>기록된 오류가 없습니다.</p>}
            {Object.entries(detail.stats.error_counts).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <span key={type} className="chip" style={{ marginRight: 6, marginBottom: 6 }}>
                {ERROR_LABELS[type] ?? type} {count}회
              </span>
            ))}
          </div>

          <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>최근 세션</h3>
          {detail.sessions.map((s) => (
            <div key={s.id} className="card" style={{ padding: "10px 14px", display: "flex", justifyContent: "space-between" }}>
              <span>{s.topic} · {s.level}</span>
              <span className="faint">{s.turn_count}턴 · {new Date(s.created_at).toLocaleDateString("ko-KR")}</span>
            </div>
          ))}
          {detail.sessions.length === 0 && <p className="muted">세션이 없습니다.</p>}

          <h3 style={{ fontSize: 15, margin: "16px 0 6px" }}>최근 문장</h3>
          {detail.recent_turns.map((t, i) => (
            <div key={i} className="card" style={{ padding: "10px 14px" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: 15 }}>{t.transcript}</span>
                {typeof t.score === "number" && <span className="chip" style={{ fontSize: 12 }}>📊 {t.score}/5</span>}
              </div>
              {t.corrected && t.corrected !== t.transcript && (
                <div style={{ color: "var(--green)", fontSize: 13, marginTop: 4 }}>→ {t.corrected}</div>
              )}
              <div className="faint" style={{ marginTop: 4 }}>
                {new Date(t.created_at).toLocaleString("ko-KR")}{t.coach_note_ko ? ` · ${t.coach_note_ko}` : ""}
              </div>
            </div>
          ))}
          {detail.recent_turns.length === 0 && <p className="muted">기록이 없습니다.</p>}

          <div className="card">
            <div className="faint" style={{ fontWeight: 600, marginBottom: 8 }}>비밀번호 초기화</div>
            <button
              className="btn secondary small"
              onClick={() => setResetPw({ id: detail.user.id, username: detail.user.username, value: "" })}
            >
              {detail.user.username}님 비밀번호 재설정
            </button>
            {resetPw && resetPw.id === detail.user.id && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  value={resetPw.value}
                  onChange={(e) => setResetPw({ ...resetPw, value: e.target.value })}
                  placeholder="새 비밀번호 (6자 이상)"
                  style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", fontSize: 15 }}
                />
                <button onClick={submitReset} className="btn small">저장</button>
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}
