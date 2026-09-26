-- JRIDE_TAKEOUT_SHORT_TRIP_AUTOMATIC_FARE_V1
-- Applies automatic Takeout delivery pricing only after a driver accepts an
-- assigned Takeout order. Cash-first routing remains independent:
-- PHP 500 and below -> vendor_first; above PHP 500 -> customer_cash_first.
-- The function is service-role only and updates booking pricing + inventory
-- atomically so automatic confirmation cannot skip or double-decrement stock.

create or replace function public.confirm_takeout_automatic_short_trip_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_expected_driver_accept_expires_at timestamptz,
  p_expected_subtotal numeric,
  p_delivery_fee numeric,
  p_service_fee numeric,
  p_total_payable numeric,
  p_cash_required boolean,
  p_route_plan text,
  p_pricing_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_row public.bookings%rowtype;
  updated_row public.bookings%rowtype;
  effective_now timestamptz := now();
  expected_cash_required boolean;
  expected_route_plan text;
begin
  if p_booking_id is null or p_driver_id is null then
    return jsonb_build_object('ok', false, 'error', 'TAKEOUT_AUTOMATIC_FARE_BAD_INPUT');
  end if;

  if p_expected_subtotal is null or p_expected_subtotal <= 0
     or p_delivery_fee is null or p_delivery_fee <= 0
     or p_service_fee is null or p_service_fee < 0
     or p_total_payable is null or p_total_payable <= 0 then
    return jsonb_build_object('ok', false, 'error', 'TAKEOUT_AUTOMATIC_FARE_BAD_AMOUNT');
  end if;

  select *
  into booking_row
  from public.bookings
  where id = p_booking_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TAKEOUT_ORDER_NOT_FOUND');
  end if;

  if coalesce(booking_row.service_type, '') <> 'takeout' then
    return jsonb_build_object('ok', false, 'error', 'TAKEOUT_SERVICE_MISMATCH');
  end if;

  expected_cash_required :=
    coalesce(booking_row.takeout_items_subtotal, 0) > 500;
  expected_route_plan :=
    case when expected_cash_required then 'customer_cash_first' else 'vendor_first' end;

  if booking_row.assigned_driver_id is distinct from p_driver_id
     or booking_row.driver_id is distinct from p_driver_id
     or coalesce(booking_row.status, '') not in ('assigned', 'accepted')
     or coalesce(booking_row.driver_status, '') <> 'driver_assigned'
     or booking_row.driver_accept_expires_at is distinct from p_expected_driver_accept_expires_at
     or booking_row.driver_accept_expires_at is null
     or booking_row.driver_accept_expires_at <= effective_now
     or booking_row.takeout_fee_proposed_at is not null
     or booking_row.takeout_delivery_fee is not null
     or booking_row.takeout_customer_confirmed_at is not null
     or coalesce(booking_row.takeout_pricing_status, '') not in ('', 'waiting_driver_accept', 'pricing_pending')
     or booking_row.takeout_items_subtotal is distinct from p_expected_subtotal
     or p_cash_required is distinct from expected_cash_required
     or p_route_plan is distinct from expected_route_plan then
    return jsonb_build_object(
      'ok', false,
      'error', 'TAKEOUT_STEP_CHANGED',
      'expected_route_plan', expected_route_plan,
      'expected_cash_required', expected_cash_required
    );
  end if;

  update public.bookings
  set
    vendor_status = 'driver_accepted',
    customer_status = 'driver_accepted',
    driver_status = 'driver_accepted',
    takeout_pricing_status = 'customer_confirmed',
    takeout_delivery_fee = p_delivery_fee,
    takeout_service_fee = p_service_fee,
    takeout_total_payable = p_total_payable,
    takeout_cash_collection_required = expected_cash_required,
    takeout_route_plan = expected_route_plan,
    takeout_pricing_snapshot = coalesce(p_pricing_snapshot, '{}'::jsonb),
    takeout_customer_confirmed_at = effective_now,
    driver_accept_expires_at = null,
    takeout_driver_accept_expires_at = null,
    takeout_fee_expires_at = null,
    takeout_fee_proposal_expires_at = null,
    driver_fee_proposal_expires_at = null,
    updated_at = effective_now
  where id = booking_row.id
  returning * into updated_row;

  with quantities as (
    select
      menu_item_id,
      sum(greatest(quantity, 0))::integer as quantity
    from public.takeout_order_items
    where booking_id = booking_row.id
      and menu_item_id is not null
    group by menu_item_id
  )
  update public.vendor_menu_items as menu
  set
    remaining_quantity = greatest(0, menu.remaining_quantity - quantities.quantity),
    sold_out_today = greatest(0, menu.remaining_quantity - quantities.quantity) <= 0,
    updated_at = effective_now
  from quantities
  where menu.id = quantities.menu_item_id;

  perform public.record_booking_lifecycle_event(
    booking_row.id,
    booking_row.booking_code,
    booking_row.created_by_user_id,
    p_driver_id,
    null,
    'fare_accepted',
    booking_row.status,
    booking_row.status,
    booking_row.town,
    'takeout_short_trip_automatic_v1',
    'driver',
    p_driver_id,
    coalesce(p_pricing_snapshot, '{}'::jsonb) ||
      jsonb_build_object(
        'automatic_takeout_delivery_fare', true,
        'accepted_without_proposed_fare', true,
        'route_plan', expected_route_plan,
        'cash_required', expected_cash_required
      )
  );

  return jsonb_build_object(
    'ok', true,
    'order', to_jsonb(updated_row),
    'pricing_version', 'takeout_short_trip_automatic_v1'
  );
end;
$$;

revoke all
on function public.confirm_takeout_automatic_short_trip_v1(
  uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, boolean, text, jsonb
)
from public, anon, authenticated;

grant execute
on function public.confirm_takeout_automatic_short_trip_v1(
  uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, boolean, text, jsonb
)
to service_role;

comment on function public.confirm_takeout_automatic_short_trip_v1(
  uuid, uuid, timestamptz, numeric, numeric, numeric, numeric, boolean, text, jsonb
) is
  'Atomically confirms a <=3km automatic Takeout delivery fare after driver acceptance, enforces >PHP500 cash-first routing, and decrements vendor inventory once.';
