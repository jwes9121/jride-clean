-- Applied to JRide-prod as migration 20260831013527.
-- This table separates server-resolved GPS municipality from legacy
-- client-reported driver_locations.town. Ride assignment will switch to
-- this cache only after GPS resolution is verified in production.

create table if not exists public.driver_gps_town_resolutions (
  driver_id uuid primary key references public.drivers(id) on delete cascade,
  current_town text,
  raw_place_name text,
  source_lat double precision not null,
  source_lng double precision not null,
  resolved_at timestamptz not null default now(),
  source text not null default 'mapbox_place',
  updated_at timestamptz not null default now(),
  constraint driver_gps_town_resolutions_source_check
    check (source in ('mapbox_place','mapbox_context','legacy_seed'))
);

create index if not exists driver_gps_town_resolutions_resolved_at_idx
  on public.driver_gps_town_resolutions(resolved_at desc);

alter table public.driver_gps_town_resolutions enable row level security;

revoke all on public.driver_gps_town_resolutions
from public, anon, authenticated;

grant all on public.driver_gps_town_resolutions
to service_role;