-- v9: add push_token to users for instant calendar sync
ALTER TABLE users ADD COLUMN IF NOT EXISTS push_token text;
