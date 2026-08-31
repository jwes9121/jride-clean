-- AGRIMARKET WEIGHT-AWARE VEHICLE ELIGIBILITY - STEP 7 V1
--
-- Scope: vehicle eligibility only.
--
-- This migration preserves the checkout-time static product requirement as a
-- baseline, then recomputes agrimarket_orders.required_vehicle_type after the
-- farmer confirms cargo weight/weight-band and handling tier.
--
-- Locked V1 rules implemented here:
--   - 1-15 kg: no weight-based escalation.
--   - 16-25 kg: no automatic weight-based escalation; motorcycle remains
--     eligible when the product baseline permits it.
--   - 26-50 kg: tricycle required.
--   - 51-100 kg: tricycle required.
--   - over 100 kg: unsupported (already rejected by Step 1B; fail closed here
--     too if such a value reaches this calculation).
--   - approximate bands are authoritative as bands and are never converted to
--     synthetic kilogram values.
--   - live_single/live_difficult handling requires a tricycle independently of
--     nominal weight.
--   - an existing static product-level tricycle requirement always wins.
--
-- No Heavy Load Fee calculation, Special Handling Fee change, Driver Approach
-- Fee change, driver-facing identity/API work, cargo-compatibility rule,
-- product-first discovery/More-from-this-farmer UI, or checkout UI work is
-- introduced here.

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
      and column_name='required_vehicle_type'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRED_VEHICLE_MISSING';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_basis'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_band'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_cargo_weight_kg'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='confirmed_handling_tier'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP1B_CARGO_CONFIRMATION';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_pricing_settings'
      and column_name='heavy_load_exact_tier2_max_kg'
  ) then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP5_WEIGHT_THRESHOLDS';
  end if;

  if to_regprocedure(
    'public.agrimarket_evaluate_customer_reapproval_v1()'
  ) is null then
    raise exception 'AGRIMARKET_STEP7_REQUIRES_STEP4_REAPPROVAL_GATE';
  end if;
end;
$$;

-- Preserve the checkout-time static per-product requirement before Step 7
-- begins using required_vehicle_type as the final, confirmed-load requirement.
alter table public.agrimarket_orders
  add column product_required_vehicle_type text;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_product_required_vehicle_chk
    check (
      product_required_vehicle_type is null
      or product_required_vehicle_type in ('either','motorcycle','tricycle')
    );

update public.agrimarket_orders
set product_required_vehicle_type = required_vehicle_type
where product_required_vehicle_type is null;

alter table public.agrimarket_orders
  alter column product_required_vehicle_type set not null;

comment on column public.agrimarket_orders.product_required_vehicle_type is
  'Checkout-time static product vehicle requirement snapshot. Step 7 preserves this baseline while required_vehicle_type becomes the final weight/handling-aware requirement.';

-- Pure rule helper. The exact-weight motorcycle ceiling is supplied from the
-- active Step 5 settings; approximate bands remain discrete and are not turned
-- into synthetic kg values.
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
set search_path = public
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

  if v_basis = 'exact' then
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
  elsif v_basis = 'approximate' then
    if v_band not in ('1_15','16_25','26_50','51_100','over_100') then
      raise exception 'AGRIMARKET_STEP7_WEIGHT_BAND_REQUIRED'
        using errcode='P0001';
    end if;
    if v_band = 'over_100' then
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

  v_handling_requires_tricycle :=
    v_handling in ('live_single','live_difficult');

  if v_product = 'tricycle'
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
  'Step 7 pure vehicle-eligibility rule: preserves static product requirement and escalates to tricycle for confirmed tier-3/4 weight or live livestock handling.';

create or replace function public.agrimarket_apply_weight_aware_vehicle_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_motorcycle_weight_max_kg numeric(10,3);
begin
  -- No confirmed load yet: retain the static checkout baseline.
  if new.confirmed_cargo_weight_basis is null then
    new.required_vehicle_type := new.product_required_vehicle_type;
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
  product_required_vehicle_type
on public.agrimarket_orders
for each row
execute function public.agrimarket_apply_weight_aware_vehicle_v1();

-- Re-evaluate existing confirmed, unassigned, pre-dispatch orders only. Step 4
-- will pause them for customer re-approval if this newly computed requirement
-- escalates an approved motorcycle order to tricycle.
update public.agrimarket_orders
set confirmed_cargo_weight_basis = confirmed_cargo_weight_basis
where confirmed_cargo_weight_basis is not null
  and assigned_driver_id is null
  and status in (
    'producer_accepted','preparing','ready_for_dispatch',
    'awaiting_customer_reapproval'
  );

-- Rule self-checks use the configured exact-weight tier-2 ceiling and fixed
-- approximate bands. They verify boundaries without inserting test orders.
do $$
declare
  v_limit numeric(10,3);
  v_result text;
begin
  select heavy_load_exact_tier2_max_kg into v_limit
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

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='product_required_vehicle_type'
      and is_nullable='NO'
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BASELINE_COLUMN_FAILED';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_apply_weight_aware_vehicle_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_TRIGGER_FAILED';
  end if;

  if exists (
    select 1 from public.agrimarket_orders
    where product_required_vehicle_type is null
  ) then
    raise exception 'AGRIMARKET_STEP7_POSTCHECK_BASELINE_BACKFILL_FAILED';
  end if;
end;
$$;
