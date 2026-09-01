-- AGRIMARKET STEP 7 REPEAT-ESCALATION REAPPROVAL FIX V1
--
-- Scope: close the Step 7 sticky vehicle-consent gap only.
--
-- Problem fixed:
--   1) Motorcycle checkout escalates to Tricycle.
--   2) Customer approves Tricycle.
--   3) Farmer later corrects the load downward so Tricycle is no longer needed.
--   4) A later correction escalates to Tricycle again.
--
-- Before this fix, customer_approved_vehicle_type remained 'tricycle' after
-- step 3, so step 4 looked already approved and could bypass the Step 4 gate.
--
-- Locked behavior:
--   - whenever the confirmed load no longer requires Tricycle, reset both the
--     effective dispatch choice and customer vehicle approval to the original
--     checkout_preferred_vehicle_type baseline;
--   - a later Motorcycle -> Tricycle escalation therefore sees a clean
--     Motorcycle approval baseline and re-enters the existing Step 4 gate;
--   - if the customer originally chose Tricycle at checkout, the baseline is
--     Tricycle and no artificial Motorcycle -> Tricycle escalation is created.
--
-- No Heavy Load Fee calculation, Special Handling Fee change, Driver Approach
-- change, Step 8 driver API/identity work, cargo compatibility, discovery, or
-- UI work is introduced here.

do $$
begin
  if to_regprocedure(
    'public.agrimarket_apply_weight_aware_vehicle_v1()'
  ) is null then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_REQUIRES_STEP7_TRIGGER_FUNCTION';
  end if;

  if to_regprocedure(
    'public.agrimarket_compute_required_vehicle_v1(text,text,numeric,text,text,numeric)'
  ) is null then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_REQUIRES_STEP7_RULE_FUNCTION';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='agrimarket_orders'
      and column_name='checkout_preferred_vehicle_type'
  ) or not exists (
    select 1
    from information_schema.columns
    where table_schema='public'
      and table_name='agrimarket_orders'
      and column_name='customer_approved_vehicle_type'
  ) then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_REQUIRES_VEHICLE_BASELINES';
  end if;
end;
$$;

create or replace function public.agrimarket_apply_weight_aware_vehicle_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_motorcycle_weight_max_kg numeric(10,3);
begin
  -- If a confirmation is cleared, restore the order to its checkout vehicle
  -- baseline, including the customer-approval baseline. This prevents an old
  -- Tricycle approval from surviving a de-confirmation/re-confirmation cycle.
  if new.confirmed_cargo_weight_basis is null then
    new.required_vehicle_type := new.product_required_vehicle_type;
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
    new.customer_approved_vehicle_type := new.checkout_preferred_vehicle_type;
    return new;
  end if;

  select heavy_load_exact_tier2_max_kg
  into v_motorcycle_weight_max_kg
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_motorcycle_weight_max_kg is null then
    raise exception 'AGRIMARKET_STEP7_WEIGHT_SETTINGS_UNAVAILABLE'
      using errcode='P0001';
  end if;

  new.required_vehicle_type := public.agrimarket_compute_required_vehicle_v1(
    new.product_required_vehicle_type,
    new.confirmed_cargo_weight_basis,
    new.confirmed_cargo_weight_kg,
    new.confirmed_cargo_weight_band,
    new.confirmed_handling_tier,
    v_motorcycle_weight_max_kg
  );

  if new.required_vehicle_type='tricycle' then
    -- A Tricycle dispatch choice is effective only when the current vehicle
    -- approval is Tricycle. If approval is still the Motorcycle checkout
    -- baseline, Step 4 sees the escalation and pauses for explicit approval.
    if new.customer_approved_vehicle_type='tricycle' then
      new.preferred_vehicle_type := 'tricycle';
    else
      new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
    end if;
  else
    -- De-escalation invalidates any historical Tricycle escalation approval.
    -- Reset both values to the original checkout choice so a later re-
    -- escalation is treated as a fresh Motorcycle -> Tricycle change.
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
    new.customer_approved_vehicle_type := new.checkout_preferred_vehicle_type;
  end if;

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_weight_aware_vehicle_v1()
  from public,anon,authenticated,service_role;

-- Migration-level lifecycle regression test. A temporary table uses the real
-- Step 7 trigger function, so this verifies the exact state transition that
-- exposed the bug without inserting or mutating any production order.
do $$
declare
  v_limit numeric(10,3);
  v_row record;
begin
  select heavy_load_exact_tier2_max_kg
  into v_limit
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_limit is null then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_POSTCHECK_SETTINGS_MISSING';
  end if;

  create temporary table agrimarket_step7_repeat_escalation_test (
    confirmed_cargo_weight_basis text,
    confirmed_cargo_weight_kg numeric,
    confirmed_cargo_weight_band text,
    confirmed_handling_tier text,
    product_required_vehicle_type text,
    checkout_preferred_vehicle_type text,
    required_vehicle_type text,
    preferred_vehicle_type text,
    customer_approved_vehicle_type text
  ) on commit drop;

  create trigger agrimarket_step7_repeat_escalation_test_trg
  before update of
    confirmed_cargo_weight_basis,
    confirmed_cargo_weight_kg,
    confirmed_cargo_weight_band,
    confirmed_handling_tier,
    product_required_vehicle_type,
    checkout_preferred_vehicle_type
  on agrimarket_step7_repeat_escalation_test
  for each row
  execute function public.agrimarket_apply_weight_aware_vehicle_v1();

  insert into agrimarket_step7_repeat_escalation_test values (
    'exact',
    v_limit,
    null,
    'standard',
    'motorcycle',
    'motorcycle',
    'motorcycle',
    'motorcycle',
    'motorcycle'
  );

  -- First escalation: requirement changes, but dispatch choice remains the
  -- checkout Motorcycle until Step 4 approval occurs.
  update agrimarket_step7_repeat_escalation_test
  set confirmed_cargo_weight_kg=v_limit + 0.001;

  select * into v_row
  from agrimarket_step7_repeat_escalation_test;

  if v_row.required_vehicle_type <> 'tricycle'
     or v_row.preferred_vehicle_type <> 'motorcycle'
     or v_row.customer_approved_vehicle_type <> 'motorcycle' then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_POSTCHECK_FIRST_ESCALATION_FAILED';
  end if;

  -- Simulate the existing Step 4 customer acceptance result.
  update agrimarket_step7_repeat_escalation_test
  set customer_approved_vehicle_type='tricycle',
      preferred_vehicle_type='tricycle';

  select * into v_row
  from agrimarket_step7_repeat_escalation_test;

  if v_row.required_vehicle_type <> 'tricycle'
     or v_row.preferred_vehicle_type <> 'tricycle'
     or v_row.customer_approved_vehicle_type <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_POSTCHECK_APPROVAL_FAILED';
  end if;

  -- De-escalation must clear the historical Tricycle approval and restore the
  -- original Motorcycle checkout baseline.
  update agrimarket_step7_repeat_escalation_test
  set confirmed_cargo_weight_kg=v_limit;

  select * into v_row
  from agrimarket_step7_repeat_escalation_test;

  if v_row.required_vehicle_type <> 'motorcycle'
     or v_row.preferred_vehicle_type <> 'motorcycle'
     or v_row.customer_approved_vehicle_type <> 'motorcycle' then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_POSTCHECK_DEESCALATION_RESET_FAILED';
  end if;

  -- Repeat escalation must again leave approval/dispatch at Motorcycle. The
  -- real Step 4 AFTER trigger therefore observes Tricycle-required versus a
  -- Motorcycle-approved baseline and reopens the customer approval gate.
  update agrimarket_step7_repeat_escalation_test
  set confirmed_cargo_weight_kg=v_limit + 0.001;

  select * into v_row
  from agrimarket_step7_repeat_escalation_test;

  if v_row.required_vehicle_type <> 'tricycle'
     or v_row.preferred_vehicle_type <> 'motorcycle'
     or v_row.customer_approved_vehicle_type <> 'motorcycle' then
    raise exception 'AGRIMARKET_STEP7_REPEAT_FIX_POSTCHECK_REPEAT_ESCALATION_FAILED';
  end if;

  drop table agrimarket_step7_repeat_escalation_test;
end;
$$;
