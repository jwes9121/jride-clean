-- =========================================================
-- JRIDE Phase 2 - Dispatch Audit Log (dispatch_events)
-- Safe: no dependency on existing booking schema columns.
-- =========================================================

-- Ensure pgcrypto exists for gen_random_uuid (Supabase usually has it)
create extension if not exists pgcrypto;

create table if not exists public.dispatch_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- action: 'assign' | 'reassign' | 'status' | 'emergency' | 'nudge' | etc
  action text not null,

  -- booking identity (either/both may be present)
  booking_id uuid null,
  booking_code text null,

  -- driver identity (optional)
  driver_id uuid null,

  -- for status updates (optional)
  status text null,

  -- who triggered it (optional: dispatcher/admin name/email/id)
  actor text null,

  -- where it came from (optional)
  source text null,

  -- flexible extra info
  meta jsonb null default '{}'::jsonb
);

-- Helpful indexes
create index if not exists dispatch_events_created_at_idx
  on public.dispatch_events (created_at desc);

create index if not exists dispatch_events_booking_id_idx
  on public.dispatch_events (booking_id);

create index if not exists dispatch_events_booking_code_idx
  on public.dispatch_events (booking_code);

create index if not exists dispatch_events_action_idx
  on public.dispatch_events (action);

create index if not exists dispatch_events_driver_id_idx
  on public.dispatch_events (driver_id);

-- Optional: lightweight RLS (leave OFF for now if you’re testing fast)
-- alter table public.dispatch_events enable row level security;
-- (Add policies later once you confirm admin access patterns)
