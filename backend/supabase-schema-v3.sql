-- Sous-Chef Schema v3 — Run after v1 and v2 in the Supabase SQL editor

-- ── Reminders: track sent state ───────────────────────────────────────────────

alter table events add column if not exists reminder_sent_at timestamptz;

-- ── Suggestions + context freshness ──────────────────────────────────────────

alter table user_prefs add column if not exists suggestion_last_sent_at  timestamptz;
alter table user_prefs add column if not exists context_last_built_at    timestamptz;
