-- ── Batch 1 Migration ─────────────────────────────────────────────────────────
-- Features: B1 verbosity, B5 quantity, B8 onboarding, C1 habit grace, D2 birth_year, E5 feedback

-- B1 — Verbosity preference on user_prefs
ALTER TABLE user_prefs
  ADD COLUMN IF NOT EXISTS reply_verbosity text CHECK (reply_verbosity IN ('verbose', 'compact')) DEFAULT NULL;

-- B8 — Onboarding messages seen tracking (unused for now; message_count used instead)
ALTER TABLE user_prefs
  ADD COLUMN IF NOT EXISTS onboarding_messages_seen int DEFAULT 0;

-- B5 — Quantity field on list_items
ALTER TABLE list_items
  ADD COLUMN IF NOT EXISTS quantity text;

-- D2 — Birth year on events (for birthday age display)
ALTER TABLE events
  ADD COLUMN IF NOT EXISTS birth_year int;

-- E5 — Feedback table
CREATE TABLE IF NOT EXISTS feedback (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id) ON DELETE CASCADE,
  text        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS feedback_user_id_idx ON feedback (user_id);
CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at DESC);

-- Row-level security for feedback (optional but recommended)
ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "Users can insert their own feedback"
  ON feedback FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY IF NOT EXISTS "Service role can read all feedback"
  ON feedback FOR SELECT
  USING (true);
