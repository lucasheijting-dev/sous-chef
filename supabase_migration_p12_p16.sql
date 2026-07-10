-- Migration: P12 (FK cascade) + P16 (unique default lists)
-- Run in Supabase SQL Editor

-- P12: FK CASCADE on list children so hard-deleting a list also removes children
-- (These may already exist; IF NOT EXISTS guards make this safe to re-run)
ALTER TABLE list_items
  DROP CONSTRAINT IF EXISTS list_items_list_id_fkey;
ALTER TABLE list_items
  ADD CONSTRAINT list_items_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;

ALTER TABLE list_members
  DROP CONSTRAINT IF EXISTS list_members_list_id_fkey;
ALTER TABLE list_members
  ADD CONSTRAINT list_members_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;

ALTER TABLE list_share_invites
  DROP CONSTRAINT IF EXISTS list_share_invites_list_id_fkey;
ALTER TABLE list_share_invites
  ADD CONSTRAINT list_share_invites_list_id_fkey
    FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE;

-- P16: Prevent duplicate default lists per user
-- WHERE clause means: a deleted default can be recreated (soft-delete safe)
CREATE UNIQUE INDEX IF NOT EXISTS lists_default_unique
  ON lists (user_id, default_type)
  WHERE default_type IS NOT NULL AND deleted_at IS NULL;
