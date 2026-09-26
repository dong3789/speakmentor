# AGENTS.md

Read this first if you are an AI agent continuing SpeakMentor.

## What this project is

SpeakMentor is a voice-first English conversation tutor and a portfolio project.

Loop:

1. User speaks
2. STT
3. Tutor model returns structured JSON (one main correction + short English reply)
4. TTS speaks only the reply
5. Session/turns/errors are stored so progress can be shown later

It is not a generic chatbot. Teaching policy matters as much as the model.

## Language of the product vs language of the repo

- Spoken tutor audio: English only
- On-screen coach notes: Korean is allowed
- Repo docs: English so any agent can continue
- Original user is Korean and wants speaking practice without fear of mistakes

## Current status (2026-09-21, build verified, demo-mode smoke tested)

Done:
- Full pipeline: STT -> tutor LLM (JSON mode) -> TTS -> persist (`/api/turns`)
- Tutor memory: recent errors + learned phrases injected every turn
- Phrase bank: tutor extracts 1-3 phrases per turn, deduped, stored
- `/review` flashcard page, `/history` page, `/api/sessions`, `/api/phrases`
- Zero-key demo mode: browser speechSynthesis + rule-based local tutor
  + data/db.json storage. Set OPENAI_API_KEY to switch to real Whisper/GPT/TTS.
- Browser live STT (Web Speech API) as the primary mic path: interim text
  while speaking, auto-send on pause. MediaRecorder -> Whisper stays as
  the fallback for browsers without SpeechRecognition (e.g. Firefox).
- SM-2 spaced repetition in the phrase bank (ease / interval_days / due_at);
  `/review` queues due cards first; supabase/schema.sql has an ADD COLUMN
  migration for existing phrase_bank tables.
- `/stats` + `/api/stats`: weekly sessions/turns/minutes(est.), error-type
  distribution, target-phrase reuse rate (resume evidence, PRODUCT.md).
- Error-type enum enforced in tutor post-processing.
- Audio retention: AUDIO_RETENTION_DAYS (default 14) auto-delete at session start.
- Separate STT/LLM/TTS base URLs (STT_BASE_URL / TTS_BASE_URL overrides)
  for local stacks (whisper.cpp / LM Studio / kokoro-fastapi). See .env.example.
- `npx next build` passes; demo-mode API smoke-tested (turns, phrases, stats).

Not done:
- Real API-key smoke test (needs the user's key)
- Export one session as a case-study transcript (P3)
- Linking review cards back to recorded turn audio
- Auth, Supabase project creation (local JSON works)
- Streaming responses, VAD, duplex (v2, see ROADMAP)

Note: edits to the same file must be applied ONE AT A TIME.
Parallel edits to one file silently clobber each other in this environment.

Do not rewrite the stack unless asked. Finish the pipeline first.

## Hard product rules

1. Correct one high-value issue per turn, not every mistake.
2. Split teaching and talking:
   - screen: transcript, fix, Korean note, pronunciation tip
   - audio: short English follow-up only
3. Next question should make the user reuse `target_phrase_for_next_turn`.
4. If STT looks broken, ask the user to repeat. Do not invent a long correction.
5. v1 does not include phoneme scoring, live duplex calls, or a native mobile app.

## Canonical files

| File | Why it exists |
|------|----------------|
| `README.md` | Product + local run |
| `ARCHITECTURE.md` | System design |
| `PRODUCT.md` | UX and metrics |
| `ROADMAP.md` | What to build next |
| `prompts/tutor_turn.md` | Source of truth for tutor JSON |
| `src/lib/tutor.ts` | Types + system prompt fragment |
| `src/app/page.tsx` | Recorder UI |
| `src/app/api/turns/route.ts` | Pipeline entry (STT -> tutor -> TTS -> persist) |
| `supabase/schema.sql` | sessions / turns / errors |
| `CONTEXT.md` | Conversation decisions and constraints |
| `TASKS.md` | Next implementation tasks |

If docs and code disagree, prefer `prompts/tutor_turn.md` + `ARCHITECTURE.md`, then update the stub.

## Expected tutor JSON

```json
{
  "transcript_cleaned": "I went to the store yesterday.",
  "level_estimate": "A2",
  "errors": [
    { "span": "I go", "type": "tense", "fix": "I went" }
  ],
  "natural_versions": ["I went to the store yesterday."],
  "pronunciation_tip": {
    "focus_word": "yesterday",
    "note": "Stress the first syllable: YES-ter-day"
  },
  "coach_note_ko": "시제는 과거 went를 쓰세요.",
  "reply_en": "Nice. What did you buy there?",
  "target_phrase_for_next_turn": "I bought ..."
}
```

`reply_en` max 2 short sentences. This is the only string that should be sent to TTS.

## How to implement `/api/turns`

Input: `multipart/form-data` with `audio` (webm from MediaRecorder).

Minimum pipeline:

1. Save audio (disk or Supabase storage)
2. STT → transcript
3. LLM with `prompts/tutor_turn.md` → parse JSON
4. Persist session/turn/errors
5. TTS(`reply_en`) → public URL
6. Return JSON the UI already expects:

```ts
{
  transcript: string,
  corrected: string,          // first natural_versions[0] or transcript_cleaned
  coach_note_ko: string,
  reply_en: string,
  reply_audio_url: string
}
```

Keep keys stable. The page already reads these names.

## Env

See `.env.example`. Never commit `.env.local`.

## Stack freeze for v1

- Next.js App Router + TypeScript
- Supabase for auth/db/storage later
- Hosted Whisper-class STT
- One LLM in JSON mode
- One TTS voice, consistent across sessions

## What good work looks like

- Small diffs
- Pipeline actually returns audio
- Errors written to `errors` table
- No lecture in the spoken reply
- README / TASKS updated when status changes

## What to avoid

- Renaming the project
- Adding agents, RAG, vector DB, or LangChain unless blocked
- Correcting five grammar points in one turn
- Putting Korean in TTS
- Claiming pronunciation scoring that does not exist
