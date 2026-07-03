/*
JRide Events Platform
Feature: EVT-003A
Purpose: Adds configurable event group values for registration dropdowns.
Rollback:
  drop table if exists public.event_group_values;
*/

create table if not exists public.event_group_values (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  sort_order integer not null default 0,
  value text not null,
  label text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(event_id, value)
);

create index if not exists idx_event_group_values_event
on public.event_group_values(event_id, sort_order);

insert into public.event_group_values (event_id, sort_order, value, label)
select e.id, y - 1950 + 1, y::text, 'Batch ' || y::text
from public.events e
cross join generate_series(1950, 2026) as y
where e.slug = 'dbhs-2026'
on conflict (event_id, value) do nothing;