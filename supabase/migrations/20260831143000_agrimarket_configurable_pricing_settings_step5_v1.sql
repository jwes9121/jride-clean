-- AGRIMARKET CONFIGURABLE PRICING SETTINGS - STEP 5 V1
--
-- Scope: settings-table additions only.
-- No Heavy Load Fee calculation, Special Handling recalculation, Driver
-- Approach Fee calculation, vehicle-eligibility logic, dispatch change,
-- customer-total formula change, or pricing-version bump is introduced here.
--
-- Exact-weight orders will later use the four configurable max-kg thresholds.
-- Approximate-band orders will later map 1_15 / 16_25 / 26_50 / 51_100
-- directly to heavy-load tiers 1 / 2 / 3 / 4. No band is converted to a
-- synthetic exact kilogram value.

do $$
begin
  if to_regclass('public.agrimarket_pricing_settings') is null then
    raise exception 'AGRIMARKET_STEP5_PRICING_SETTINGS_MISSING';
  end if;

  if not exists (
    select 1
    from public.agrimarket_pricing_settings
    where id = 1
  ) then
    raise exception 'AGRIMARKET_STEP5_SINGLETON_ROW_MISSING';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agrimarket_pricing_settings'
      and column_name = 'base_delivery_fee'
  ) then
    raise exception 'AGRIMARKET_STEP5_REQUIRES_EXISTING_PRICING_SCHEMA';
  end if;
end;
$$;

alter table public.agrimarket_pricing_settings
  add column heavy_load_exact_tier1_max_kg numeric(10,3) not null default 15,
  add column heavy_load_exact_tier2_max_kg numeric(10,3) not null default 25,
  add column heavy_load_exact_tier3_max_kg numeric(10,3) not null default 50,
  add column heavy_load_exact_tier4_max_kg numeric(10,3) not null default 100,
  add column heavy_load_tier1_fee numeric(10,2) not null default 0,
  add column heavy_load_tier2_fee numeric(10,2) not null default 20,
  add column heavy_load_tier3_fee numeric(10,2) not null default 40,
  add column heavy_load_tier4_fee numeric(10,2) not null default 80,
  add column special_handling_standard_fee numeric(10,2) not null default 0,
  add column special_handling_bulky_fee numeric(10,2) not null default 20,
  add column special_handling_live_single_fee numeric(10,2) not null default 40,
  add column special_handling_live_difficult_fee numeric(10,2) not null default 60,
  add column driver_approach_free_km numeric(10,3) not null default 2,
  add column driver_approach_fee_per_started_km numeric(10,2) not null default 10,
  add column driver_approach_fee_cap numeric(10,2) not null default 50;

alter table public.agrimarket_pricing_settings
  add constraint agrimarket_pricing_heavy_load_thresholds_chk
    check (
      heavy_load_exact_tier1_max_kg > 0
      and heavy_load_exact_tier2_max_kg > heavy_load_exact_tier1_max_kg
      and heavy_load_exact_tier3_max_kg > heavy_load_exact_tier2_max_kg
      and heavy_load_exact_tier4_max_kg > heavy_load_exact_tier3_max_kg
    ),
  add constraint agrimarket_pricing_heavy_load_fees_chk
    check (
      heavy_load_tier1_fee >= 0
      and heavy_load_tier2_fee >= heavy_load_tier1_fee
      and heavy_load_tier3_fee >= heavy_load_tier2_fee
      and heavy_load_tier4_fee >= heavy_load_tier3_fee
    ),
  add constraint agrimarket_pricing_special_handling_fees_chk
    check (
      special_handling_standard_fee >= 0
      and special_handling_bulky_fee >= special_handling_standard_fee
      and special_handling_live_single_fee >= special_handling_bulky_fee
      and special_handling_live_difficult_fee >= special_handling_live_single_fee
    ),
  add constraint agrimarket_pricing_driver_approach_chk
    check (
      driver_approach_free_km >= 0
      and driver_approach_fee_per_started_km >= 0
      and driver_approach_fee_cap >= 0
    );

-- Step 5 only stages configuration. Existing live pricing calculations do not
-- consume these fields yet, so pricing_version intentionally stays unchanged.
update public.agrimarket_pricing_settings
set updated_at = clock_timestamp(),
    updated_by = 'agrimarket_configurable_pricing_settings_step5_v1'
where id = 1;

comment on column public.agrimarket_pricing_settings.heavy_load_exact_tier1_max_kg is
  'Maximum exact cargo weight in kg for Heavy Load tier 1. Default 15 kg.';
comment on column public.agrimarket_pricing_settings.heavy_load_exact_tier2_max_kg is
  'Maximum exact cargo weight in kg for Heavy Load tier 2. Default 25 kg.';
comment on column public.agrimarket_pricing_settings.heavy_load_exact_tier3_max_kg is
  'Maximum exact cargo weight in kg for Heavy Load tier 3. Default 50 kg.';
comment on column public.agrimarket_pricing_settings.heavy_load_exact_tier4_max_kg is
  'Maximum exact cargo weight in kg for Heavy Load tier 4. Default 100 kg; above this remains unsupported in V1.';
comment on column public.agrimarket_pricing_settings.heavy_load_tier1_fee is
  'Driver Heavy Load compensation for tier 1 / approximate band 1_15. Default PHP 0.';
comment on column public.agrimarket_pricing_settings.heavy_load_tier2_fee is
  'Driver Heavy Load compensation for tier 2 / approximate band 16_25. Default PHP 20.';
comment on column public.agrimarket_pricing_settings.heavy_load_tier3_fee is
  'Driver Heavy Load compensation for tier 3 / approximate band 26_50. Default PHP 40.';
comment on column public.agrimarket_pricing_settings.heavy_load_tier4_fee is
  'Driver Heavy Load compensation for tier 4 / approximate band 51_100. Default PHP 80.';
comment on column public.agrimarket_pricing_settings.special_handling_standard_fee is
  'Driver Special Handling compensation for standard. Default PHP 0.';
comment on column public.agrimarket_pricing_settings.special_handling_bulky_fee is
  'Driver Special Handling compensation for bulky. Default PHP 20.';
comment on column public.agrimarket_pricing_settings.special_handling_live_single_fee is
  'Driver Special Handling compensation for live_single. Default PHP 40.';
comment on column public.agrimarket_pricing_settings.special_handling_live_difficult_fee is
  'Driver Special Handling compensation for live_difficult. Default PHP 60.';
comment on column public.agrimarket_pricing_settings.driver_approach_free_km is
  'AgriMarket driver-to-farmer approach distance included at no charge. Default 2 km.';
comment on column public.agrimarket_pricing_settings.driver_approach_fee_per_started_km is
  'AgriMarket driver approach compensation per started km above the free distance. Default PHP 10.';
comment on column public.agrimarket_pricing_settings.driver_approach_fee_cap is
  'Maximum AgriMarket driver approach compensation. Default PHP 50.';

-- Self-verifying postconditions: verify schema/default values only. Step 5 does
-- not assert any consumer because no calculation logic belongs in this patch.
do $$
declare
  v public.agrimarket_pricing_settings%rowtype;
begin
  select * into v
  from public.agrimarket_pricing_settings
  where id = 1;

  if v.id is null then
    raise exception 'AGRIMARKET_STEP5_SINGLETON_ROW_LOST';
  end if;

  if v.heavy_load_exact_tier1_max_kg <> 15
     or v.heavy_load_exact_tier2_max_kg <> 25
     or v.heavy_load_exact_tier3_max_kg <> 50
     or v.heavy_load_exact_tier4_max_kg <> 100 then
    raise exception 'AGRIMARKET_STEP5_HEAVY_LOAD_THRESHOLDS_UNEXPECTED';
  end if;

  if v.heavy_load_tier1_fee <> 0
     or v.heavy_load_tier2_fee <> 20
     or v.heavy_load_tier3_fee <> 40
     or v.heavy_load_tier4_fee <> 80 then
    raise exception 'AGRIMARKET_STEP5_HEAVY_LOAD_FEES_UNEXPECTED';
  end if;

  if v.special_handling_standard_fee <> 0
     or v.special_handling_bulky_fee <> 20
     or v.special_handling_live_single_fee <> 40
     or v.special_handling_live_difficult_fee <> 60 then
    raise exception 'AGRIMARKET_STEP5_SPECIAL_HANDLING_FEES_UNEXPECTED';
  end if;

  if v.driver_approach_free_km <> 2
     or v.driver_approach_fee_per_started_km <> 10
     or v.driver_approach_fee_cap <> 50 then
    raise exception 'AGRIMARKET_STEP5_DRIVER_APPROACH_SETTINGS_UNEXPECTED';
  end if;
end;
$$;