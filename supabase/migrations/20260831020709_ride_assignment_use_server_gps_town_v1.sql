-- Applied to JRide-prod as migration 20260831020709.
--
-- Ride town policy:
--   Normal Ride:
--     1. Driver's fresh live GPS town must match the booking pickup town.
--     2. Driver's registered municipality must also match the booking town.
--
--   Ride Rescue Mode:
--     1. Driver's fresh live GPS town must match the rescue/booking town.
--     2. Registered municipality is temporarily waived.
--
-- driver_locations.town is intentionally NOT authoritative here because it is
-- legacy/client-reported telemetry and can remain the registered town while
-- the driver's actual GPS has moved to another municipality.
--
-- The server-owned driver_gps_town_resolutions cache is authoritative.
-- Assignment fails closed if the cache is missing or more than 0.8 km out of
-- sync with the latest live driver coordinates.

create or replace function public.jride_ride_driver_town_eligible_v1(
  p_driver_id uuid,
  p_booking_town text,
  p_at timestamptz default now()
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_live_lat double precision;
  v_live_lng double precision;
  v_live_updated_at timestamptz;
  v_gps_town text;
  v_cache_lat double precision;
  v_cache_lng double precision;
  v_home_town text;
  v_cache_delta_km double precision;
begin
  if p_driver_id is null
     or trim(coalesce(p_booking_town, '')) = '' then
    return false;
  end if;

  select
    dl.lat,
    dl.lng,
    dl.updated_at
  into
    v_live_lat,
    v_live_lng,
    v_live_updated_at
  from public.driver_locations dl
  where dl.driver_id = p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if v_live_lat is null
     or v_live_lng is null
     or v_live_updated_at is null then
    return false;
  end if;

  if v_live_updated_at < p_at - interval '2 minutes' then
    return false;
  end if;

  select
    g.current_town,
    g.source_lat,
    g.source_lng
  into
    v_gps_town,
    v_cache_lat,
    v_cache_lng
  from public.driver_gps_town_resolutions g
  where g.driver_id = p_driver_id;

  if trim(coalesce(v_gps_town, '')) = ''
     or v_cache_lat is null
     or v_cache_lng is null then
    return false;
  end if;

  v_cache_delta_km := public.jride_haversine_km(
    v_live_lat,
    v_live_lng,
    v_cache_lat,
    v_cache_lng
  );

  if v_cache_delta_km is null
     or v_cache_delta_km > 0.8 then
    return false;
  end if;

  if lower(trim(v_gps_town)) <> lower(trim(p_booking_town)) then
    return false;
  end if;

  if public.jride_ride_rescue_active_v1(p_booking_town, p_at) then
    return true;
  end if;

  select dp.municipality
  into v_home_town
  from public.driver_profiles dp
  where dp.driver_id = p_driver_id;

  if trim(coalesce(v_home_town, '')) = '' then
    return false;
  end if;

  return lower(trim(v_home_town)) = lower(trim(p_booking_town));
end;
$$;

revoke all
on function public.jride_ride_driver_town_eligible_v1(uuid,text,timestamptz)
from public, anon, authenticated;

grant execute
on function public.jride_ride_driver_town_eligible_v1(uuid,text,timestamptz)
to service_role;