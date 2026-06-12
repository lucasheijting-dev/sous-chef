-- v14: Multi-provider calendar support (Google Calendar + Microsoft Outlook)
-- Run this in Supabase SQL editor

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS calendar_provider text,
  ADD COLUMN IF NOT EXISTS google_access_token text,
  ADD COLUMN IF NOT EXISTS google_refresh_token text,
  ADD COLUMN IF NOT EXISTS google_token_expiry timestamptz,
  ADD COLUMN IF NOT EXISTS ms_access_token text,
  ADD COLUMN IF NOT EXISTS ms_refresh_token text,
  ADD COLUMN IF NOT EXISTS ms_token_expiry timestamptz;

-- Backfill: existing CalDAV users get 'iphone' as their provider
UPDATE users SET calendar_provider = 'iphone' WHERE caldav_username IS NOT NULL AND calendar_provider IS NULL;
