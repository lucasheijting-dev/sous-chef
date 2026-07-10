-- Phase 3 migration: merge duplicate default lists, then lock with unique index.
-- Run ONLY after reviewing dry-run output from supabase_migration_p3_dryrun.sql.
-- Safe to re-run: step 1 only affects untyped winners, step 2 only affects undeleted losers.

-- ── Step 1: Promote untyped winners (oldest row per duplicate group) ──────────

WITH candidates AS (
  SELECT
    id, user_id, name, default_type, created_at,
    CASE
      WHEN default_type = 'groceries'              THEN 'groceries'
      WHEN default_type = 'todo'                   THEN 'todo'
      WHEN lower(name) LIKE '%boodschappen%'       THEN 'groceries'
      WHEN lower(name) ~ '^to-?do$'               THEN 'todo'
    END AS resolved_type
  FROM lists
  WHERE deleted_at IS NULL
    AND (
      default_type IN ('groceries', 'todo')
      OR (default_type IS NULL
          AND (lower(name) LIKE '%boodschappen%' OR lower(name) ~ '^to-?do$'))
    )
),
dup_groups AS (
  SELECT user_id, resolved_type FROM candidates
  GROUP BY user_id, resolved_type HAVING count(*) > 1
),
winners AS (
  SELECT DISTINCT ON (c.user_id, c.resolved_type) c.id, c.resolved_type, c.default_type
  FROM candidates c
  JOIN dup_groups g ON g.user_id = c.user_id AND g.resolved_type = c.resolved_type
  ORDER BY c.user_id, c.resolved_type, c.created_at ASC
)
UPDATE lists SET
  default_type = w.resolved_type::text,
  is_default   = true
FROM winners w
WHERE lists.id = w.id
  AND w.default_type IS NULL;

-- ── Step 2: Soft-delete all losers (non-oldest rows per duplicate group) ──────

WITH candidates AS (
  SELECT
    id, user_id, name, default_type, created_at,
    CASE
      WHEN default_type = 'groceries'              THEN 'groceries'
      WHEN default_type = 'todo'                   THEN 'todo'
      WHEN lower(name) LIKE '%boodschappen%'       THEN 'groceries'
      WHEN lower(name) ~ '^to-?do$'               THEN 'todo'
    END AS resolved_type
  FROM lists
  WHERE deleted_at IS NULL
    AND (
      default_type IN ('groceries', 'todo')
      OR (default_type IS NULL
          AND (lower(name) LIKE '%boodschappen%' OR lower(name) ~ '^to-?do$'))
    )
),
dup_groups AS (
  SELECT user_id, resolved_type FROM candidates
  GROUP BY user_id, resolved_type HAVING count(*) > 1
),
winners AS (
  SELECT DISTINCT ON (c.user_id, c.resolved_type) c.id
  FROM candidates c
  JOIN dup_groups g ON g.user_id = c.user_id AND g.resolved_type = c.resolved_type
  ORDER BY c.user_id, c.resolved_type, c.created_at ASC
),
losers AS (
  SELECT c.id FROM candidates c
  JOIN dup_groups g ON g.user_id = c.user_id AND g.resolved_type = c.resolved_type
  WHERE c.id NOT IN (SELECT id FROM winners)
)
UPDATE lists SET deleted_at = now()
FROM losers
WHERE lists.id = losers.id;

-- ── Step 3: FK CASCADE constraints (safe to re-run) ──────────────────────────

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

-- ── Step 4: Unique partial index — one live typed default per user ────────────
-- Must run AFTER the merge so no duplicate typed rows remain to violate it.

CREATE UNIQUE INDEX IF NOT EXISTS lists_default_unique
  ON lists (user_id, default_type)
  WHERE default_type IS NOT NULL AND deleted_at IS NULL;
