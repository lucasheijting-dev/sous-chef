-- v8: list types + calendar streams

-- List types
alter table lists add column if not exists list_type text default 'checklist' check (list_type in ('checklist', 'links', 'tips'));

-- Calendar streams per user
create table if not exists calendar_streams (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,
  emoji text default '📅',
  color text default '#4A90D8',
  caldav_id text not null,
  claude_key text not null,
  sort_order int default 0,
  created_at timestamptz default now()
);
create index if not exists calendar_streams_user_id_idx on calendar_streams(user_id);
alter table calendar_streams enable row level security;
create policy "anon_read_calendar_streams" on calendar_streams for select using (true);
create policy "anon_write_calendar_streams" on calendar_streams for all using (true);
