-- Sous-Chef Schema v2 — Run this after v1 in the Supabase SQL editor
-- Each statement uses IF NOT EXISTS / IF EXISTS so it's safe to re-run.

-- ── Users: onboarding + context ───────────────────────────────────────────────

alter table users add column if not exists onboarding_completed boolean default false;
alter table users add column if not exists message_count        integer default 0;
alter table users add column if not exists user_context         text    default '';

-- Atomic message count increment (avoids read-modify-write race)
create or replace function increment_user_message_count(uid uuid)
returns void language sql security definer as $$
  update users set message_count = message_count + 1 where id = uid;
$$;

-- ── User Prefs: digest + usage pattern ────────────────────────────────────────

alter table user_prefs add column if not exists digest_enabled      boolean default true;
alter table user_prefs add column if not exists digest_day          integer default 1;   -- 1 = Monday
alter table user_prefs add column if not exists active_hour_counts  jsonb   default '{}';

-- ── Lists: recent-activity sort ───────────────────────────────────────────────

alter table lists add column if not exists last_activity_at timestamptz default now();

create index if not exists lists_activity_idx on lists(user_id, last_activity_at desc);

-- ── Recurring Items ───────────────────────────────────────────────────────────
-- recurrence format: 'daily' | 'weekly:N' (0=Sun…6=Sat) | 'monthly:D' (1-28)

create table if not exists recurring_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references users(id)  on delete cascade,
  list_id     uuid not null references lists(id)  on delete cascade,
  content     text not null,
  recurrence  text not null,
  next_due    date not null,
  created_at  timestamptz default now()
);

create index if not exists recurring_items_due_idx on recurring_items(next_due);

-- ── Shared List Members (schema only — feature disabled) ──────────────────────

create table if not exists shared_list_members (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null references lists(id)  on delete cascade,
  user_id         uuid not null references users(id)  on delete cascade,
  owner_user_id   uuid          references users(id),
  role            text not null default 'viewer'
                  check (role in ('owner', 'editor', 'viewer')),
  invited_at      timestamptz default now(),
  accepted_at     timestamptz,
  unique (list_id, user_id)
);

-- ── RLS for new tables ────────────────────────────────────────────────────────

alter table recurring_items     enable row level security;
alter table shared_list_members enable row level security;

create policy "anon_read_recurring"  on recurring_items     for select using (true);
create policy "anon_read_shared"     on shared_list_members for select using (true);
