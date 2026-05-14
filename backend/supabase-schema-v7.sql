-- v7: geo alert rate limiting
alter table user_prefs add column if not exists geo_alert_last_sent_at timestamptz;
