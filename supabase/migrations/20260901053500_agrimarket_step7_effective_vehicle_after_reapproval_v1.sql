-- AGRIMARKET STEP 7 EFFECTIVE VEHICLE AFTER REAPPROVAL V1
--
-- Scope: vehicle eligibility integration only.
--
-- Step 4 stores an accepted Motorcycle -> Tricycle escalation in
-- customer_approved_vehicle_type. Existing dispatch selects candidates from
-- preferred_vehicle_type. Once the customer explicitly accepts the required
-- Tricycle, keep that dispatch selector aligned with the accepted requirement
-- so the order does not remain stuck looking for the original Motorcycle.
--
-- No driver-facing API/identity work, cargo compatibility, pricing change,
-- product discovery, or UI work is introduced here.

do $$
begin
  if to_regprocedure(
    'public.agrimarket_customer_respond_reapproval_v1(text,uuid,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP7_EFFECTIVE_VEHICLE_REQUIRES_STEP4';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='preferred_vehicle_type'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='required_vehicle_type'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='customer_approved_vehicle_type'
  ) then
    raise exception 'AGRIMARKET_STEP7_EFFECTIVE_VEHICLE_COLUMNS_MISSING';
  end if;
end;
$$;

create or replace function public.agrimarket_apply_approved_vehicle_choice_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.required_vehicle_type='tricycle'
     and new.customer_approved_vehicle_type='tricycle' then
    new.preferred_vehicle_type := 'tricycle';
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

-- Align any pre-dispatch row that already has a recorded approved Tricycle.
-- This is idempotent and does not bypass the Step 4 approval gate.
update public.agrimarket_orders
set preferred_vehicle_type='tricycle'
where required_vehicle_type='tricycle'
  and customer_approved_vehicle_type='tricycle'
  and preferred_vehicle_type <> 'tricycle'
  and assigned_driver_id is null
  and status in (
    'producer_accepted','preparing','ready_for_dispatch','dispatching'
  );

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname='agrimarket_apply_approved_vehicle_choice_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP7_EFFECTIVE_VEHICLE_TRIGGER_FAILED';
  end if;

  if exists (
    select 1 from public.agrimarket_orders
    where required_vehicle_type='tricycle'
      and customer_approved_vehicle_type='tricycle'
      and preferred_vehicle_type <> 'tricycle'
      and assigned_driver_id is null
      and status in (
        'producer_accepted','preparing','ready_for_dispatch','dispatching'
      )
  ) then
    raise exception 'AGRIMARKET_STEP7_EFFECTIVE_VEHICLE_ALIGNMENT_FAILED';
  end if;
end;
$$;
