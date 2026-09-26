# Architecture

## High-level loop

```
Mic / uploaded audio
        │
        ▼
   ┌─────────┐
   │   STT   │  Whisper-class model
   └────┬────┘
        │ transcript + optional word timestamps
        ▼
   ┌─────────────────────┐
   │ Tutor orchestrator  │
   │  - classify intent  │
   │  - score utterance  │
   │  - correct language │
   │  - pick next turn   │
   │  - write analytics  │
   └──────────┬──────────┘
              │
     ┌────────┴────────┐
     ▼                 ▼
┌─────────┐      ┌──────────┐
│   TTS   │      │ Database │
│ spoken  │      │ sessions │
│ reply   │      │ errors   │
└─────────┘      │ phrases  │
                 └──────────┘
```

## Components

### 1. Client
- Record with MediaRecorder (web) or AVAudioRecorder (iOS later)
- Upload audio + session id
- Play tutor audio
- Show transcript, correction card, next prompt
- Auth + history

Recommended first client: **Next.js** web app. Fastest to demo on a resume.

### 2. API
Thin backend. Do not hide all logic in one giant prompt.

Endpoints for MVP:

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/sessions` | start session (topic, level) |
| POST | `/api/turns` | upload audio, run pipeline, return JSON + audio URL |
| GET | `/api/sessions/:id` | replay one session |
| GET | `/api/stats` | weekly accuracy / streak / target phrases |

### 3. STT
- Start with hosted Whisper (OpenAI, Groq, or equivalent)
- Save raw audio + transcript
- Keep word-level timestamps if the vendor gives them; useful later for pronunciation highlighting

### 4. Tutor engine
One structured LLM call per turn. Force JSON out.

```json
{
  "transcript_cleaned": "",
  "level_estimate": "A2",
  "errors": [
    { "span": "I go yesterday", "type": "tense", "fix": "I went yesterday" }
  ],
  "natural_versions": ["I went there yesterday."],
  "pronunciation_tip": {
    "focus_word": "yesterday",
    "note": "Stress the first syllable: YES-ter-day"
  },
  "coach_note_ko": "시제가 과거로 바뀌어야 해요.",
  "reply_en": "Nice. Where did you go yesterday?",
  "target_phrase_for_next_turn": "I went to ..."
}
```

Separate **conversation reply** from **teaching note**.  
If you mix them, the spoken audio becomes a lecture.

Spoken audio should be only `reply_en` (short).  
Teaching notes stay on screen.

### 5. TTS
- Generate `reply_en` only
- Store mp3/wav URL on the turn
- Same voice every session so it feels like one tutor

### 6. Data model

```
users
  id, created_at, native_language, level

sessions
  id, user_id, topic, started_at, ended_at, turn_count

turns
  id, session_id, audio_url, transcript, corrected, reply_text, reply_audio_url, created_at

errors
  id, turn_id, type, original, fix

phrase_bank
  id, user_id, phrase, first_seen, last_used, times_correct
```

This table set is what makes it a **product**, not a chatbot wrapper. Progress is queryable.

## Suggested stack (resume-friendly, shippable)

| Layer | Choice | Why |
|-------|--------|-----|
| Web | Next.js + TypeScript | Easy demo URL |
| API | Next.js route handlers or FastAPI | FastAPI looks stronger if you want backend credit |
| DB / auth / storage | Supabase | Auth + Postgres + audio storage in one |
| STT | Whisper API | Standard, easy to explain |
| LLM | Grok or OpenAI | JSON mode + tutoring prompt |
| TTS | OpenAI TTS / ElevenLabs / existing Voice pipeline | Natural English |
| Hosting | Vercel + Supabase | One-weekend deploy |

Alternative “I built infrastructure” version: FastAPI + Redis queue + S3. Only do this if you want backend depth on the resume.

## Correction policy (product rule)

Do not correct everything.

1. Keep the conversation moving
2. Fix **one high-value issue** per turn
3. Ask the user to reuse the corrected phrase in the next answer
4. If the user is frozen, switch to a yes/no or two-option prompt

This policy is a design decision. Write it in the README. Interviewers like it.

## Latency budget

Target perceived wait under 4–6 seconds for MVP.

- STT streaming if possible
- LLM max tokens small (JSON only, short reply)
- TTS on reply sentence only
- Show transcript first, audio a second later

## Privacy

Audio is personal. For a portfolio demo:

- Allow guest mode
- Auto-delete audio after N days
- Store transcripts by default, audio optional
- Do not train on user audio unless you say so

## What not to build in v1

- Full phoneme-level pronunciation scoring
- Mobile native app
- Marketplace of human tutors
- Live interruption / duplex voice like a phone call

Those are v2+ and they blow the timeline.
