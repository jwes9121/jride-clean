-- JRIDE_DRIVER_STANDBY_DISPATCH_V1
-- Standby coordinates are deliberately stored outside driver_locations.
-- They must never refresh the live GPS timestamp or create GPS observations.

create table if not exists public.driver_standby_sessions (
  driver_id uuid primary key,
  home_lat numeric not null,
  home_lng numeric not null,
  town text not null,
  address_hint text,
  confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_reason text,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint driver_standby_home_lat_valid
    check (home_lat between -90 and 90),
  constraint driver_standby_home_lng_valid
    check (home_lng between -180 and 180),
  constraint driver_standby_town_nonempty
    check (length(btrim(town)) > 0),
  constraint driver_standby_expiry_after_confirmation
    check (expires_at > confirmed_at)
);

create index if not exists driver_standby_sessions_expires_idx
  on public.driver_standby_sessions (expires_at);

alter table public.driver_standby_sessions enable row level security;

revoke all on table public.driver_standby_sessions from anon, authenticated;
grant all on table public.driver_standby_sessions to service_role;

comment on table public.driver_standby_sessions is
  'Explicit, short-lived saved-home standby positions for initial dispatch only. Never live GPS.';
comment on column public.driver_standby_sessions.confirmed_at is
  'Driver explicit confirmation time. Any later accepted driver_locations.updated_at supersedes this standby.';
comment on column public.driver_standby_sessions.consumed_at is
  'Set after a successful initial assignment/offer that used this standby position.';
