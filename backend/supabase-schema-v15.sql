-- v15: OTP codes table + onboarding state columns
-- Run this in Supabase SQL editor

CREATE TABLE IF NOT EXISTS otp_codes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone      text        NOT NULL,
  code       text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used       boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS otp_codes_phone_used_idx ON otp_codes (phone, used);

ALTER TABLE user_prefs
  ADD COLUMN IF NOT EXISTS onboarding_step text DEFAULT '0',
  ADD COLUMN IF NOT EXISTS onboarding_name text;
