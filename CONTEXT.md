# CONTEXT.md

Decisions from the originating conversation (2026-09-21, KST).

## User intent

The user wants to speak English, is afraid of mistakes, and asked for an AI that accepts errors and corrects words/pronunciation.

They then asked to design a voice architecture, then to turn it into a real project they can maintain locally and put on a resume with evidence of progress.

They asked for documents other agents can understand.

## Constraints they care about

- Voice in, voice out. Text-only practice is a fallback, not the goal.
- Being wrong must feel safe.
- Work must live on their local machine, not only in this chat.
- The project should produce resume evidence, not just a demo chat.

## Design decisions already made

- Project name: SpeakMentor
- Correction policy: one high-value fix per turn
- Spoken audio = conversation only
- Korean explanation stays on screen
- Track sessions, turns, error types, target-phrase reuse
- v1 is a web app, not iOS
- No phoneme-level scoring in v1
- First meaningful demo: open URL, speak, hear a reply in a few seconds
- Resume impact comes from a 2-week self-log, not from model branding

## Implementation state

Scaffold exists. APIs are stubs. Other agents should wire the pipeline, not restart product discovery unless the user changes direction.

## Handoff to local computer

A zip was produced at `/home/workdir/artifacts/speakmentor.zip`.
The user was told to unzip, `npm install`, `npm run dev`, then `git init`.

If you continue in a sandbox, keep working under `speakmentor/` and refresh the zip after meaningful file changes.
