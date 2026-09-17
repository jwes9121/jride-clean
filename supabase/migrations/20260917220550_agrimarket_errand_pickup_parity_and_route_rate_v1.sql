-- AGRIMARKET ERRAND PICKUP PARITY AND ROUTE RATE V1
--
-- Prospective AgriMarket pricing change only:
-- - service-route rate: PHP 15/km -> PHP 20/km
-- - driver approach: align raw pickup pricing with the canonical Errand/Ride
--   road-distance rule, then credit the existing PHP 40 delivery base so the
--   base is not charged twice.
--
-- Existing completed/terminal orders are not repriced.

do $$
begin
  if to_regclass('public.agrimarket_pricing_settings') is null then
    raise exception 'AGRIMARKET_PRICING_SETTINGS_MISSING';
  end if;

  if to_regclass('public.agrimarket_orders') is null
     or to_regclass('public.agrimarket_driver_offers') is null then
    raise exception 'AGRIMARKET_PRICING_DEPENDENCY_MISSING';
  end if;

  if to_regprocedure('public.agrimarket_quote_delivery_v1(numeric)') is null
     or to_regprocedure('public.agrimarket_compute_driver_approach_fee_v1(numeric)') is null then
    raise exception 'AGRIMARKET_PRICING_FUNCTION_MISSING';
  end if;

  if not exists (
    select 1
    from public.agrimarket_pricing_settings
    where id = 1 and is_active = true
  ) then
    raise exception 'AGRIMARKET_ACTIVE_PRICING_SETTINGS_MISSING';
  end if;
end;
$$;

-- Keep the pricing switch atomic with respect to AgriMarket checkout/dispatch.
lock table public.agrimarket_orders in share row exclusive mode;
lock table public.agrimarket_driver_offers in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.agrimarket_orders
    where status not in (
      'completed',
      'producer_timeout',
      'producer_rejected',
      'customer_cancelled',
      'cancelled'
    )
  ) then
    raise exception 'AGRIMARKET_PRICING_CHANGE_REQUIRES_NO_ACTIVE_ORDERS'
      using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.agrimarket_driver_offers
    where status = 'offered'
  ) then
    raise exception 'AGRIMARKET_PRICING_CHANGE_REQUIRES_NO_ACTIVE_OFFERS'
      using errcode = 'P0001';
  end if;
end;
$$;

update public.agrimarket_pricing_settings
set route_fee_per_km = 20,
    pricing_version = 2,
    updated_at = clock_timestamp(),
    updated_by = 'agrimarket_errand_pickup_parity_and_route_rate_v1'
where id = 1
  and is_active = true;

create or replace function public.agrimarket_compute_driver_approach_fee_v1(
  p_distance_km numeric
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_settings public.agrimarket_pricing_settings%rowtype;
  v_distance numeric(12,3);
  v_base numeric(12,2);
  v_tier_one_chargeable_km numeric(12,3) := 0;
  v_tier_two_chargeable_km numeric(12,3) := 0;
  v_tier_one_blocks integer := 0;
  v_tier_two_blocks integer := 0;
  v_raw_pickup_fee numeric(12,2) := 0;
  v_approach_charge numeric(12,2) := 0;
  v_absorbed_pickup_fee numeric(12,2) := 0;
  v_additional_fee numeric(12,2) := 0;
begin
  if p_distance_km is null or p_distance_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_DISTANCE_INVALID'
      using errcode = 'P0001';
  end if;

  select *
  into v_settings
  from public.agrimarket_pricing_settings
  where id = 1
    and is_active = true;

  if v_settings.id is null then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED'
      using errcode = 'P0001';
  end if;

  v_distance := round(p_distance_km, 3);
  v_base := round(greatest(v_settings.base_delivery_fee, 0), 0);

  if v_distance > 10 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_DISTANCE_EXCEEDS_NORMAL_LIMIT'
      using errcode = 'P0001';
  end if;

  if v_distance > 1.5 then
    v_tier_one_chargeable_km :=
      greatest(least(v_distance, 6.5) - 1.5, 0);

    if v_tier_one_chargeable_km > 0 then
      v_tier_one_blocks := ceil(v_tier_one_chargeable_km / 0.5)::integer;
    end if;
  end if;

  if v_distance > 6.5 then
    v_tier_two_chargeable_km := greatest(v_distance - 6.5, 0);

    if v_tier_two_chargeable_km > 0 then
      v_tier_two_blocks := ceil(v_tier_two_chargeable_km / 0.5)::integer;
    end if;
  end if;

  v_raw_pickup_fee := least(
    270,
    (v_tier_one_blocks * 20 + v_tier_two_blocks * 10)::numeric
  );

  v_approach_charge := greatest(v_base, v_raw_pickup_fee);
  v_absorbed_pickup_fee := least(v_base, v_raw_pickup_fee);
  v_additional_fee := greatest(v_approach_charge - v_base, 0);

  return jsonb_build_object(
    'rule', 'agrimarket_errand_pickup_parity_v1',
    'distance_km', v_distance,
    'base_delivery_fee_credit', v_base,
    'free_km', 1.5,
    'block_km', 0.5,
    'tier_one_end_km', 6.5,
    'tier_one_fee_per_block', 20,
    'tier_two_fee_per_block', 10,
    'normal_max_km', 10,
    'raw_max_fee', 270,
    'tier_one_blocks', v_tier_one_blocks,
    'tier_two_blocks', v_tier_two_blocks,
    'raw_pickup_fee', v_raw_pickup_fee,
    'pickup_fee_absorbed_by_base', v_absorbed_pickup_fee,
    'approach_charge', v_approach_charge,
    'fee', v_additional_fee
  );
end;
$$;

revoke all on function public.agrimarket_compute_driver_approach_fee_v1(numeric)
  from public, anon, authenticated;
grant execute on function public.agrimarket_compute_driver_approach_fee_v1(numeric)
  to service_role;

comment on function public.agrimarket_compute_driver_approach_fee_v1(numeric) is
  'AgriMarket Driver Approach pricing aligned to the canonical Errand/Ride pickup tiers. The existing delivery base is credited against the raw pickup charge so the base is not charged twice.';

create or replace function public.agrimarket_apply_driver_approach_order_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_approach_distance numeric(12,3);
  v_quote jsonb;
begin
  if new.assigned_driver_id is null
     and new.pickup_fee_locked_at is null then
    new.pickup_distance_fee := 0;
    return new;
  end if;

  if new.driver_to_first_pickup_km is null
     or new.driver_to_first_pickup_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_FIRST_LEG_REQUIRED'
      using errcode = 'P0001';
  end if;

  if new.assignment_anchor = 'customer' then
    if new.customer_to_farmer_distance_km is null
       or new.customer_to_farmer_distance_km < 0 then
      raise exception 'AGRIMARKET_DRIVER_APPROACH_CUSTOMER_FARMER_ROUTE_REQUIRED'
        using errcode = 'P0001';
    end if;

    v_approach_distance := round(
      new.driver_to_first_pickup_km + new.customer_to_farmer_distance_km,
      3
    );
  else
    v_approach_distance := round(new.driver_to_first_pickup_km, 3);
  end if;

  v_quote := public.agrimarket_compute_driver_approach_fee_v1(
    v_approach_distance
  );

  new.pickup_distance_fee := (v_quote->>'fee')::numeric;
  new.pricing_snapshot := coalesce(new.pricing_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'pickup_distance_fee_rule', v_quote->>'rule',
      'driver_approach_distance_basis', 'assigned_driver_to_farmer_road_route',
      'driver_approach_distance_km', (v_quote->>'distance_km')::numeric,
      'driver_approach_free_km', (v_quote->>'free_km')::numeric,
      'driver_approach_block_km', (v_quote->>'block_km')::numeric,
      'driver_approach_tier_one_end_km', (v_quote->>'tier_one_end_km')::numeric,
      'driver_approach_tier_one_fee_per_block', (v_quote->>'tier_one_fee_per_block')::numeric,
      'driver_approach_tier_two_fee_per_block', (v_quote->>'tier_two_fee_per_block')::numeric,
      'driver_approach_raw_max_fee', (v_quote->>'raw_max_fee')::numeric,
      'driver_approach_base_delivery_fee_credit', (v_quote->>'base_delivery_fee_credit')::numeric,
      'driver_approach_raw_pickup_fee', (v_quote->>'raw_pickup_fee')::numeric,
      'driver_approach_pickup_fee_absorbed_by_base', (v_quote->>'pickup_fee_absorbed_by_base')::numeric,
      'driver_approach_charge', (v_quote->>'approach_charge')::numeric,
      'pickup_distance_fee', (v_quote->>'fee')::numeric
    );

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_driver_approach_order_v1()
  from public, anon, authenticated, service_role;

comment on function public.agrimarket_apply_driver_approach_order_v1() is
  'Locks the post-assignment AgriMarket Driver Approach Fee and snapshots the canonical Errand/Ride pickup tiers plus delivery-base credit.';

do $$
declare
  v_settings public.agrimarket_pricing_settings%rowtype;
  q jsonb;
begin
  select *
  into v_settings
  from public.agrimarket_pricing_settings
  where id = 1
    and is_active = true;

  if v_settings.id is null then
    raise exception 'AGRIMARKET_PRICING_SETTINGS_LOST';
  end if;

  if v_settings.route_fee_per_km <> 20
     or v_settings.pricing_version <> 2 then
    raise exception 'AGRIMARKET_ROUTE_RATE_UPDATE_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(1.5);
  if (q->>'raw_pickup_fee')::numeric <> 0
     or (q->>'fee')::numeric <> 0 then
    raise exception 'AGRIMARKET_APPROACH_1_5KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(2.5);
  if (q->>'raw_pickup_fee')::numeric <> 40
     or (q->>'fee')::numeric <> greatest(40 - round(v_settings.base_delivery_fee, 0), 0) then
    raise exception 'AGRIMARKET_APPROACH_2_5KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(2.501);
  if (q->>'raw_pickup_fee')::numeric <> 60
     or (q->>'fee')::numeric <> greatest(60 - round(v_settings.base_delivery_fee, 0), 0) then
    raise exception 'AGRIMARKET_APPROACH_2_501KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(3.692);
  if (q->>'raw_pickup_fee')::numeric <> 100
     or (q->>'fee')::numeric <> greatest(100 - round(v_settings.base_delivery_fee, 0), 0) then
    raise exception 'AGRIMARKET_APPROACH_3_692KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(7.163);
  if (q->>'raw_pickup_fee')::numeric <> 220
     or (q->>'fee')::numeric <> greatest(220 - round(v_settings.base_delivery_fee, 0), 0) then
    raise exception 'AGRIMARKET_APPROACH_7_163KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(10);
  if (q->>'raw_pickup_fee')::numeric <> 270
     or (q->>'fee')::numeric <> greatest(270 - round(v_settings.base_delivery_fee, 0), 0) then
    raise exception 'AGRIMARKET_APPROACH_10KM_CHECK_FAILED';
  end if;

  if to_regprocedure('public.agrimarket_compute_driver_approach_fee_v1(numeric)') is null
     or to_regprocedure('public.agrimarket_apply_driver_approach_order_v1()') is null then
    raise exception 'AGRIMARKET_APPROACH_FUNCTION_POSTCHECK_FAILED';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.agrimarket_driver_offers'::regclass
      and tgname = 'agrimarket_apply_driver_approach_offer_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_APPROACH_OFFER_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.agrimarket_orders'::regclass
      and tgname = 'agrimarket_apply_driver_approach_order_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_APPROACH_ORDER_TRIGGER_MISSING';
  end if;
end;
$$;
