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

  -- Some historical rows have a generic 0 while the pricing snapshot contains
  -- the authoritative positive amount. Use the largest non-negative source
  -- instead of COALESCE so a default zero cannot mask the real charge.
  v_packaging := greatest(
    greatest(coalesce(public._jnum(v_snapshot, 'takeout_packaging_subtotal'), 0), 0),
    greatest(coalesce(public._jnum(v_snapshot, 'packaging_subtotal'), 0), 0),
    greatest(coalesce(public._jnum(v_snapshot, 'premium_packaging_fee'), 0), 0)
  );

  v_pickup := greatest(
    greatest(coalesce(new.pickup_distance_fee, 0), 0),
    greatest(coalesce(public._jnum(v_snapshot, 'takeout_pickup_excess_fee'), 0), 0),
    greatest(coalesce(public._jnum(v_snapshot, 'pickup_distance_fee'), 0), 0)
  );

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

  new.takeout_pricing_snapshot := v_snapshot || jsonb_build_object(
    'takeout_product_purchase_amount', v_product,
    'takeout_cash_first_amount', v_cash_first,
    'cash_collection_amount', v_cash_first,
    'takeout_pay_on_delivery_amount', v_pay_on_delivery,
    'pay_on_delivery_amount', v_pay_on_delivery,
    'takeout_driver_commission', v_commission,
    'takeout_company_revenue', v_company,
    'takeout_driver_delivery_earnings', v_driver_earnings,
    'pickup_distance_fee', v_pickup
  );

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


-- Keep Takeout wallet settlement metadata aligned with the already-existing
-- wallet deduction transaction. This does not create or change a deduction.
create or replace function public.finalize_takeout_wallet_metadata_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_tx public.driver_wallet_transactions%rowtype;
  v_settlement_id uuid;
begin
  if tg_op <> 'UPDATE'
     or coalesce(old.status, '') = 'completed'
     or coalesce(new.status, '') <> 'completed'
     or lower(coalesce(new.service_type, '')) <> 'takeout' then
    return new;
  end if;

  select *
  into v_tx
  from public.driver_wallet_transactions
  where booking_id = new.id
    and amount < 0
    and reason in ('takeout_cut_15', 'takeout_cut_20')
  order by created_at desc
  limit 1;

  if not found then
    return new;
  end if;

  v_settlement_id := coalesce(v_tx.wallet_settlement_id, gen_random_uuid());

  if v_tx.wallet_settlement_id is null then
    update public.driver_wallet_transactions
    set wallet_settlement_id = v_settlement_id
    where id = v_tx.id
      and wallet_settlement_id is null;
  end if;

  update public.bookings
  set wallet_settled_at = coalesce(wallet_settled_at, v_tx.created_at, now()),
      wallet_settlement_id = coalesce(wallet_settlement_id, v_settlement_id),
      wallet_settlement_status = 'settled',
      wallet_settlement_version = greatest(coalesce(wallet_settlement_version, 0), 4),
      wallet_settlement_hash = coalesce(
        wallet_settlement_hash,
        md5(
          new.id::text || ':' ||
          coalesce(new.assigned_driver_id, new.driver_id)::text || ':' ||
          coalesce(new.company_cut, 0)::text || ':takeout_split_v1'
        )
      ),
      updated_at = now()
  where id = new.id;

  return new;
end;
$function$;

drop trigger if exists zzzz_finalize_takeout_wallet_metadata_v1 on public.bookings;
create trigger zzzz_finalize_takeout_wallet_metadata_v1
after update of status on public.bookings
for each row
execute function public.finalize_takeout_wallet_metadata_v1();

-- Backfill settlement metadata for historical completed Takeout rows that
-- already have a single successful Takeout deduction. No balances are changed.
with tx as (
  select distinct on (booking_id)
    id,
    booking_id,
    created_at,
    wallet_settlement_id,
    coalesce(wallet_settlement_id, gen_random_uuid()) as effective_settlement_id
  from public.driver_wallet_transactions
  where amount < 0
    and reason in ('takeout_cut_15', 'takeout_cut_20')
    and booking_id is not null
  order by booking_id, created_at desc
),
tx_ids as (
  update public.driver_wallet_transactions t
  set wallet_settlement_id = tx.effective_settlement_id
  from tx
  where t.id = tx.id
    and t.wallet_settlement_id is null
  returning t.id
)
update public.bookings b
set wallet_settled_at = coalesce(b.wallet_settled_at, tx.created_at),
    wallet_settlement_id = coalesce(b.wallet_settlement_id, tx.effective_settlement_id),
    wallet_settlement_status = 'settled',
    wallet_settlement_version = greatest(coalesce(b.wallet_settlement_version, 0), 4),
    wallet_settlement_hash = coalesce(
      b.wallet_settlement_hash,
      md5(
        b.id::text || ':' ||
        coalesce(b.assigned_driver_id, b.driver_id)::text || ':' ||
        coalesce(b.company_cut, 0)::text || ':takeout_split_v1'
      )
    )
from tx
where b.id = tx.booking_id
  and lower(coalesce(b.service_type, '')) = 'takeout'
  and lower(coalesce(b.status, '')) = 'completed';
