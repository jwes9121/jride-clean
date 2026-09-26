-- JRIDE_TAKEOUT_CASH_FIRST_AMOUNT_GUARD_V1
-- Records the actual vendor-purchase cash received on customer-cash-first Takeout.
-- Historical rows are intentionally left null because the previous workflow could
-- collect the full total up front.

alter table public.bookings
  add column if not exists takeout_cash_collected_amount numeric,
  add column if not exists takeout_cash_collected_at timestamptz;
