-- Run this in Supabase SQL editor.

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  topic text not null default 'free talk',
  level text not null default 'A2',
  created_at timestamptz not null default now()
);

create table if not exists turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  audio_path text,
  transcript text,
  transcript_cleaned text,
  corrected text,
  reply_en text,
  reply_audio_path text,
  coach_note_ko text,
  target_phrase text,
  created_at timestamptz not null default now()
);

create table if not exists errors (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null references turns(id) on delete cascade,
  span text,
  type text,
  fix text
);

create index if not exists turns_session_idx on turns(session_id);
create index if not exists errors_turn_idx on errors(turn_id);

-- Phrases extracted from real conversation. This is the "memorize and reuse"
-- layer: the tutor draws from it, the review page drills it.
create table if not exists phrase_bank (
  id uuid primary key default gen_random_uuid(),
  phrase text not null,
  ko_note text,
  source_turn_id uuid references turns(id) on delete set null,
  first_seen timestamptz not null default now(),
  last_used timestamptz,
  times_seen int not null default 0,
  times_correct int not null default 0,
  -- SM-2 spaced repetition (safe to run on an existing table: ADD COLUMN IF NOT EXISTS)
  ease real not null default 2.5,
  interval_days int not null default 0,
  due_at timestamptz not null default now()
);

-- Migration for phrase_bank tables created before SM-2:
alter table phrase_bank add column if not exists ease real not null default 2.5;
alter table phrase_bank add column if not exists interval_days int not null default 0;
alter table phrase_bank add column if not exists due_at timestamptz not null default now();

create unique index if not exists phrase_bank_phrase_idx on phrase_bank (lower(phrase));

-- Jev decision pass (2026-09-23): per-turn score and next-turn difficulty
alter table turns add column if not exists jev_score real;
alter table turns add column if not exists next_difficulty text;

-- Multi-user (2026-09-23): per-account ownership
alter table sessions add column if not exists user_id uuid;
alter table turns add column if not exists user_id uuid;
alter table phrase_bank add column if not exists user_id uuid;
create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  password_hash text not null,
  salt text not null,
  role text not null default 'user',
  created_at timestamptz not null default now()
);
create table if not exists auth_sessions (
  token text primary key,
  user_id uuid references app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table turns add column if not exists jev_grammar real;
alter table turns add column if not exists jev_vocab real;
alter table turns add column if not exists next_angle text;
alter table turns add column if not exists next_focus text;
