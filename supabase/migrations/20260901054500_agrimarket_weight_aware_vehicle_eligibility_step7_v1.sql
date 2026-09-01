-- AGRIMARKET WEIGHT-AWARE VEHICLE ELIGIBILITY - STEP 7 V1
--
-- Scope: vehicle eligibility only.
--
-- Step 7 preserves both checkout-time vehicle decisions, then recomputes the
-- final required vehicle after farmer cargo confirmation:
--   product_required_vehicle_type  = static per-product requirement snapshot
--   checkout_preferred_vehicle_type = customer's original vehicle choice
--   required_vehicle_type          = final weight/handling-aware requirement
--   preferred_vehicle_type         = effective dispatch vehicle choice
--
-- Locked V1 rules:
--   - 1-15 kg: no weight-based escalation.
--   - 16-25 kg: no automatic weight-based escalation; motorcycle remains
--     eligible when the static product requirement permits it.
--   - 26-50 kg: tricycle required.
--   - 51-100 kg: tricycle required.
--   - over 100 kg: unsupported.
--   - approximate weight bands are authoritative as bands; they are never
--     converted into synthetic exact kilogram values.
--   - live_single/live_difficult requires a tricycle independently of weight.
--   - a static product-level tricycle requirement always wins.
--   - Motorcycle -> Tricycle escalation remains subject to the existing Step 4
--     customer re-approval gate before dispatch.
--
-- No Heavy Load Fee calculation, Special Handling Fee change, Driver Approach
-- Fee change, driver-facing API/identity work, cargo compatibility, product
-- discovery/More-from-this-farmer behavior, or UI work is introduced here.

do $$
begin
  if to_regclass('public.agrimarket_orders') is null then
    raise exception 'AGRIMARKET_STEP7_ORDERS_MISSING';
  end if;

  if to_regclass('public.agrimarket_pricing_settings') is null then
    raise exception 'AGRIMARKET_STEP7_PRICING_SETTINGS_MISSING';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='preferred_vehicle_type'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='required_vehicle_type'
  ) then
    raise exception 'AGRIMARKET_STEP7_VEHICLE_COLUMNS_MISSING';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_basis'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_kg'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_band'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_handling_tier'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP1B_CARGO_CONFIRMATION';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='customer_approved_vehicle_type'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP4_REAPPROVAL_COLUMNS';
  end if;

  if to_regprocedure(
    'public.agrimarket_evaluate_customer_reapproval_v1()'
  ) is null or to_regprocedure(
    'public.agrimarket_customer_respond_reapproval_v1(text,uuid,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP4_REAPPROVAL_GATE';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_pricing_settings'
      and column_name='heavy_load_exact_tier2_max_kg'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP5_WEIGHT_THRESHOLDS';
  end if;
end;
$$;

-- Before Step 7, required_vehicle_type is still the static product-derived
-- result and preferred_vehicle_type is still the checkout vehicle selection.
-- Snapshot both before either column becomes dynamic.
alter table public.agrimarket_orders
  add column product_required_vehicle_type text,
  add column checkout_preferred_vehicle_type text;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_product_required_vehicle_chk
    check (
      product_required_vehicle_type is null
      or product_required_vehicle_type in ('either','motorcycle','tricycle')
    ),
  add constraint agrimarket_orders_checkout_preferred_vehicle_chk
    check (
      checkout_preferred_vehicle_type is null
      or checkout_preferred_vehicle_type in ('motorcycle','tricycle')
    );

update public.agrimarket_orders
set product_required_vehicle_type=required_vehicle_type,
    checkout_preferred_vehicle_type=preferred_vehicle_type
where product_required_vehicle_type is null
   or checkout_preferred_vehicle_type is null;

alter table public.agrimarket_orders
  alter column product_required_vehicle_type set not null,
  alter column checkout_preferred_vehicle_type set not null;

comment on column public.agrimarket_orders.product_required_vehicle_type is
  'Checkout-time static product vehicle requirement snapshot: either, motorcycle, or tricycle. Step 7 uses this immutable order baseline when recomputing final vehicle eligibility.';
comment on column public.agrimarket_orders.checkout_preferred_vehicle_type is
  'Customer vehicle choice captured at checkout. Step 7 keeps this original choice separate from preferred_vehicle_type, which may become tricycle after an approved escalation.';

-- Future order-creation RPC versions do not need to know about the Step 7
-- baseline columns. Capture them centrally before each insert.
create or replace function public.agrimarket_initialize_step7_vehicle_baselines_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.required_vehicle_type not in ('either','motorcycle','tricycle') then
    raise exception 'AGRIMARKET_STEP7_PRODUCT_VEHICLE_INVALID'
      using errcode='P0001';
  end if;

  if new.preferred_vehicle_type not in ('motorcycle','tricycle') then
    raise exception 'AGRIMARKET_STEP7_PREFERRED_VEHICLE_INVALID'
      using errcode='P0001';
  end if;

  new.product_required_vehicle_type := new.required_vehicle_type;
  new.checkout_preferred_vehicle_type := new.preferred_vehicle_type;
  return new;
end;
$$;

revoke all on function public.agrimarket_initialize_step7_vehicle_baselines_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_initialize_step7_vehicle_baselines_trg
  on public.agrimarket_orders;

create trigger agrimarket_initialize_step7_vehicle_baselines_trg
before insert on public.agrimarket_orders
for each row
execute function public.agrimarket_initialize_step7_vehicle_baselines_v1();

-- Pure rule helper. Exact-weight orders use the configured Step 5 tier-2 upper
-- bound as the motorcycle maximum. Approximate bands remain discrete tiers.
create or replace function public.agrimarket_compute_required_vehicle_v1(
  p_product_required_vehicle_type text,
  p_confirmed_cargo_weight_basis text,
  p_confirmed_cargo_weight_kg numeric,
  p_confirmed_cargo_weight_band text,
  p_confirmed_handling_tier text,
  p_motorcycle_weight_max_kg numeric
)
returns text
language plpgsql
immutable
security invoker
set search_path=public
as $$
declare
  v_product text := lower(trim(coalesce(p_product_required_vehicle_type,'')));
  v_basis text := lower(trim(coalesce(p_confirmed_cargo_weight_basis,'')));
  v_band text := lower(trim(coalesce(p_confirmed_cargo_weight_band,'')));
  v_handling text := lower(trim(coalesce(p_confirmed_handling_tier,'')));
  v_weight_requires_tricycle boolean := false;
  v_handling_requires_tricycle boolean := false;
begin
  if v_product not in ('either','motorcycle','tricycle') then
    raise exception 'AGRIMARKET_STEP7_PRODUCT_VEHICLE_INVALID'
      using errcode='P0001';
  end if;

  if p_motorcycle_weight_max_kg is null or p_motorcycle_weight_max_kg <= 0 then
    raise exception 'AGRIMARKET_STEP7_MOTORCYCLE_WEIGHT_LIMIT_INVALID'
      using errcode='P0001';
  end if;

  if v_basis='exact' then
    if p_confirmed_cargo_weight_kg is null or p_confirmed_cargo_weight_kg <= 0 then
      raise exception 'AGRIMARKET_STEP7_EXACT_WEIGHT_REQUIRED'
        using errcode='P0001';
    end if;
    if p_confirmed_cargo_weight_kg > 100 then
      raise exception 'AGRIMARKET_CARGO_OVER_100KG_UNSUPPORTED'
        using errcode='P0001';
    end if;

    v_weight_requires_tricycle :=
      p_confirmed_cargo_weight_kg > p_motorcycle_weight_max_kg;
  elsif v_basis='approximate' then
    if v_band not in ('1_15','16_25','26_50','51_100','over_100') then
      raise exception 'AGRIMARKET_STEP7_WEIGHT_BAND_REQUIRED'
        using errcode='P0001';
    end if;
    if v_band='over_100' then
      raise exception 'AGRIMARKET_CARGO_OVER_100KG_UNSUPPORTED'
        using errcode='P0001';
    end if;

    v_weight_requires_tricycle := v_band in ('26_50','51_100');
  else
    raise exception 'AGRIMARKET_STEP7_WEIGHT_BASIS_REQUIRED'
      using errcode='P0001';
  end if;

  if v_handling not in ('standard','bulky','live_single','live_difficult') then
    raise exception 'AGRIMARKET_STEP7_HANDLING_TIER_REQUIRED'
      using errcode='P0001';
  end if;

  -- Step 1B prevents live_livestock from being confirmed below live_single,
  -- so the confirmed handling tier is the order-level livestock signal here.
  v_handling_requires_tricycle :=
    v_handling in ('live_single','live_difficult');

  if v_product='tricycle'
     or v_weight_requires_tricycle
     or v_handling_requires_tricycle then
    return 'tricycle';
  end if;

  return v_product;
end;
$$;

revoke all on function public.agrimarket_compute_required_vehicle_v1(
  text,text,numeric,text,text,numeric
) from public,anon,authenticated;
grant execute on function public.agrimarket_compute_required_vehicle_v1(
  text,text,numeric,text,text,numeric
) to service_role;

comment on function public.agrimarket_compute_required_vehicle_v1(
  text,text,numeric,text,text,numeric
) is
  'Step 7 pure vehicle eligibility rule. Preserves static product requirement and escalates to tricycle for confirmed tier-3/4 weight or live livestock handling.';

-- Apply the final requirement whenever farmer-confirmed cargo information is
-- written or corrected. preferred_vehicle_type remains the checkout choice
-- until a required Tricycle has actually been approved by the customer.
create or replace function public.agrimarket_apply_weight_aware_vehicle_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_motorcycle_weight_max_kg numeric(10,3);
begin
  if new.confirmed_cargo_weight_basis is null then
    new.required_vehicle_type := new.product_required_vehicle_type;
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
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

  if new.required_vehicle_type='tricycle'
     and new.customer_approved_vehicle_type='tricycle' then
    new.preferred_vehicle_type := 'tricycle';
  else
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
  end if;

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_weight_aware_vehicle_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_apply_weight_aware_vehicle_trg
  on public.agrimarket_orders;

create trigger agrimarket_apply_weight_aware_vehicle_trg
before update of
  confirmed_cargo_weight_basis,
  confirmed_cargo_weight_kg,
  confirmed_cargo_weight_band,
  confirmed_handling_tier,
  product_required_vehicle_type,
  checkout_preferred_vehicle_type
on public.agrimarket_orders
for each row
execute function public.agrimarket_apply_weight_aware_vehicle_v1();

-- Step 4 intentionally left room for Step 7 to extend its watched columns.
-- Recreate only the trigger definition, not its function or policy, so any
-- weight-only correction still re-evaluates the existing consent gate.
drop trigger if exists agrimarket_evaluate_customer_reapproval_trg
  on public.agrimarket_orders;

create trigger agrimarket_evaluate_customer_reapproval_trg
after update of
  confirmed_cargo_weight_basis,
  confirmed_cargo_weight_kg,
  confirmed_cargo_weight_band,
  confirmed_handling_tier,
  handling_fee,
  required_vehicle_type
on public.agrimarket_orders
for each row
execute function public.agrimarket_evaluate_customer_reapproval_v1();

-- Step 4 records an accepted Motorcycle -> Tricycle escalation in
-- customer_approved_vehicle_type. Align the effective dispatch choice only
-- after that explicit approval. If a later correction removes the Tricycle
-- requirement, the weight-aware trigger restores the checkout choice.
create or replace function public.agrimarket_apply_approved_vehicle_choice_v1()
returns trigger
language plpgsql
security invoker
set search_path=public
as $$
begin
  if new.required_vehicle_type='tricycle'
     and new.customer_approved_vehicle_type='tricycle' then
    new.preferred_vehicle_type := 'tricycle';
  else
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
  end if;

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_approved_vehicle_choice_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_apply_approved_vehicle_choice_trg
  on public.agrimarket_orders;

create trigger agrimarket_apply_approved_vehicle_choice_trg
before update of customer_approved_vehicle_type
on public.agrimarket_orders
for each row
execute function public.agrimarket_apply_approved_vehicle_choice_v1();

-- Re-evaluate only confirmed, unassigned, pre-dispatch orders. The existing
-- Step 4 AFTER trigger now watches weight fields, so a newly detected
-- Motorcycle -> Tricycle escalation enters customer re-approval before offer.
update public.agrimarket_orders
set confirmed_cargo_weight_basis=confirmed_cargo_weight_basis
where confirmed_cargo_weight_basis is not null
  and assigned_driver_id is null
  and status in (
    'producer_accepted','preparing','ready_for_dispatch',
    'awaiting_customer_reapproval'
  );

-- Self-check the exact boundary, approximate bands, livestock override, static
-- Tricycle override, baseline persistence, and trigger installation.
do $$
declare
  v_limit numeric(10,3);
  v_result text;
begin
  select heavy_load_exact_tier2_max_kg
  into v_limit
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_limit is null then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_SETTINGS_MISSING';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'either','exact',v_limit,null,'standard',v_limit
  );
  if v_result <> 'either' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_EXACT_LIMIT_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'motorcycle','exact',v_limit + 0.001,null,'standard',v_limit
  );
  if v_result <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_EXACT_ESCALATION_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'either','approximate',null,'16_25','standard',v_limit
  );
  if v_result <> 'either' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BAND2_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'either','approximate',null,'26_50','standard',v_limit
  );
  if v_result <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BAND3_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'motorcycle','approximate',null,'51_100','standard',v_limit
  );
  if v_result <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BAND4_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'either','approximate',null,'1_15','live_single',v_limit
  );
  if v_result <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_LIVESTOCK_FAILED';
  end if;

  v_result := public.agrimarket_compute_required_vehicle_v1(
    'tricycle','approximate',null,'1_15','standard',v_limit
  );
  if v_result <> 'tricycle' then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_STATIC_TRICYCLE_FAILED';
  end if;

  if exists (
    select 1 from public.agrimarket_orders
    where product_required_vehicle_type is null
       or checkout_preferred_vehicle_type is null
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BASELINE_BACKFILL_FAILED';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='product_required_vehicle_type'
      and is_nullable='NO'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='checkout_preferred_vehicle_type'
      and is_nullable='NO'
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BASELINE_COLUMNS_FAILED';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_initialize_step7_vehicle_baselines_trg'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_apply_weight_aware_vehicle_trg'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_apply_approved_vehicle_choice_trg'
      and not tgisinternal
  ) or not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_evaluate_customer_reapproval_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_TRIGGER_INSTALL_FAILED';
  end if;
end;
$$;
