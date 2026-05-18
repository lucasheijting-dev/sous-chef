-- Sous-Chef Schema v12 — Run this in the Supabase SQL editor
-- Adds user profile fields that Claude uses as context.

alter table user_prefs add column if not exists profile_birth_year int;
alter table user_prefs add column if not exists profile_employer   text;
alter table user_prefs add column if not exists profile_friends    text;  -- comma-separated names
alter table user_prefs add column if not exists profile_extra      text;  -- free-form context (hobbies, notes, etc.)
