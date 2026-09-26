-- Applied to JRide-prod as migration 20260926020554.
-- Immutable verification-time location snapshots for identity/fraud review.
-- Device geolocation and network region are review signals only, not proof of presence.
-- Raw IP addresses are intentionally not stored.

create table if not exists public.passenger_verification_submission_locations (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null,
  request_submitted_at timestamptz not null,
  server_received_at timestamptz not null default now(),
  device_status text not null,
  device_source text not null,
  device_latitude double precision,
  device_longitude double precision,
  device_accuracy_m double precision,
  device_captured_at timestamptz,
  declared_town text,
  network_city text,
  network_region text,
  network_country text,
  constraint passenger_verification_submission_locations_request_key
    unique (passenger_id, request_submitted_at),
  constraint passenger_verification_submission_locations_status_check
    check (device_status in ('captured','denied','unavailable','timeout','error','not_provided')),
  constraint passenger_verification_submission_locations_source_check
    check (device_source in ('browser_geolocation','client_geolocation')),
  constraint passenger_verification_submission_locations_lat_check
    check (device_latitude is null or device_latitude between -90 and 90),
  constraint passenger_verification_submission_locations_lng_check
    check (device_longitude is null or device_longitude between -180 and 180),
  constraint passenger_verification_submission_locations_accuracy_check
    check (device_accuracy_m is null or (device_accuracy_m >= 0 and device_accuracy_m <= 100000)),
  constraint passenger_verification_submission_locations_coordinate_pair_check
    check ((device_latitude is null) = (device_longitude is null)),
  constraint passenger_verification_submission_locations_capture_check
    check (
      (device_status = 'captured' and device_latitude is not null and device_longitude is not null)
      or
      (device_status <> 'captured' and device_latitude is null and device_longitude is null)
    )
);

create index if not exists passenger_verification_submission_locations_passenger_submitted_idx
  on public.passenger_verification_submission_locations(passenger_id, request_submitted_at desc);

create index if not exists passenger_verification_submission_locations_received_idx
  on public.passenger_verification_submission_locations(server_received_at desc);

alter table public.passenger_verification_submission_locations enable row level security;

revoke all on public.passenger_verification_submission_locations from public, anon, authenticated;
revoke update, delete on public.passenger_verification_submission_locations from service_role;
grant select, insert on public.passenger_verification_submission_locations to service_role;

create or replace function public.prevent_passenger_verification_submission_location_mutation()
returns trigger
language plpgsql
set search_path = 'public'
as $$
begin
  raise exception 'Verification submission location snapshots are immutable';
end;
$$;

revoke all on function public.prevent_passenger_verification_submission_location_mutation()
from public, anon, authenticated;

drop trigger if exists trg_prevent_passenger_verification_submission_location_mutation
  on public.passenger_verification_submission_locations;

create trigger trg_prevent_passenger_verification_submission_location_mutation
before update or delete
on public.passenger_verification_submission_locations
for each row
execute function public.prevent_passenger_verification_submission_location_mutation();

create or replace view public.passenger_verification_latest_location_v1
with (security_invoker = true, security_barrier = true)
as
select
  l.passenger_id,
  l.request_submitted_at,
  l.server_received_at,
  l.device_status,
  l.device_source,
  l.device_latitude,
  l.device_longitude,
  l.device_accuracy_m,
  l.device_captured_at,
  l.declared_town,
  l.network_city,
  l.network_region,
  l.network_country
from public.passenger_verification_submission_locations l
join public.passenger_verification_requests r
  on r.passenger_id = l.passenger_id
 and r.submitted_at = l.request_submitted_at;

revoke all on public.passenger_verification_latest_location_v1 from public, anon, authenticated;
grant select on public.passenger_verification_latest_location_v1 to service_role;

comment on table public.passenger_verification_submission_locations is
  'Immutable server-side snapshot of the device geolocation result and coarse network region recorded for each passenger verification submission. Review signal only; not proof of physical presence. Raw IP addresses are not stored here.';

comment on view public.passenger_verification_latest_location_v1 is
  'Service-role-only location snapshot corresponding to the passenger current verification request submission timestamp. Review signal only; not proof of physical presence.';

do $verify$
begin
  if has_table_privilege('anon', 'public.passenger_verification_submission_locations', 'SELECT')
     or has_table_privilege('authenticated', 'public.passenger_verification_submission_locations', 'SELECT')
     or has_table_privilege('anon', 'public.passenger_verification_latest_location_v1', 'SELECT')
     or has_table_privilege('authenticated', 'public.passenger_verification_latest_location_v1', 'SELECT')
     or not has_table_privilege('service_role', 'public.passenger_verification_submission_locations', 'SELECT')
     or not has_table_privilege('service_role', 'public.passenger_verification_submission_locations', 'INSERT')
     or has_table_privilege('service_role', 'public.passenger_verification_submission_locations', 'UPDATE')
     or has_table_privilege('service_role', 'public.passenger_verification_submission_locations', 'DELETE')
     or not has_table_privilege('service_role', 'public.passenger_verification_latest_location_v1', 'SELECT')
  then
    raise exception 'Verification submission location permissions are incorrect';
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
