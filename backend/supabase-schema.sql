-- Sous-Chef Database Schema
-- Run this in the Supabase SQL editor (supabase.com → project → SQL editor)

-- ── Users ──────────────────────────────────────────────────────────────────

create table if not exists users (
  id          uuid primary key default gen_random_uuid(),
  whatsapp_number text unique not null,
  created_at  timestamptz default now()
);

-- ── User Preferences ──────────────────────────────────────────────────────

create table if not exists user_prefs (
  user_id             uuid primary key references users(id) on delete cascade,
  habits_enabled      boolean default false,
  habits_reminder_time time default '20:00:00',
  suggestions_enabled boolean default true,
  suggestions_frequency text default 'weekly' check (suggestions_frequency in ('daily', 'weekly', 'never'))
);

-- ── Lists ──────────────────────────────────────────────────────────────────

create table if not exists lists (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  emoji      text default '📝',
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists lists_user_id_idx on lists(user_id);

-- ── List Items ─────────────────────────────────────────────────────────────

create table if not exists list_items (
  id         uuid primary key default gen_random_uuid(),
  list_id    uuid not null references lists(id) on delete cascade,
  text       text not null,
  checked    boolean default false,
  created_at timestamptz default now()
);

create index if not exists list_items_list_id_idx on list_items(list_id);

-- ── Notes ──────────────────────────────────────────────────────────────────

create table if not exists notes (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  title      text,
  body       text not null,
  created_at timestamptz default now()
);

create index if not exists notes_user_id_idx on notes(user_id);

-- ── Events ─────────────────────────────────────────────────────────────────

create table if not exists events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references users(id) on delete cascade,
  title               text not null,
  date                date,
  recurrence          text check (recurrence in ('yearly', 'monthly', 'weekly', null)),
  reminder_days_before int default 1,
  created_at          timestamptz default now()
);

create index if not exists events_user_id_idx on events(user_id);

-- ── Habits ─────────────────────────────────────────────────────────────────

create table if not exists habits (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  name       text not null,
  mini_goal  text not null,
  good_goal  text not null,
  elite_goal text not null,
  is_active  boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

create index if not exists habits_user_id_idx on habits(user_id);

-- ── Habit Logs ─────────────────────────────────────────────────────────────

create table if not exists habit_logs (
  id         uuid primary key default gen_random_uuid(),
  habit_id   uuid not null references habits(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  date       date not null,
  level      text check (level in ('mini', 'good', 'elite')),
  logged_at  timestamptz default now(),

  -- one log per habit per day
  unique (habit_id, date)
);

create index if not exists habit_logs_user_id_date_idx on habit_logs(user_id, date);

-- ── Messages Log ───────────────────────────────────────────────────────────

create table if not exists messages_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete set null,
  raw_text     text,
  category     text,
  processed_at timestamptz default now()
);

-- ── Row Level Security ─────────────────────────────────────────────────────
-- The backend uses the service_role key which bypasses RLS.
-- These policies protect the data if you ever expose the anon key client-side.

alter table users          enable row level security;
alter table user_prefs     enable row level security;
alter table lists          enable row level security;
alter table list_items     enable row level security;
alter table notes          enable row level security;
alter table events         enable row level security;
alter table habits         enable row level security;
alter table habit_logs     enable row level security;
alter table messages_log   enable row level security;

-- Service role bypasses all RLS — no policies needed for backend-only access.
-- The React Native app uses the anon key, so it needs these read policies.
-- Run this block in the Supabase SQL editor to enable the mobile app.

create policy "anon_read_users"      on users      for select using (true);
create policy "anon_read_user_prefs" on user_prefs for select using (true);
create policy "anon_read_lists"      on lists      for select using (true);
create policy "anon_read_list_items" on list_items for select using (true);
create policy "anon_read_notes"      on notes      for select using (true);
create policy "anon_read_events"     on events     for select using (true);
create policy "anon_read_habits"     on habits     for select using (true);
create policy "anon_read_habit_logs" on habit_logs for select using (true);

-- Write policies for the app (checking/unchecking items, logging habits, updating prefs)
create policy "anon_write_list_items" on list_items for all using (true);
create policy "anon_write_habit_logs" on habit_logs for all using (true);
create policy "anon_write_user_prefs" on user_prefs for all using (true);
