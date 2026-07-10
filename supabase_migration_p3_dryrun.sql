-- Phase 3 dry-run: shows all duplicate default-list pairs without changing anything.
-- Run this in Supabase SQL Editor. Share the output before running the merge migration.

WITH candidates AS (
  SELECT
    id, user_id, name, emoji, default_type, is_default, created_at,
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
  SELECT user_id, resolved_type
  FROM candidates
  GROUP BY user_id, resolved_type
  HAVING count(*) > 1
)
SELECT
  c.user_id,
  c.resolved_type,
  c.id,
  c.name,
  c.default_type,
  c.is_default,
  c.created_at,
  CASE
    WHEN c.created_at = MIN(c.created_at) OVER (PARTITION BY c.user_id, c.resolved_type)
      THEN 'WINNER (keep)'
    ELSE 'LOSER (soft-delete)'
  END AS action,
  CASE
    WHEN c.created_at = MIN(c.created_at) OVER (PARTITION BY c.user_id, c.resolved_type)
      AND c.default_type IS NULL
      THEN 'promote → ' || c.resolved_type
    ELSE ''
  END AS extra_action
FROM candidates c
JOIN dup_groups g ON g.user_id = c.user_id AND g.resolved_type = c.resolved_type
ORDER BY c.user_id, c.resolved_type, c.created_at;
