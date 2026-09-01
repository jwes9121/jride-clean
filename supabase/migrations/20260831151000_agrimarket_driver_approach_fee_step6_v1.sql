-- AGRIMARKET DRIVER APPROACH FEE - STEP 6 V1
--
-- Scope: replace AgriMarket's shared Ride pickup-fee rule with the locked
-- AgriMarket Driver Approach Fee rule only.
--
-- Locked formula (read from agrimarket_pricing_settings):
--   distance to farmer <= free_km: PHP 0
--   distance to farmer > free_km: fee_per_started_km per started km
--   cap at driver_approach_fee_cap
--
-- For farmer_first, distance to farmer = driver -> farmer road distance.
-- For customer_cash_first, distance to farmer = driver -> customer road
-- distance + customer -> farmer road distance, because the customer cash stop
-- must happen before the farmer pickup.
--
-- No Heavy Load Fee, vehicle eligibility, cargo compatibility, driver identity
-- exposure, or Step 11 UI work is introduced here.

do $$
begin
  if to_regclass('public.agrimarket_pricing_settings') is null then
    raise exception 'AGRIMARKET_STEP6_PRICING_SETTINGS_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='agrimarket_pricing_settings'
      and column_name='driver_approach_free_km'
  ) then
    raise exception 'AGRIMARKET_STEP6_REQUIRES_STEP5_APPROACH_SETTINGS';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='agrimarket_orders'
      and column_name='driver_to_first_pickup_km'
  ) then
    raise exception 'AGRIMARKET_STEP6_REQUIRES_EXISTING_PICKUP_DISTANCE_COLUMNS';
  end if;

  if to_regclass('public.agrimarket_driver_offers') is null then
    raise exception 'AGRIMARKET_STEP6_DRIVER_OFFERS_MISSING';
  end if;
end;
$$;

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
  v_started_km integer := 0;
  v_fee numeric(12,2) := 0;
begin
  if p_distance_km is null or p_distance_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_DISTANCE_INVALID'
      using errcode='P0001';
  end if;

  select * into v_settings
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_settings.id is null then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED'
      using errcode='P0001';
  end if;

  v_distance := round(p_distance_km,3);

  if v_distance > v_settings.driver_approach_free_km then
    v_started_km := ceil(
      v_distance - v_settings.driver_approach_free_km
    )::integer;
  end if;

  v_fee := round(
    least(
      v_settings.driver_approach_fee_cap,
      v_started_km * v_settings.driver_approach_fee_per_started_km
    ),
    2
  );

  return jsonb_build_object(
    'rule','agrimarket_driver_approach_v1',
    'distance_km',v_distance,
    'free_km',v_settings.driver_approach_free_km,
    'fee_per_started_km',v_settings.driver_approach_fee_per_started_km,
    'fee_cap',v_settings.driver_approach_fee_cap,
    'chargeable_started_km',v_started_km,
    'fee',v_fee
  );
end;
$$;

revoke all on function public.agrimarket_compute_driver_approach_fee_v1(numeric)
  from public,anon,authenticated;
grant execute on function public.agrimarket_compute_driver_approach_fee_v1(numeric)
  to service_role;

comment on function public.agrimarket_compute_driver_approach_fee_v1(numeric) is
  'Computes the AgriMarket Driver Approach Fee from the actual road distance traveled before reaching the farmer, using the active Step 5 pricing settings.';

create or replace function public.agrimarket_apply_driver_approach_offer_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_approach_distance numeric(12,3);
  v_quote jsonb;
begin
  -- Ordinary decline/expiry/cancel status-only updates do not need repricing.
  if tg_op='UPDATE'
     and new.status not in ('offered','accepted')
     and new.order_id is not distinct from old.order_id
     and new.assignment_anchor is not distinct from old.assignment_anchor
     and new.pickup_road_distance_km is not distinct from old.pickup_road_distance_km
     and new.pickup_distance_fee is not distinct from old.pickup_distance_fee then
    return new;
  end if;

  select * into v_order
  from public.agrimarket_orders
  where id=new.order_id;

  if v_order.id is null then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_ORDER_NOT_FOUND'
      using errcode='P0001';
  end if;

  if new.pickup_road_distance_km is null or new.pickup_road_distance_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_FIRST_LEG_INVALID'
      using errcode='P0001';
  end if;

  if new.assignment_anchor='customer' then
    if v_order.customer_to_farmer_distance_km is null
       or v_order.customer_to_farmer_distance_km < 0 then
      raise exception 'AGRIMARKET_DRIVER_APPROACH_CUSTOMER_FARMER_ROUTE_REQUIRED'
        using errcode='P0001';
    end if;

    v_approach_distance := round(
      new.pickup_road_distance_km + v_order.customer_to_farmer_distance_km,
      3
    );
  else
    v_approach_distance := round(new.pickup_road_distance_km,3);
  end if;

  v_quote := public.agrimarket_compute_driver_approach_fee_v1(
    v_approach_distance
  );

  new.pickup_distance_fee := (v_quote->>'fee')::numeric;
  return new;
end;
$$;

revoke all on function public.agrimarket_apply_driver_approach_offer_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_apply_driver_approach_offer_trg
  on public.agrimarket_driver_offers;

create trigger agrimarket_apply_driver_approach_offer_trg
before insert or update of
  order_id,assignment_anchor,pickup_road_distance_km,pickup_distance_fee,status
on public.agrimarket_driver_offers
for each row
execute function public.agrimarket_apply_driver_approach_offer_v1();

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
  -- The approach fee is post-assignment only.
  if new.assigned_driver_id is null
     and new.pickup_fee_locked_at is null then
    new.pickup_distance_fee := 0;
    return new;
  end if;

  if new.driver_to_first_pickup_km is null
     or new.driver_to_first_pickup_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_FIRST_LEG_REQUIRED'
      using errcode='P0001';
  end if;

  if new.assignment_anchor='customer' then
    if new.customer_to_farmer_distance_km is null
       or new.customer_to_farmer_distance_km < 0 then
      raise exception 'AGRIMARKET_DRIVER_APPROACH_CUSTOMER_FARMER_ROUTE_REQUIRED'
        using errcode='P0001';
    end if;

    v_approach_distance := round(
      new.driver_to_first_pickup_km + new.customer_to_farmer_distance_km,
      3
    );
  else
    v_approach_distance := round(new.driver_to_first_pickup_km,3);
  end if;

  v_quote := public.agrimarket_compute_driver_approach_fee_v1(
    v_approach_distance
  );

  new.pickup_distance_fee := (v_quote->>'fee')::numeric;
  new.pricing_snapshot := coalesce(new.pricing_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'pickup_distance_fee_rule','agrimarket_driver_approach_v1',
      'driver_approach_distance_basis','assigned_driver_to_farmer_road_route',
      'driver_approach_distance_km',(v_quote->>'distance_km')::numeric,
      'driver_approach_free_km',(v_quote->>'free_km')::numeric,
      'driver_approach_fee_per_started_km',(v_quote->>'fee_per_started_km')::numeric,
      'driver_approach_fee_cap',(v_quote->>'fee_cap')::numeric,
      'driver_approach_chargeable_started_km',(v_quote->>'chargeable_started_km')::integer,
      'pickup_distance_fee',(v_quote->>'fee')::numeric
    );

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_driver_approach_order_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_apply_driver_approach_order_trg
  on public.agrimarket_orders;

create trigger agrimarket_apply_driver_approach_order_trg
before update of
  assigned_driver_id,driver_to_first_pickup_km,pickup_distance_fee,pickup_fee_locked_at
on public.agrimarket_orders
for each row
execute function public.agrimarket_apply_driver_approach_order_v1();

-- Reprice only unaccepted offers so a driver is not shown a stale Ride-based
-- fee after Step 6 lands. Already-assigned/locked orders are intentionally not
-- repriced.
update public.agrimarket_driver_offers
set pickup_distance_fee=pickup_distance_fee
where status='offered';

-- Self-verifying formula checks use the active settings rather than assuming
-- the defaults can never be administratively changed.
do $$
declare
  s public.agrimarket_pricing_settings%rowtype;
  q jsonb;
  expected numeric(12,2);
begin
  select * into s
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if s.id is null then
    raise exception 'AGRIMARKET_STEP6_PRICING_NOT_CONFIGURED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(
    s.driver_approach_free_km
  );
  if (q->>'fee')::numeric <> 0 then
    raise exception 'AGRIMARKET_STEP6_FREE_DISTANCE_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(
    s.driver_approach_free_km + 0.001
  );
  expected := least(
    s.driver_approach_fee_cap,
    s.driver_approach_fee_per_started_km
  );
  if (q->>'fee')::numeric <> expected then
    raise exception 'AGRIMARKET_STEP6_FIRST_STARTED_KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(
    s.driver_approach_free_km + 1
  );
  if (q->>'fee')::numeric <> expected then
    raise exception 'AGRIMARKET_STEP6_EXACT_ONE_KM_CHECK_FAILED';
  end if;

  q := public.agrimarket_compute_driver_approach_fee_v1(
    s.driver_approach_free_km + 1.001
  );
  expected := least(
    s.driver_approach_fee_cap,
    2 * s.driver_approach_fee_per_started_km
  );
  if (q->>'fee')::numeric <> expected then
    raise exception 'AGRIMARKET_STEP6_SECOND_STARTED_KM_CHECK_FAILED';
  end if;

  if to_regprocedure('public.agrimarket_compute_driver_approach_fee_v1(numeric)') is null then
    raise exception 'AGRIMARKET_STEP6_QUOTE_HELPER_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.agrimarket_driver_offers'::regclass
      and tgname='agrimarket_apply_driver_approach_offer_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP6_OFFER_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.agrimarket_orders'::regclass
      and tgname='agrimarket_apply_driver_approach_order_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP6_ORDER_TRIGGER_MISSING';
  end if;
end;
$$;