create table if not exists public.event_course_routes (
  event_id uuid primary key
    references public.events(id)
    on delete cascade,
  route_name text not null
    default 'Official Fun Walk Route',
  official_distance_km numeric(8,3),
  measured_distance_km numeric(8,3) not null,
  coordinates jsonb not null,
  source text not null
    default 'admin_map_editor',
  route_version integer not null default 1,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint event_course_routes_name_not_blank
    check (length(btrim(route_name)) >= 3),
  constraint event_course_routes_official_distance_chk
    check (
      official_distance_km is null or
      (
        official_distance_km > 0 and
        official_distance_km <= 100
      )
    ),
  constraint event_course_routes_measured_distance_chk
    check (
      measured_distance_km > 0 and
      measured_distance_km <= 100
    ),
  constraint event_course_routes_coordinates_array_chk
    check (
      jsonb_typeof(coordinates) = 'array' and
      jsonb_array_length(coordinates) >= 2 and
      jsonb_array_length(coordinates) <= 5000
    ),
  constraint event_course_routes_source_not_blank
    check (length(btrim(source)) >= 3),
  constraint event_course_routes_version_chk
    check (route_version >= 1)
);

create index if not exists event_course_routes_updated_idx
  on public.event_course_routes (updated_at desc);

alter table public.event_course_routes
  enable row level security;

revoke all on table public.event_course_routes
  from public;
revoke all on table public.event_course_routes
  from anon;
revoke all on table public.event_course_routes
  from authenticated;

grant select, insert, update, delete
  on table public.event_course_routes
  to service_role;