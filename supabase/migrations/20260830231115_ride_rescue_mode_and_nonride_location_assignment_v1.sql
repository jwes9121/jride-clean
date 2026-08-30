-- Applied to JRide-prod as migration 20260830231115.
-- Policy:
--   Ride normal: registered municipality AND current live town must match booking town.
--   Ride Rescue Mode: current live town must match target town; registered municipality is waived temporarily.
--   Takeout / Errand / AgriMarket do not use Ride town exclusivity.

alter table public.service_town_rescue_overrides
  drop constraint if exists service_town_rescue_overrides_scope_check;

alter table public.service_town_rescue_overrides
  add constraint service_town_rescue_overrides_scope_check
  check (scope in ('ride','non_ride'));

create or replace function public.jride_ride_rescue_active_v1(
  p_town text,
  p_at timestamptz default now()
)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.service_town_rescue_overrides o
    where o.scope = 'ride'
      and lower(trim(o.target_town)) = lower(trim(p_town))
      and o.disabled_at is null
      and o.enabled_at <= p_at
      and o.expires_at > p_at
  );
$$;

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
  v_current_town text;
  v_current_updated_at timestamptz;
  v_home_town text;
begin
  if p_driver_id is null or trim(coalesce(p_booking_town, '')) = '' then
    return false;
  end if;

  select dl.town, dl.updated_at
  into v_current_town, v_current_updated_at
  from public.driver_locations dl
  where dl.driver_id = p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if v_current_town is null or v_current_updated_at is null then return false; end if;
  if v_current_updated_at < p_at - interval '2 minutes' then return false; end if;
  if lower(trim(v_current_town)) <> lower(trim(p_booking_town)) then return false; end if;

  if public.jride_ride_rescue_active_v1(p_booking_town, p_at) then
    return true;
  end if;

  select dp.municipality
  into v_home_town
  from public.driver_profiles dp
  where dp.driver_id = p_driver_id;

  if v_home_town is null then return false; end if;
  return lower(trim(v_home_town)) = lower(trim(p_booking_town));
end;
$$;

create or replace function public.jride_enforce_ride_town_assignment_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver uuid;
  v_assignment_event boolean := false;
begin
  if lower(coalesce(new.service_type, '')) not in ('motorcycle','tricycle') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_driver := coalesce(new.assigned_driver_id, new.driver_id);
    v_assignment_event := v_driver is not null;
  else
    if new.assigned_driver_id is distinct from old.assigned_driver_id
       and new.assigned_driver_id is not null then
      v_driver := new.assigned_driver_id;
      v_assignment_event := true;
    elsif new.driver_id is distinct from old.driver_id
       and new.driver_id is not null then
      v_driver := new.driver_id;
      v_assignment_event := true;
    end if;
  end if;

  if not v_assignment_event or v_driver is null then return new; end if;

  if trim(coalesce(new.town, '')) = '' then
    raise exception 'RIDE_PICKUP_TOWN_REQUIRED' using errcode = 'P0001';
  end if;

  if not public.jride_ride_driver_town_eligible_v1(v_driver, new.town, now()) then
    raise exception 'RIDE_DRIVER_TOWN_INELIGIBLE' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_jride_ride_town_assignment_v1 on public.bookings;

create trigger trg_jride_ride_town_assignment_v1
before insert or update of assigned_driver_id, driver_id on public.bookings
for each row
execute function public.jride_enforce_ride_town_assignment_v1();

create or replace function public.errand_enforce_stage0_assignment_guard()
returns trigger
language plpgsql
as $$
declare
  v_driver_id uuid;
  v_driver_vehicle text;
  v_lat double precision;
  v_lng double precision;
  v_required_vehicle text;
begin
  if lower(coalesce(new.service_type, '')) <> 'errand' then return new; end if;

  v_driver_id := coalesce(new.assigned_driver_id, new.driver_id);
  if v_driver_id is null then return new; end if;

  select dl.lat, dl.lng, lower(trim(coalesce(dl.vehicle_type, '')))
  into v_lat, v_lng, v_driver_vehicle
  from public.driver_locations dl
  where dl.driver_id = v_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if v_lat is null or v_lng is null then
    raise exception 'ERRAND_DRIVER_LOCATION_REQUIRED' using errcode = 'P0001';
  end if;

  select ej.vehicle_requirement
  into v_required_vehicle
  from public.errand_jobs ej
  where ej.booking_id = new.id;

  if v_required_vehicle in ('motorcycle','tricycle')
     and v_driver_vehicle <> v_required_vehicle then
    raise exception 'ERRAND_REQUIRED_VEHICLE_MISMATCH' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

create or replace function public.jride_auto_assign_on_insert()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_driver uuid;
begin
  if lower(coalesce(new.service_type, '')) not in ('motorcycle','tricycle') then return new; end if;
  if new.status is null or new.status not in ('requested','pending','searching') then return new; end if;
  if new.assigned_driver_id is not null then return new; end if;

  select dl.driver_id
  into v_driver
  from public.driver_locations dl
  where dl.status = 'online'
    and dl.lat is not null
    and dl.lng is not null
    and dl.updated_at >= now() - interval '90 seconds'
    and public.jride_ride_driver_town_eligible_v1(dl.driver_id, new.town, now())
    and not exists (
      select 1
      from public.bookings bx
      where bx.driver_id = dl.driver_id
        and bx.status in ('assigned','accepted','fare_proposed','on_the_way','arrived','on_trip')
    )
  order by
    public.jride_haversine_km(new.pickup_lat, new.pickup_lng, dl.lat, dl.lng) asc,
    dl.updated_at desc
  limit 1;

  if v_driver is null then return new; end if;

  update public.bookings b
  set assigned_driver_id = v_driver,
      driver_id = v_driver,
      assigned_at = now(),
      status = 'assigned',
      updated_at = now()
  where b.id = new.id
    and b.assigned_driver_id is null
    and b.status in ('requested','pending','searching');

  return new;
end;
$$;

create or replace function public.assign_nearest_driver_for_booking(p_booking_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking record;
  v_driver record;
  v_pickup_town text;
begin
  select * into v_booking
  from public.bookings
  where booking_code = p_booking_code
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'booking_not_found', 'booking_code', p_booking_code);
  end if;

  if lower(coalesce(v_booking.service_type, '')) not in ('motorcycle','tricycle') then
    return jsonb_build_object('ok', false, 'reason', 'ride_only_assignment_path', 'booking_code', p_booking_code);
  end if;

  if v_booking.assigned_driver_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_assigned', 'booking_code', p_booking_code, 'assigned_driver_id', v_booking.assigned_driver_id);
  end if;

  if coalesce(v_booking.status, '') not in ('requested','pending','searching') then
    return jsonb_build_object('ok', false, 'reason', 'status_not_assignable', 'booking_code', p_booking_code, 'status', v_booking.status);
  end if;

  select v.town into v_pickup_town
  from public.bookings_zone_name_v1 v
  where v.id = v_booking.id
  limit 1;

  select dl.* into v_driver
  from public.driver_locations dl
  where dl.updated_at > now() - interval '2 minutes'
    and coalesce(dl.status, '') in ('online','available','ready')
    and dl.driver_id <> '00000000-0000-4000-8000-000000000001'::uuid
    and public.jride_ride_driver_town_eligible_v1(dl.driver_id, v_pickup_town, now())
  order by
    (dl.lat - v_booking.pickup_lat) * (dl.lat - v_booking.pickup_lat) +
    (dl.lng - v_booking.pickup_lng) * (dl.lng - v_booking.pickup_lng)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_eligible_online_drivers', 'booking_code', v_booking.booking_code, 'pickup_town', v_pickup_town);
  end if;

  update public.bookings
  set assigned_driver_id = v_driver.driver_id,
      driver_id = v_driver.driver_id,
      assigned_at = now(),
      status = 'assigned',
      driver_status = 'assigned',
      updated_at = now()
  where id = v_booking.id
    and assigned_driver_id is null;

  return jsonb_build_object('ok', true, 'booking_code', v_booking.booking_code, 'pickup_town', v_pickup_town, 'assigned_driver_id', v_driver.driver_id);
end;
$$;

create or replace function public.assign_nearest_driver_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_booking record;
  v_driver record;
  v_pickup_town text;
begin
  select * into v_booking
  from public.bookings
  where status in ('requested','pending','searching')
    and assigned_driver_id is null
    and lower(coalesce(service_type, '')) in ('motorcycle','tricycle')
  order by created_at asc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_pending_booking');
  end if;

  select v.town into v_pickup_town
  from public.bookings_zone_name_v1 v
  where v.id = v_booking.id
  limit 1;

  select dl.* into v_driver
  from public.driver_locations dl
  where dl.updated_at >= now() - interval '90 seconds'
    and coalesce(dl.status, '') in ('online','available','ready')
    and dl.lat is not null
    and dl.lng is not null
    and public.jride_ride_driver_town_eligible_v1(dl.driver_id, v_pickup_town, now())
    and not exists (
      select 1
      from public.bookings bx
      where bx.driver_id = dl.driver_id
        and bx.status in ('assigned','accepted','fare_proposed','on_the_way','arrived','on_trip')
    )
  order by
    (dl.lat - v_booking.pickup_lat) * (dl.lat - v_booking.pickup_lat) +
    (dl.lng - v_booking.pickup_lng) * (dl.lng - v_booking.pickup_lng)
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_eligible_online_drivers', 'booking_id', v_booking.id, 'booking_code', v_booking.booking_code, 'pickup_town', v_pickup_town);
  end if;

  update public.bookings
  set assigned_driver_id = v_driver.driver_id,
      driver_id = v_driver.driver_id,
      assigned_at = now(),
      status = 'assigned',
      driver_status = 'assigned',
      updated_at = now()
  where id = v_booking.id
    and assigned_driver_id is null
    and status in ('requested','pending','searching');

  return jsonb_build_object('ok', true, 'booking_id', v_booking.id, 'booking_code', v_booking.booking_code, 'pickup_town', v_pickup_town, 'assigned_driver_id', v_driver.driver_id);
end;
$$;

create or replace function public.trg_call_assign_nearest_driver_v2()
returns trigger
language plpgsql
as $$
begin
  if lower(coalesce(new.service_type, '')) not in ('motorcycle','tricycle') then
    return new;
  end if;

  if new.booking_code like 'JR-UI-%'
     and new.assigned_driver_id is null
     and new.status in ('requested','pending','searching') then
    perform public.assign_nearest_driver_v2();
  end if;

  return new;
end;
$$;

revoke all on function public.jride_ride_rescue_active_v1(text,timestamptz)
from public, anon, authenticated;

revoke all on function public.jride_ride_driver_town_eligible_v1(uuid,text,timestamptz)
from public, anon, authenticated;

grant execute on function public.jride_ride_rescue_active_v1(text,timestamptz)
to service_role;

grant execute on function public.jride_ride_driver_town_eligible_v1(uuid,text,timestamptz)
to service_role;