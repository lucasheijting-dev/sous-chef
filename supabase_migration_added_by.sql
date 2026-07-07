-- Migration: added_by_user_id on list_items
-- Run in Supabase SQL Editor

ALTER TABLE list_items ADD COLUMN IF NOT EXISTS added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_list_items_added_by ON list_items(added_by_user_id) WHERE added_by_user_id IS NOT NULL;
