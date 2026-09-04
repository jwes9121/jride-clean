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
begin
  if new.service_type not in ('errand', 'takeout') then
    return new;
  end if;

  v_distance := greatest(coalesce(new.distance_fare, 0), 0);

  if new.service_type = 'errand' then
    -- The configured PHP 40 base is the minimum approach charge. It is not
    -- stacked on top of pickup-distance pricing. Once the routed pickup fee
    -- is higher than the base, the pickup fee absorbs/replaces the base.
    v_base := round(greatest(coalesce(new.base_fee, 0), 0), 0);
    if v_base <= 0 then
      raise exception 'ERRAND_BASE_FARE_REQUIRED'
        using errcode = 'P0001';
    end if;

    v_pickup := round(greatest(coalesce(new.pickup_distance_fee, 0), 0), 0);
    v_approach := greatest(v_base, v_pickup);
    v_distance := round(v_distance, 0);

    -- One shared cumulative waiting meter. First 15 total minutes are free,
    -- then PHP 20 per started 15-minute block.
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

    -- Stop 1 is included; each additional confirmed task stop is PHP 40.
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

    -- Preserve the configured base and raw routed pickup fee for audit. The
    -- passenger-facing charge is v_approach = greatest(base, pickup).
    new.base_fee := v_base;
    new.distance_fare := v_distance;
    new.pickup_distance_fee := v_pickup;
    new.total_errand_fare := v_total;

    v_company := 20;
    new.company_cut := v_company;
    new.driver_payout := greatest(v_total - v_company, 0);

    return new;
  end if;

  -- Preserve existing Takeout pricing unchanged.
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
begin
  if new.service_type is distinct from 'errand' then
    return new;
  end if;

  v_base := greatest(coalesce(new.base_fee, 0), 0);
  if v_base <= 0 then
    raise exception 'ERRAND_BASE_FARE_REQUIRED'
      using errcode = 'P0001';
  end if;

  v_distance := greatest(coalesce(new.distance_fare, 0), 0);
  v_pickup := greatest(coalesce(new.pickup_distance_fee, 0), 0);
  v_approach := greatest(v_base, v_pickup);

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
  new.company_cut := 20;
  new.driver_payout := greatest(v_total - 20, 0);

  return new;
end;
$function$;

comment on function public.apply_service_pricing() is
  'JRide service pricing trigger. Errand approach pricing uses greatest(base_fee,pickup_distance_fee), so the PHP 40 base is a minimum approach charge and is never stacked on top of a higher routed pickup fee.';

comment on function public.apply_errand_pricing() is
  'Legacy Errand pricing helper kept aligned with apply_service_pricing: approach charge is greatest(base_fee,pickup_distance_fee).';
