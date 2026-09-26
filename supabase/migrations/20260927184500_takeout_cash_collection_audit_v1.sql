-- JRIDE_TAKEOUT_CASH_COLLECTION_AUDIT_V1
-- Additive Takeout-only audit fields. Older APKs remain compatible.
alter table public.bookings
  add column if not exists takeout_cash_first_collected_amount numeric,
  add column if not exists takeout_cash_first_collected_at timestamptz,
  add column if not exists takeout_final_collected_amount numeric,
  add column if not exists takeout_final_collected_at timestamptz;
