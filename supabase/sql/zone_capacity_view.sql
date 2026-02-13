-- =========================================================
-- JRide: Zone Capacity View + Refresh Function + Trigger
-- Creates public.zone_capacity_view used by admin/livetrips
-- =========================================================

-- Drop existing view if you are updating it
drop materialized view if exists public.zone_capacity_view;

create materialized view public.zone_capacity_view as
select
    z.id as zone_id,
    z.zone_name,
    z.color_hex,
    z.capacity_limit,
    coalesce(count(d.id), 0) as active_drivers,
    (z.capacity_limit - coalesce(count(d.id), 0)) as available_slots,
    case
        when count(d.id) >= z.capacity_limit then 'FULL'
        when count(d.id) >= (z.capacity_limit * 0.8) then 'NEAR'
        else 'AVAILABLE'
    end as status
from public.zones z
left join public.drivers d
    on d.zone_id = z.id
   and d.driver_status = 'online'
group by z.id
order by z.zone_name asc;

create unique index if not exists zone_capacity_view_zone_id_idx
    on public.zone_capacity_view(zone_id);

-- Refresh function (you can also call this manually)
create or replace function public.refresh_zone_capacity()
returns void
language plpgsql
security definer
as $$
begin
  refresh materialized view concurrently public.zone_capacity_view;
end;
$$;

-- Trigger function to auto-refresh whenever drivers change
create or replace function public.refresh_zone_capacity_trigger()
returns trigger
language plpgsql
as $$
begin
  perform public.refresh_zone_capacity();
  return null;
end;
$$;

-- Attach trigger to public.drivers
drop trigger if exists zone_capacity_trigger on public.drivers;

create trigger zone_capacity_trigger
after insert or update or delete on public.drivers
for each statement
execute function public.refresh_zone_capacity_trigger();
