-- Staff GPS accuracy test records. Server-only access through the JRide staff API.
create table public.operations_employee_locations (
  id bigint generated always as identity primary key,
  employee_id text not null,
  staff_email text not null,
  staff_name text not null default '',
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy_m double precision not null check (accuracy_m > 0 and accuracy_m <= 100000),
  device_captured_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

create index operations_employee_locations_employee_time_idx
  on public.operations_employee_locations(employee_id, created_at desc);

alter table public.operations_employee_locations enable row level security;
revoke all on public.operations_employee_locations from public, anon, authenticated, service_role;
revoke all on sequence public.operations_employee_locations_id_seq from public, anon, authenticated;
grant select, insert on public.operations_employee_locations to service_role;
grant usage, select on sequence public.operations_employee_locations_id_seq to service_role;
