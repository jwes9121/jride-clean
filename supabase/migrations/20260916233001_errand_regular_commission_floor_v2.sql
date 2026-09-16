-- JRide regular Errand commission floor v2.
-- Same prospective cohort as v1: 2026-09-17 00:00 Asia/Manila (2026-09-16 16:00:00Z).
-- Customer Errand pricing components remain unchanged.
-- New Errands use a whole-peso JRide cut of 25% of final fare, minimum PHP 15 and maximum PHP 20.
-- Older Errands retain the historical fixed PHP 20 cut when later updated.
-- Errand night pricing remains disabled pending a separate approved implementation.
-- Takeout pricing and company cut remain unchanged.

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
  v_regular_commission_enabled boolean;
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

    -- Night pricing is intentionally disabled. Keep the columns clear so no
    -- client-supplied marker can activate or imply a night-rate policy.
    new.night_rate_hour_ph := null;
    new.night_rate_mode := null;

    v_regular_commission_enabled := coalesce(new.created_at, now()) >= timestamptz '2026-09-16 16:00:00+00';
    if v_regular_commission_enabled then
      v_company := greatest(15, least(round(v_total * 0.25, 0), 20));
    else
      v_company := 20;
    end if;

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
  v_company numeric(10,2);
  v_absorbed_pricing boolean;
  v_regular_commission_enabled boolean;
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
    + v_wait_fee
    + v_extra_stop
    + v_elevation
    + v_heavy;

  new.base_fee := v_base;
  new.distance_fare := v_distance;
  new.pickup_distance_fee := v_pickup;
  new.total_errand_fare := v_total;
  new.night_rate_hour_ph := null;
  new.night_rate_mode := null;

  v_regular_commission_enabled := coalesce(new.created_at, now()) >= timestamptz '2026-09-16 16:00:00+00';
  if v_regular_commission_enabled then
    v_company := greatest(15, least(round(v_total * 0.25, 0), 20));
  else
    v_company := 20;
  end if;

  new.company_cut := v_company;
  new.driver_payout := greatest(v_total - v_company, 0);
  return new;
end;
$function$;

comment on function public.apply_service_pricing() is
  'JRide service pricing trigger. New Errands created on or after 2026-09-17 00:00 Asia/Manila use a whole-peso 25 percent company cut with a PHP 15 minimum and PHP 20 maximum; older Errands retain the historical fixed PHP 20 cut. Errand night pricing is disabled pending separate approval. Takeout pricing is unchanged.';

comment on function public.apply_errand_pricing() is
  'Legacy Errand pricing helper aligned to the Sept 4 absorbed-approach model and the prospective regular Errand commission policy: 25 percent, minimum PHP 15, maximum PHP 20. Errand night pricing is disabled pending separate approval.';
