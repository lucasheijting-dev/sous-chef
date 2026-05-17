-- v10: receipts table + receipt-images storage bucket

CREATE TABLE IF NOT EXISTS receipts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  store       text,
  date        date,
  total       numeric(10, 2),
  currency    text DEFAULT 'EUR',
  items       jsonb DEFAULT '[]',
  category    text,
  description text,
  image_url   text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS receipts_user_id_idx ON receipts(user_id);
CREATE INDEX IF NOT EXISTS receipts_date_idx ON receipts(date);

-- Storage bucket (run in Supabase dashboard Storage tab if not using CLI)
-- Bucket name: receipt-images
-- Public: true
