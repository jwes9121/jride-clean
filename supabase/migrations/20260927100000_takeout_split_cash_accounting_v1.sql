-- JRIDE_TAKEOUT_SPLIT_CASH_ACCOUNTING_V1
-- Takeout-only payment split and accounting projection.
-- Items subtotal > PHP500 controls customer-cash-first routing.
-- Customer-first collection is only the vendor purchase amount; JRide delivery
-- charges are collected on final delivery.
-- No wallet deduction formula is changed here.

alter table public.bookings
  add column if not exists takeout_product_purchase_amount numeric,
  add column if not exists takeout_cash_first_amount numeric,
  add column if not exists takeout_pay_on_delivery_amount numeric,
  add column if not exists takeout_driver_commission numeric,
  add column if not exists takeout_company_revenue numeric,
  add column if not exists takeout_driver_delivery_earnings numeric;

create or replace function public.sync_takeout_cash_accounting_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_snapshot jsonb := coalesce(new.takeout_pricing_snapshot, '{}'::jsonb);
  v_items numeric := greatest(coalesce(new.takeout_items_subtotal, 0), 0);
  v_packaging numeric := 0;
  v_delivery numeric := greatest(coalesce(new.takeout_delivery_fee, 0), 0);
  v_service numeric := greatest(coalesce(new.takeout_service_fee, 15), 0);
  v_pickup numeric := 0;
  v_product numeric := 0;
  v_cash_required boolean := false;
  v_cash_first numeric := 0;
  v_pay_on_delivery numeric := 0;
  v_commission numeric := 0;
  v_company numeric := 0;
  v_driver_earnings numeric := 0;
begin
  if lower(trim(coalesce(new.service_type, ''))) <> 'takeout' then
    return new;
  end if;

  -- Until pricing exists, leave the legacy generic fields alone. Once a
  -- delivery fee and total exist, this trigger becomes authoritative.
  if new.takeout_delivery_fee is null or new.takeout_total_payable is null then
    return new;
  end if;

  v_packaging := greatest(coalesce(
    public._jnum(v_snapshot, 'takeout_packaging_subtotal'),
    public._jnum(v_snapshot, 'packaging_subtotal'),
    public._jnum(v_snapshot, 'premium_packaging_fee'),
    0
  ), 0);

  v_pickup := greatest(coalesce(
    new.pickup_distance_fee,
    public._jnum(v_snapshot, 'takeout_pickup_excess_fee'),
    public._jnum(v_snapshot, 'pickup_distance_fee'),
    0
  ), 0);

  v_product := round(v_items + v_packaging, 2);
  v_cash_required := v_items > 500;
  v_cash_first := case when v_cash_required then v_product else 0 end;
  v_pay_on_delivery := greatest(
    round(coalesce(new.takeout_total_payable, 0) - v_cash_first, 2),
    0
  );

  v_commission := case when v_delivery >= 50 then 5 else 0 end;
  v_company := round(v_service + v_commission, 2);
  v_driver_earnings := greatest(round(v_delivery + v_pickup - v_commission, 2), 0);

  new.takeout_cash_collection_required := v_cash_required;
  new.takeout_route_plan := case when v_cash_required then 'customer_cash_first' else 'vendor_first' end;
  new.pickup_distance_fee := v_pickup;

  new.takeout_product_purchase_amount := v_product;
  new.takeout_cash_first_amount := v_cash_first;
  new.takeout_pay_on_delivery_amount := v_pay_on_delivery;
  new.takeout_driver_commission := v_commission;
  new.takeout_company_revenue := v_company;
  new.takeout_driver_delivery_earnings := v_driver_earnings;

  -- Keep legacy/shared analytics fields consistent with the actual Takeout
  -- wallet rule: PHP15 service fee, plus PHP5 driver commission only when
  -- delivery fare is PHP50 or more.
  new.company_cut := v_company;
  new.driver_payout := v_driver_earnings;

  return new;
end;
$function$;

drop trigger if exists zzzz_sync_takeout_cash_accounting_v1 on public.bookings;
create trigger zzzz_sync_takeout_cash_accounting_v1
before insert or update on public.bookings
for each row
execute function public.sync_takeout_cash_accounting_v1();

-- Backfill priced Takeout rows without changing status or wallet history.
update public.bookings
set updated_at = updated_at
where lower(coalesce(service_type, '')) = 'takeout'
  and takeout_delivery_fee is not null
  and takeout_total_payable is not null;
