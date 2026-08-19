create table if not exists public.event_live_safety_locations (
  event_id uuid not null references public.events(id) on delete cascade,
  attendee_id uuid not null references public.event_attendees(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  sharing_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source text not null default 'event_pass_web',
  primary key (event_id, attendee_id),
  constraint event_live_safety_locations_lat_chk
    check (latitude between -90 and 90),
  constraint event_live_safety_locations_lng_chk
    check (longitude between -180 and 180),
  constraint event_live_safety_locations_accuracy_chk
    check (accuracy_m is null or accuracy_m >= 0),
  constraint event_live_safety_locations_heading_chk
    check (
      heading_deg is null or
      (heading_deg >= 0 and heading_deg <= 360)
    ),
  constraint event_live_safety_locations_speed_chk
    check (speed_mps is null or speed_mps >= 0)
);

create index if not exists event_live_safety_locations_event_updated_idx
  on public.event_live_safety_locations (event_id, updated_at desc);

alter table public.event_live_safety_locations enable row level security;

revoke all on table public.event_live_safety_locations from public;
revoke all on table public.event_live_safety_locations from anon;
revoke all on table public.event_live_safety_locations from authenticated;
grant select, insert, update, delete
  on table public.event_live_safety_locations
  to service_role;

create or replace function public.jride_cleanup_event_live_safety_locations_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'live' and new.status <> 'live' then
    delete from public.event_live_safety_locations
    where event_id = new.id;
  end if;

  return new;
end;
$$;

revoke all on function public.jride_cleanup_event_live_safety_locations_v1()
  from public;
grant execute on function public.jride_cleanup_event_live_safety_locations_v1()
  to postgres, service_role;

drop trigger if exists trg_jride_cleanup_event_live_safety_locations_v1
  on public.events;

create trigger trg_jride_cleanup_event_live_safety_locations_v1
after update of status on public.events
for each row
when (old.status is distinct from new.status)
execute function public.jride_cleanup_event_live_safety_locations_v1();