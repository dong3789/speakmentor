# TASKS.md

Ordered for the next agent. Check boxes in the same file when done.

## P0 — make the loop real

- [x] Replace `/api/turns` stub with STT
- [x] Call LLM using `prompts/tutor_turn.md` and parse JSON safely
- [x] Generate TTS from `reply_en` only
- [x] Return `transcript`, `corrected`, `coach_note_ko`, `reply_en`, `reply_audio_url`
- [x] Confirm the record button on `/` plays tutor audio

## P1 — persist

- [x] Create session on first turn if no session id
- [x] Insert `turns` and `errors`
- [x] Store audio files; save paths, not only blobs in memory
- [x] Add a simple `/history` page listing sessions
- [ ] Create Supabase project and run `supabase/schema.sql` (optional; local JSON works)

## P1.5 — memory & phrase bank (user's direction: long-term personal tutor)

- [x] phrase_bank table (schema.sql) + PhraseRow store functions
- [x] Tutor memory injection (recent errors + learned phrases every turn)
- [x] `/review` flashcards with times_seen/times_correct
- [x] SM-2 style spaced repetition (ease / interval_days / due_at; two-button SM-2)
- [x] `/stats` weekly page: sessions, turns, speaking minutes (est.), error-type chart
- [x] Target-phrase reuse detector (normalized string containment on later turns)
- [ ] Link review cards back to the recorded turn audio

## P2 — tutor quality

- [x] Pass previous `target_phrase_for_next_turn` into the next prompt
- [x] Enforce one primary error in post-processing even if the model returns more
- [x] Enforce error-type enum (tense/article/preposition/word_choice/agreement/other)
- [x] Add level + topic controls on the home page
- [x] Handle empty / garbage STT with "please say that again"
- [x] Browser live STT (Web Speech API) on `/`: interim text while speaking,
      auto-send on pause. MediaRecorder -> Whisper stays as the fallback path.
- [x] Audio retention: `AUDIO_RETENTION_DAYS` (default 14) auto-deletes old
      recordings at session start (privacy policy from ARCHITECTURE.md)

## P3 — evidence for resume

- [x] Weekly counts: sessions, turns, minutes (turn x 20s estimate), top error type (`/api/stats`, `/stats`)
- [x] Target-phrase reuse detector (see P1.5)
- [x] Real API-key smoke test — Gemini (gemini-3.8-flash) end to end: corrections,
      phrase bank, stats, reuse tracking all verified 2026-09-21
- [ ] Export one session as a case-study transcript

## Next (suggested order)

1. Export one session as a case-study transcript (P3)
2. Link review cards back to the recorded turn audio
3. Supabase setup if local JSON ever becomes limiting

## Deployed (2026-09-22)

- https://speak.yndl.dev — Cloudflare Tunnel -> Caddy (labels) -> `speakmentor`
  container on proxy_net, Basic Auth yoon/<pw in .env.local>
- App runs as a Docker image `speakmentor-app` (node:25-slim, next start :3000).
  Rebuild+rerun to deploy code changes. launchd service was removed.
- Audio moved from public/ to data/audio served by /api/audio/[name]:
  Next.js only serves public/ assets present at build time.
- kokoro-tts joined proxy_net; app reaches it at http://kokoro-tts:8880/v1.
- OrbStack VM memory raised 1536 -> 6144 MiB (~/.orbstack/vmconfig.json,
  backup vmconfig.json.bak) — kokoro OOMed under the old cap.
- iOS mic fix: when Web Speech Recognition is blocked/unavailable (iOS Safari
  often is), the page switches to record-then-upload; server STT transcribes
  via Gemini multimodal (m4a/webm/mp3) using the same key. Verified with a
  real speech sample through the deployed URL.

## Key setup (done 2026-09-21)

- Gemini via OpenAI-compatible endpoint: OPENAI_BASE_URL=generativelanguage
  .googleapis.com/v1beta/openai, TUTOR_MODEL=gemini-3.8-flash.
- gemini-2.5-flash is no longer available to new accounts (404) — use 3.8.
- max_tokens for the tutor call raised 700 -> 2000: thinking models spend
  part of the budget on reasoning and 700 truncated the JSON (finish=length).
- Output schema (exact key names) is now embedded in the tutor system prompt;
  sanitizeTutorResult also tolerates common aliases (corrected_sentence,
  phrase_bank_additions). Real-key smoke test passed: corrections, phrase
  bank with Korean notes, stats, reuse tracking.
- TTS: local kokoro-fastapi in Docker ONNX mode (port 8880). Gemini's
  OpenAI-compat endpoint has no /audio/speech, so the browser speechSynthesis
  fallback was the voice before. Turn latency ~8s end to end (Gemini thinking
  dominates; kokoro synthesis is ~1s).

## Done when

A user can record 8 turns, hear English replies, and open history that shows corrections.
Reached and verified with the real Gemini key on 2026-09-21.

## Accounts & invite codes (2026-09-23)

- Multi-user auth: users + session tokens in db.json (scrypt password hashing,
  httpOnly cookie sm_session). First run seeds admin `yoon` from
  ADMIN_PASSWORD/ADMIN_USERNAME and claims legacy rows.
- Signup requires an active invite code (multi-use). Codes live in db,
  managed by the admin at /admin: create (auto-generate or custom),
  activate/deactivate, usage count + who joined with each code.
- /admin = one admin viewing every account's learning: level/XP/streak,
  sessions/turns, avg Jev score, phrase reuse, error types, recent turns,
  password reset.
- Caddy Basic Auth removed (app-level accounts replace it); API routes
  enforce per-user scoping (owner or admin).

## Latency work (2026-09-23)

Measured turn was ~8-9s. Changes:
- Tutor LLM: reasoning_effort=low (TUTOR_REASONING env) — Gemini call 7.1s -> ~2.5-3s,
  JSON quality unchanged. "none" tested: not faster on average (2.6-8.4s variance).
- Jev scoring now runs in PARALLEL with kokoro TTS (both depend only on the
  tutor result) — was sequential.
- Session-start intro audio cached per topic (data/audio/opening-*.mp3,
  excluded from retention cleanup): 1.2s -> 0.35s warm.
Result: turn ~4.4-5.3s (from ~8-9s). Remaining floor is Google API network
time (~2.5-4s); next lever would be streaming the reply (v2).

## Local whisper.cpp STT (2026-09-23)

- brew whisper-cpp + ggml-small.en.bin (~/.whisper-models), server as launchd
  service com.whisper.server (host 127.0.0.1:8080, --convert needs ffmpeg;
  PATH + WorkingDirectory set in the plist).
- STT_PROVIDER=whisper-cpp routes the accurate-mode recording transcription
  to http://host.docker.internal:8080/inference — free, local, ~0.4s.
  Gemini transcription stays available by removing STT_PROVIDER.
- Verified end to end through the deployed URL (transcript + Jev score).

## Jev 고도화 (2026-09-23)

- One Jev call now returns 6 parallel verdicts: sentence_score, grammar_score,
  vocab_score, next_difficulty, question_angle, practice_focus.
- question_angle (꼬리질문/가정법/의견/경험/비교) and practice_focus
  (오류재연습/표현재사용/묘사/유창성) are stored on the turn and injected into
  the NEXT tutor prompt -> questions vary in type and target the learner's
  weakness (e.g. past-tense errors -> "tell a past story").
- UI: prompt card shows the angle badge (🔍꼬리질문 etc). Turn rows store
  jev_grammar / jev_vocab for future stats.

## Seeds economy + parrot growth (2026-09-23, v3 디자인)

- 자체 팔레트로 전환(듀오링고 카피 탈피): teal primary, coral accent,
  gold seeds. Duolingo-style chunky 버튼 구조는 유지.
- 🌻 씨앗 = idle 재화: 2분당 1개 실시간 적립, 보관함 최대 240개(8시간).
  연습 보너스: 턴 +5, 복습 +3/+1, 세션 완료 +10. 신규 가입 선물 100개.
- 씨앗 사용처(/api/hint): 한글 힌트 5개(답변에 넣을 한글 키워드 2-3개 생성),
  예시 하나 더 3개. 실패 시 차감 없음.
- 앵무새 성장 단계: 레벨에 따라 🐣→🐤→🦜→🌟 (home 성장 카드).
- 메타: meta_by_user[*].seeds / seeds_updated_at (마이그레이션: 기존 유저 100개 지급).

## Listening podcast generator (2026-09-24)

- /podcast tab: 주제(프리셋+자유입력)·레벨(A1~B2)·길이(3/5/8분) 선택 →
  Gemini가 짧은 문장 스크립트(en+ko) 작성 → kokoro 줄당 음성 → ffmpeg concat
  (줄 사이 0.45s 쉼) → data/audio/podcast-{id}.mp3. 백그라운드 생성, 진행률 폴링.
- 플레이어: 오디오 + 스크립트 동기화(현재 줄 하이라이트·클릭 시그), 한국어 번역
  토글(끄면 귀트 모드), 배속 0.75/1/1.25. 컨테이너에 ffmpeg 추가.
- 줄 수 추정: minutes × 15줄 (줄당 ~3.3초). 생성 실패 시 status=error 표시.
