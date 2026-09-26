# SpeakMentor

Voice-first English conversation tutor.

You speak. The app transcribes, corrects vocabulary and phrasing, gives pronunciation notes, replies in natural spoken English, and stores progress you can show later.

This repo is the project record: product scope, architecture, MVP, metrics, and resume framing.

If you are another coding agent, start with `AGENTS.md`, then `CONTEXT.md` and `TASKS.md`.

## Why this project

Most English apps are drills or chatboxes. SpeakMentor is a **speech loop**:

1. User speaks
2. Speech-to-text
3. Tutor model corrects and continues the conversation
4. Text-to-speech reply
5. Session + error history saved

That pipeline is a strong portfolio piece because it combines product thinking, AI orchestration, and measurable learning outcomes.

## Problem

Learners want to talk, but they freeze because they are afraid of mistakes. Text chat is safer, but it does not train speaking. Human tutors are expensive and hard to schedule.

## Solution (MVP)

A 1-button practice session:

- Hold to talk (or upload a short clip)
- Get back:
  - transcript
  - corrected sentence
  - 1–2 natural alternatives
  - one pronunciation tip
  - spoken follow-up question
- History page with weekly stats

## Target user

Korean learners who can read some English but avoid speaking. First language UI can be Korean; practice language is English.

## Success for a resume

Do not present this as “I used ChatGPT.” Present it as a shipped learning product:

- Designed a speech-in / speech-out tutoring loop
- Built an evaluation layer (errors, replacements, reuse of target phrases)
- Tracked learner progress across sessions
- Shipped a demo people can click

## Repo map

- `AGENTS.md` — start here if you are another coding agent
- `CONTEXT.md` — decisions already made
- `TASKS.md` — next implementation checklist
- `docs/HANDOFF.md` — short handoff
- `ARCHITECTURE.md` — system design
- `ROADMAP.md` — phases and what to demo
- `PRODUCT.md` — UX, correction policy, metrics
- `prompts/` — tutor prompt spec
- `src/app` — Next.js UI (practice / review / stats / history) + API routes
- `supabase/schema.sql` — tables

## Run on your computer

1. Download `speakmentor.zip` from this chat and unzip.
2. Install Node.js 20+.
3. In a terminal:

```bash
cd speakmentor
cp .env.example .env.local
npm install
npm run dev
```

4. Open http://localhost:3000

## Deployed at https://speak.yndl.dev

Runs on the Mac mini as a Docker container (`speakmentor`) behind the existing
Cloudflare Tunnel + Caddy (labels-based, same pattern as the other sites):

- `https://speak.yndl.dev` — Basic Auth protected (see project `.env.local`)
- Update: `cd` to the project, `docker build -t speakmentor-app .`, then
  re-run the container (same flags as in the shell history / TASKS.md)
- TTS: kokoro container on `proxy_net` (`kokoro-tts:8880`, ONNX mode)
- Recordings + db persist in `./data` (bind-mounted to `/app/data`)
- Note: OrbStack VM memory was raised 1536MB -> 6144MB (`~/.orbstack/vmconfig.json`,
  backup at `vmconfig.json.bak`) so kokoro fits — it needs ~1GB to load

5. Optional: create a free Supabase project, run `supabase/schema.sql`, paste keys into `.env.local`.

6. When you want Git history on your machine:

```bash
cd speakmentor
git init
git add .
git commit -m "Initial SpeakMentor scaffold"
```

Then create an empty GitHub repo and push.

## What works today

- **Live voice practice** (`/`): Chrome/Edge uses the built-in Web Speech API,
  so your sentence appears on screen while you speak and is sent automatically
  when you pause — no API key needed. Firefox falls back to record-then-upload
  (Whisper). Type your sentence instead if the mic is unavailable.
- **Correction cards**: transcript, one high-value fix, Korean coach note,
  pronunciation tip, spoken English follow-up.
- **Phrase review** (`/review`): SM-2 spaced repetition on phrases taken from
  your real conversations.
- **Stats** (`/stats`): weekly sessions, turns, speaking minutes, error-type
  chart, and target-phrase reuse rate — the numbers for your resume case study.
- **History** (`/history`): replay any past session.

Without an API key a rule-based demo tutor runs so you can try the loop
immediately. Add `OPENAI_API_KEY` to `.env.local` for GPT corrections and
Whisper STT. For a natural tutor voice, run kokoro TTS locally (see
`.env.example` for the one-line Docker command) — otherwise the browser's
built-in voice is used. Recorded audio auto-deletes after
`AUDIO_RETENTION_DAYS` (default 14).
