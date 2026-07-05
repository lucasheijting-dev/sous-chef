-- Migration: Soft-delete (E1)
-- Run in Supabase SQL Editor

-- Add deleted_at to all major tables
ALTER TABLE lists       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE list_items  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE notes       ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE events      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE habits      ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
ALTER TABLE receipts    ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Indexes for efficient soft-delete filtering
CREATE INDEX IF NOT EXISTS idx_lists_deleted_at      ON lists(deleted_at)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_list_items_deleted_at ON list_items(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_notes_deleted_at      ON notes(deleted_at)      WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_events_deleted_at     ON events(deleted_at)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_habits_deleted_at     ON habits(deleted_at)     WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_receipts_deleted_at   ON receipts(deleted_at)   WHERE deleted_at IS NULL;

-- Hard-delete cleanup: runs daily via pg_cron (Supabase Pro) or via our cron
-- Or run manually: DELETE FROM lists WHERE deleted_at < NOW() - INTERVAL '30 days';
