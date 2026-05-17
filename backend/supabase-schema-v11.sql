-- v11: receipt categories

CREATE TABLE IF NOT EXISTS receipt_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  emoji      text DEFAULT '📁',
  color      text DEFAULT '#4A90D8',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipt_categories_user_id_idx ON receipt_categories(user_id);

ALTER TABLE receipts ADD COLUMN IF NOT EXISTS receipt_category_id uuid REFERENCES receipt_categories(id) ON DELETE SET NULL;
