-- AGRIMARKET SPECIAL HANDLING FEE - STEP 3 V1
--
-- Repurpose the existing agrimarket_orders.handling_fee monetary slot as the
-- farmer-confirmed Special Handling Fee. The farmer already confirms
-- confirmed_handling_tier before dispatch; this migration makes that tier the
-- only source of the monetary handling fee.
--
-- Locked tier amounts for this step:
--   standard       -> 0
--   bulky          -> 20
--   live_single    -> 40
--   live_difficult -> 60
--
-- The existing total_payable and driver_delivery_payout generated columns are
-- intentionally not redefined. Both already include handling_fee.

-- Preconditions: Step 1 + Step 1B must already exist.
do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'agrimarket_orders'
      and column_name = 'confirmed_handling_tier'
  ) then
    raise exception 'AGRIMARKET_STEP3_REQUIRES_CONFIRMED_HANDLING_TIER';
  end if;

  if to_regprocedure(
    'public.agrimarket_confirm_order_cargo_v2(text,uuid,text,numeric,text,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP3_REQUIRES_CARGO_CONFIRMATION_V2';
  end if;

  if to_regprocedure(
    'public.agrimarket_driver_execute_v1(text,uuid,text,jsonb,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP3_REQUIRES_DRIVER_EXECUTE_V1';
  end if;
end;
$$;

-- Preserve historical 10/30/50 values if they ever exist, but allow the new
-- 60-peso system tier. New confirmed orders are constrained separately below
-- to the locked 0/20/40/60 mapping.
alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_handling_fee_chk;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_handling_fee_chk
  check (handling_fee in (0,10,20,30,40,50,60));

-- A nonzero Special Handling Fee is explained by confirmed_handling_tier, so a
-- legacy driver-entered handling reason is no longer required.
alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_handling_reason_required_chk;

-- The legacy audit table remains readable for historical rows and for the
-- existing pickup-time "locked" audit event. It must accept the new 60 tier,
-- and a driver reason is no longer required for a system-authorized fee.
alter table public.agrimarket_handling_fee_events
  drop constraint if exists agrimarket_handling_fee_events_amount_chk;

alter table public.agrimarket_handling_fee_events
  add constraint agrimarket_handling_fee_events_amount_chk
  check (amount in (0,10,20,30,40,50,60));

alter table public.agrimarket_handling_fee_events
  drop constraint if exists agrimarket_handling_fee_events_reason_required_chk;

-- Central system writer for the repurposed monetary slot. No producer/API
-- signature changes are needed: the existing confirmation flow already writes
-- confirmed_handling_tier, and this trigger derives handling_fee atomically in
-- the same UPDATE.
create or replace function public.agrimarket_apply_special_handling_fee_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.confirmed_handling_tier is null then
    new.handling_fee := 0;
    new.handling_reason := null;
    new.handling_selected_by_driver_id := null;
    new.handling_selected_at := null;
    new.handling_locked_at := null;
    return new;
  end if;

  if new.confirmed_handling_tier not in (
    'standard','bulky','live_single','live_difficult'
  ) then
    raise exception 'AGRIMARKET_INVALID_HANDLING_TIER' using errcode = 'P0001';
  end if;

  new.handling_fee := case new.confirmed_handling_tier
    when 'standard' then 0
    when 'bulky' then 20
    when 'live_single' then 40
    when 'live_difficult' then 60
  end;

  -- These fields belonged to the retired driver-selection mechanism. Keep the
  -- columns for historical compatibility, but new confirmations never populate
  -- them.
  new.handling_reason := null;
  new.handling_selected_by_driver_id := null;
  new.handling_selected_at := null;

  -- Lock at farmer confirmation, before driver assignment. The existing
  -- set_handling_fee branch already refuses changes whenever this is non-null.
  new.handling_locked_at := coalesce(
    old.handling_locked_at,
    new.handling_locked_at,
    new.updated_at,
    clock_timestamp()
  );

  return new;
end;
$$;

revoke all on function public.agrimarket_apply_special_handling_fee_v1()
  from public, anon, authenticated, service_role;

-- The trigger fires even when the same tier is written again, which keeps
-- retries/idempotent producer-confirmation calls consistent.
drop trigger if exists agrimarket_apply_special_handling_fee_trg
  on public.agrimarket_orders;

create trigger agrimarket_apply_special_handling_fee_trg
before update of confirmed_handling_tier
on public.agrimarket_orders
for each row
execute function public.agrimarket_apply_special_handling_fee_v1();

-- Retire the legacy driver-selection write path at the table boundary too.
-- Normal system fee recalculation can still update handling_fee directly in a
-- later migration, but no caller may write the legacy driver-selection metadata.
create or replace function public.agrimarket_reject_driver_handling_selection_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.handling_selected_by_driver_id is distinct from old.handling_selected_by_driver_id
     or new.handling_selected_at is distinct from old.handling_selected_at then
    raise exception 'AGRIMARKET_DRIVER_HANDLING_FEE_SELECTION_RETIRED'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.agrimarket_reject_driver_handling_selection_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists agrimarket_reject_driver_handling_selection_trg
  on public.agrimarket_orders;

create trigger agrimarket_reject_driver_handling_selection_trg
before update of handling_selected_by_driver_id, handling_selected_at
on public.agrimarket_orders
for each row
execute function public.agrimarket_reject_driver_handling_selection_v1();

-- Backfill any already-confirmed pre-Step-3 rows through the same authoritative
-- trigger path. This is a no-op on environments with no confirmed orders.
update public.agrimarket_orders
set confirmed_handling_tier = confirmed_handling_tier
where confirmed_handling_tier is not null;

-- Enforce that a confirmed tier and its monetary fee cannot drift apart. The
-- legacy 10/30/50 amounts remain possible only on rows that predate a confirmed
-- handling tier.
alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_special_handling_fee_matches_tier_chk;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_special_handling_fee_matches_tier_chk
  check (
    confirmed_handling_tier is null
    or (confirmed_handling_tier = 'standard' and handling_fee = 0)
    or (confirmed_handling_tier = 'bulky' and handling_fee = 20)
    or (confirmed_handling_tier = 'live_single' and handling_fee = 40)
    or (confirmed_handling_tier = 'live_difficult' and handling_fee = 60)
  );

-- Every confirmed tier is locked before driver assignment. This makes the old
-- driver set_handling_fee action return its existing HANDLING_FEE_LOCKED result
-- instead of allowing a free-choice amount.
alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_confirmed_handling_locked_chk;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_confirmed_handling_locked_chk
  check (confirmed_handling_tier is null or handling_locked_at is not null);

comment on column public.agrimarket_orders.handling_fee is
  'System-authorized Special Handling Fee derived from farmer-confirmed handling tier. New values: standard=0, bulky=20, live_single=40, live_difficult=60. Paid entirely to the driver.';

comment on column public.agrimarket_orders.handling_reason is
  'Legacy driver-selected handling reason. Not populated by the Special Handling Fee flow.';

comment on column public.agrimarket_orders.handling_selected_by_driver_id is
  'Legacy driver-selection metadata. New Special Handling Fees are farmer-confirmed and system-derived.';

comment on column public.agrimarket_orders.handling_selected_at is
  'Legacy driver-selection metadata. New Special Handling Fees are farmer-confirmed and system-derived.';

comment on function public.agrimarket_apply_special_handling_fee_v1() is
  'Derives and locks agrimarket_orders.handling_fee from confirmed_handling_tier at farmer confirmation.';

comment on function public.agrimarket_reject_driver_handling_selection_v1() is
  'Blocks the retired driver-selected Agrimarket handling-fee write path.';

-- Self-verifying postconditions.
do $$
declare
  v_driver_def text;
begin
  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.agrimarket_orders'::regclass
      and tgname = 'agrimarket_apply_special_handling_fee_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP3_SPECIAL_HANDLING_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.agrimarket_orders'::regclass
      and tgname = 'agrimarket_reject_driver_handling_selection_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP3_DRIVER_SELECTION_GUARD_MISSING';
  end if;

  if exists (
    select 1
    from public.agrimarket_orders
    where confirmed_handling_tier is not null
      and (
        handling_selected_by_driver_id is not null
        or handling_selected_at is not null
        or handling_reason is not null
        or handling_locked_at is null
        or (confirmed_handling_tier = 'standard' and handling_fee <> 0)
        or (confirmed_handling_tier = 'bulky' and handling_fee <> 20)
        or (confirmed_handling_tier = 'live_single' and handling_fee <> 40)
        or (confirmed_handling_tier = 'live_difficult' and handling_fee <> 60)
      )
  ) then
    raise exception 'AGRIMARKET_STEP3_SPECIAL_HANDLING_POSTCONDITION_FAILED';
  end if;

  select pg_get_functiondef(
    'public.agrimarket_driver_execute_v1(text,uuid,text,jsonb,timestamptz)'::regprocedure
  ) into v_driver_def;

  if position('set_handling_fee' in lower(v_driver_def)) = 0
     or position('handling_locked_at is not null' in lower(v_driver_def)) = 0 then
    raise exception 'AGRIMARKET_STEP3_DRIVER_LOCK_GUARD_NOT_FOUND';
  end if;
end;
$$;
