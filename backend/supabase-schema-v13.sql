-- v13: push reminder column on events + OTP auth table

-- 30-min-before push reminder (separate from WhatsApp reminder_sent_at)
alter table events add column if not exists push_reminder_sent_at timestamptz;

-- OTP codes for WhatsApp-based login
create table if not exists otp_codes (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  code         text not null,
  expires_at   timestamptz not null,
  used         boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Clean up expired codes automatically
create index if not exists otp_codes_phone_idx on otp_codes(phone);
create index if not exists otp_codes_expires_idx on otp_codes(expires_at);
