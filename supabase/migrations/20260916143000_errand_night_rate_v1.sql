-- JRide Errand night-rate pricing v1.
-- Prospective only: new Errands are tagged at insert time with night_rate_mode.
-- Existing Errands with NULL night_rate_mode remain on their historical pricing.
-- Asia/Manila booking-created hour is the immutable pricing basis.
-- 20:00-22:59: add one Base + Route subtotal, making those eligible components double.
-- 23:00-04:59: add PHP 100 to the eligible Base + Route subtotal.
-- 05:00-19:59: regular pricing.
-- Pickup, extra stops, waiting, elevation, heavy load, and the PHP 20 company cut are unchanged.

create or replace function public.apply_service_pricing()
returns trigger
language plpgsql
as $function$
declare
  v_wait_minutes integer;
  v_paid_wait integer;
  v_wait_blocks integer;
  v_base numeric(10,2);
  v_distance numeric(10,2);
  v_pickup numeric(10,2);
  v_approach numeric(10,2);
  v_wait_fee numeric(10,2);
  v_extra_stop numeric(10,2);
  v_elevation numeric(10,2);
  v_heavy numeric(10,2);
  v_total numeric(10,2);
  v_company numeric(10,2);
  v_absorbed_pricing boolean;
  v_night_policy_enabled boolean := false;
  v_night_basis timestamptz;
  v_night_hour integer;
  v_night_mode text;
  v_night_adjustment numeric(10,2) := 0;
begin
  if new.service_type not in ('errand', 'takeout') then
    return new;
  end if;

  v_distance := greatest(coalesce(new.distance_fare, 0), 0);

  if new.service_type = 'errand' then
    -- Preserve the approved Sept 4 approach model:
    -- minimum/base is absorbed into pickup when pickup is larger.
    v_absorbed_pricing := coalesce(new.created_at, now()) >= timestamptz '2026-09-04 22:33:38+00';

    v_base := round(greatest(coalesce(new.base_fee, 0), 0), 0);
    if v_base <= 0 then
      raise exception 'ERRAND_BASE_FARE_REQUIRED'
        using errcode = 'P0001';
    end if;

    v_pickup := round(greatest(coalesce(new.pickup_distance_fee, 0), 0), 0);
    v_approach := case
      when v_absorbed_pricing then greatest(v_base, v_pickup)
      else v_base + v_pickup
    end;
    v_distance := round(v_distance, 0);

    -- Migration-safe cohort marker. New Errands enter the night-rate policy.
    -- Historical Errands never become eligible merely because another field is updated.
    if tg_op = 'INSERT' then
      v_night_policy_enabled := true;
      v_night_basis := coalesce(new.created_at, now());
    elsif lower(coalesce(old.night_rate_mode, '')) in ('regular', 'double', 'plus_100') then
      v_night_policy_enabled := true;
      v_night_basis := coalesce(old.created_at, new.created_at, now());
    else
      v_night_policy_enabled := false;
      v_night_basis := null;
    end if;

    if v_night_policy_enabled then
      v_night_hour := extract(hour from (v_night_basis at time zone 'Asia/Manila'))::integer;
      v_night_mode := case
        when v_night_hour between 20 and 22 then 'double'
        when v_night_hour >= 23 or v_night_hour <= 4 then 'plus_100'
        else 'regular'
      end;

      new.night_rate_hour_ph := v_night_hour;
      new.night_rate_mode := v_night_mode;

      v_night_adjustment := case
        when v_night_mode = 'double' then round(v_base + v_distance, 0)
        when v_night_mode = 'plus_100' then 100
        else 0
      end;
    else
      new.night_rate_hour_ph := null;
      new.night_rate_mode := null;
      v_night_adjustment := 0;
    end if;

    v_wait_minutes := greatest(coalesce(new.waiting_minutes, 0), 0);
    v_paid_wait := greatest(v_wait_minutes - 15, 0);
    if v_paid_wait > 0 then
      v_wait_blocks := ceil(v_paid_wait::numeric / 15);
    else
      v_wait_blocks := 0;
    end if;
    v_wait_fee := (v_wait_blocks * 20)::numeric(10,2);

    new.waiting_minutes := v_wait_minutes;
    new.waiting_fee := v_wait_fee;
    new.stop_count := greatest(coalesce(new.stop_count, 1), 1);
    v_extra_stop := (greatest(new.stop_count - 1, 0) * 40)::numeric(10,2);
    new.extra_stop_fee := v_extra_stop;

    v_elevation := round(greatest(coalesce(new.elevation_surcharge, 0), 0), 0);
    v_heavy := round(greatest(coalesce(new.heavy_load_fee, 0), 0), 0);
    new.elevation_surcharge := v_elevation;
    new.heavy_load_fee := v_heavy;

    v_total := round(
      v_approach
      + v_distance
      + v_night_adjustment
      + v_wait_fee
      + v_extra_stop
      + v_elevation
      + v_heavy,
      0
    );

    new.base_fee := v_base;
    new.distance_fare := v_distance;
    new.pickup_distance_fee := v_pickup;
    new.total_errand_fare := v_total;
    v_company := 20;
    new.company_cut := v_company;
    new.driver_payout := greatest(v_total - v_company, 0);
    return new;
  end if;

  if new.service_type = 'takeout' then
    v_base := coalesce(new.base_fee, 0);
    if v_base <= 0 then
      v_base := 70;
    end if;

    v_wait_minutes := greatest(coalesce(new.waiting_minutes, 0), 0);
    v_paid_wait := greatest(v_wait_minutes - 15, 0);
    v_wait_blocks := ceil(v_paid_wait::numeric / 15);
    v_wait_fee := (v_wait_blocks * 20)::numeric(10,2);
    new.waiting_minutes := v_wait_minutes;
    new.waiting_fee := v_wait_fee;
    new.stop_count := greatest(coalesce(new.stop_count, 1), 1);
    v_extra_stop := 0;
    new.extra_stop_fee := v_extra_stop;
    v_total := v_base + v_distance + v_wait_fee + v_extra_stop;
    new.base_fee := v_base;
    new.total_errand_fare := v_total;
    v_company := 20;
    new.company_cut := v_company;
    new.driver_payout := v_total - v_company;
    return new;
  end if;

  return new;
end;
$function$;

create or replace function public.apply_errand_pricing()
returns trigger
language plpgsql
as $function$
declare
  v_wait_minutes integer;
  v_paid_wait integer;
  v_wait_blocks integer;
  v_base numeric(10,2);
  v_distance numeric(10,2);
  v_pickup numeric(10,2);
  v_approach numeric(10,2);
  v_wait_fee numeric(10,2);
  v_extra_stop numeric(10,2);
  v_elevation numeric(10,2);
  v_heavy numeric(10,2);
  v_total numeric(10,2);
  v_absorbed_pricing boolean;
  v_night_policy_enabled boolean := false;
  v_night_basis timestamptz;
  v_night_hour integer;
  v_night_mode text;
  v_night_adjustment numeric(10,2) := 0;
begin
  if new.service_type is distinct from 'errand' then
    return new;
  end if;

  v_absorbed_pricing := coalesce(new.created_at, now()) >= timestamptz '2026-09-04 22:33:38+00';

  v_base := greatest(coalesce(new.base_fee, 0), 0);
  if v_base <= 0 then
    raise exception 'ERRAND_BASE_FARE_REQUIRED'
      using errcode = 'P0001';
  end if;

  v_distance := greatest(coalesce(new.distance_fare, 0), 0);
  v_pickup := greatest(coalesce(new.pickup_distance_fee, 0), 0);
  v_approach := case
    when v_absorbed_pricing then greatest(v_base, v_pickup)
    else v_base + v_pickup
  end;

  if tg_op = 'INSERT' then
    v_night_policy_enabled := true;
    v_night_basis := coalesce(new.created_at, now());
  elsif lower(coalesce(old.night_rate_mode, '')) in ('regular', 'double', 'plus_100') then
    v_night_policy_enabled := true;
    v_night_basis := coalesce(old.created_at, new.created_at, now());
  else
    v_night_policy_enabled := false;
    v_night_basis := null;
  end if;

  if v_night_policy_enabled then
    v_night_hour := extract(hour from (v_night_basis at time zone 'Asia/Manila'))::integer;
    v_night_mode := case
      when v_night_hour between 20 and 22 then 'double'
      when v_night_hour >= 23 or v_night_hour <= 4 then 'plus_100'
      else 'regular'
    end;

    new.night_rate_hour_ph := v_night_hour;
    new.night_rate_mode := v_night_mode;

    v_night_adjustment := case
      when v_night_mode = 'double' then round(v_base + v_distance, 0)
      when v_night_mode = 'plus_100' then 100
      else 0
    end;
  else
    new.night_rate_hour_ph := null;
    new.night_rate_mode := null;
    v_night_adjustment := 0;
  end if;

  v_wait_minutes := greatest(coalesce(new.waiting_minutes, 0), 0);
  v_paid_wait := greatest(v_wait_minutes - 15, 0);
  if v_paid_wait > 0 then
    v_wait_blocks := ceil(v_paid_wait::numeric / 15);
  else
    v_wait_blocks := 0;
  end if;
  v_wait_fee := (v_wait_blocks * 20)::numeric(10,2);
  new.waiting_minutes := v_wait_minutes;
  new.waiting_fee := v_wait_fee;
  new.stop_count := greatest(coalesce(new.stop_count, 1), 1);
  v_extra_stop := (greatest(new.stop_count - 1, 0) * 40)::numeric(10,2);
  new.extra_stop_fee := v_extra_stop;
  v_elevation := greatest(coalesce(new.elevation_surcharge, 0), 0);
  v_heavy := greatest(coalesce(new.heavy_load_fee, 0), 0);
  new.elevation_surcharge := v_elevation;
  new.heavy_load_fee := v_heavy;

  v_total := v_approach
    + v_distance
    + v_night_adjustment
    + v_wait_fee
    + v_extra_stop
    + v_elevation
    + v_heavy;

  new.base_fee := v_base;
  new.distance_fare := v_distance;
  new.pickup_distance_fee := v_pickup;
  new.total_errand_fare := v_total;
  new.company_cut := 20;
  new.driver_payout := greatest(v_total - 20, 0);
  return new;
end;
$function$;

comment on function public.apply_service_pricing() is
  'JRide service pricing trigger. New Errands are tagged by booking-created Asia/Manila hour: 20-22 doubles Base + Route via an equal premium; 23-04 adds PHP 100; pickup and other Errand adjustments are unchanged. Historical Errands without a night_rate_mode marker remain unchanged.';

comment on function public.apply_errand_pricing() is
  'Legacy Errand pricing helper aligned to the prospective Errand night-rate cohort and the Sept 4 absorbed-approach model.';
