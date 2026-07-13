-- Issue 5: add display_name to users table
-- Run in Supabase SQL Editor. Safe to re-run (IF NOT EXISTS guard).

ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name text;
