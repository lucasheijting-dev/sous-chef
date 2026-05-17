-- Piece 7: CalDAV error handling — sync queue
-- Run in Supabase SQL editor

create table if not exists caldav_sync_queue (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references users(id) on delete cascade,
  operation    text not null,  -- 'create_event' | 'delete_event'
  payload      jsonb not null,
  attempts     int  not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  next_retry_at timestamptz not null default now()
);

create index if not exists caldav_sync_queue_retry_idx on caldav_sync_queue(next_retry_at) where attempts < 5;
