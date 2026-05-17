-- Piece 2: CalDAV migration schema
-- Run in Supabase SQL editor

-- Store CalDAV credentials per user
alter table users add column if not exists caldav_username text;
alter table users add column if not exists caldav_password text;

-- Track which CalDAV calendar an event belongs to + its UID for deletion
alter table events add column if not exists caldav_uid text;
alter table events add column if not exists calendar_stream text default 'personal';
