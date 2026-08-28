create or replace function public.agrimarket_driver_decide_offer_v1(
  p_offer_id uuid,
  p_driver_id uuid,
  p_decision text,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_offer public.agrimarket_driver_offers%rowtype;
  v_order public.agrimarket_orders%rowtype;
  v_driver public.drivers%rowtype;
  v_location public.driver_locations%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_vehicle_raw text;
  v_vehicle text;
  v_min_wallet numeric;
  v_block_reason text;
begin
  if v_decision not in ('accept','decline') then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_INVALID_DRIVER_DECISION');
  end if;

  select * into v_offer
  from public.agrimarket_driver_offers
  where id = p_offer_id and driver_id = p_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_DRIVER_OFFER_NOT_FOUND');
  end if;

  if v_offer.status <> 'offered' then
    return jsonb_build_object(
      'ok', true,
      'already_resolved', true,
      'status', v_offer.status,
      'order_id', v_offer.order_id
    );
  end if;

  if v_offer.expires_at <= p_now then
    update public.agrimarket_driver_offers
    set status = 'expired', responded_at = p_now,
        reason_code = 'offer_timeout', updated_at = p_now
    where id = v_offer.id;
    return jsonb_build_object(
      'ok', false,
      'error', 'AGRIMARKET_DRIVER_OFFER_EXPIRED',
      'order_id', v_offer.order_id
    );
  end if;

  if v_decision = 'decline' then
    update public.agrimarket_driver_offers
    set status = 'declined', responded_at = p_now,
        reason_code = nullif(trim(coalesce(p_reason,'')),''), updated_at = p_now
    where id = v_offer.id;
    return jsonb_build_object('ok', true, 'accepted', false, 'order_id', v_offer.order_id);
  end if;

  select * into v_order
  from public.agrimarket_orders
  where id = v_offer.order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_ORDER_NOT_FOUND');
  end if;
  if v_order.assigned_driver_id is not null then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_ORDER_ALREADY_ASSIGNED');
  end if;
  if v_order.status not in ('dispatching','preparing','ready_for_dispatch') then
    return jsonb_build_object(
      'ok', false,
      'error', 'AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE',
      'status', v_order.status
    );
  end if;

  select * into v_driver
  from public.drivers
  where id = p_driver_id
  for update;

  if not found then
    v_block_reason := 'AGRIMARKET_DRIVER_NOT_FOUND';
  else
    v_min_wallet := greatest(coalesce(v_driver.min_wallet_required, 250), 250);
    if coalesce(v_driver.wallet_locked, false) then
      v_block_reason := 'AGRIMARKET_DRIVER_WALLET_LOCKED';
    elsif coalesce(v_driver.wallet_balance, 0) < v_min_wallet then
      v_block_reason := 'AGRIMARKET_DRIVER_WALLET_BELOW_MINIMUM';
    elsif lower(trim(coalesce(v_driver.roster_status, ''))) not in ('', 'active') then
      v_block_reason := 'AGRIMARKET_DRIVER_ROSTER_INELIGIBLE';
    end if;
  end if;

  if v_block_reason is null then
    select * into v_location
    from public.driver_locations
    where driver_id = p_driver_id
    order by updated_at desc
    limit 1;

    if not found then
      v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_MISSING';
    elsif v_location.updated_at < p_now - interval '5 minutes' then
      v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_STALE';
    elsif lower(trim(coalesce(v_location.status, ''))) not in ('online','available','idle','waiting') then
      v_block_reason := 'AGRIMARKET_DRIVER_NOT_AVAILABLE';
    else
      v_vehicle_raw := lower(trim(coalesce(v_location.vehicle_type,'')));
      if v_vehicle_raw like '%motor%' or v_vehicle_raw like '%moto%' or v_vehicle_raw like '%bike%' then
        v_vehicle := 'motorcycle';
      elsif v_vehicle_raw like '%trike%' or v_vehicle_raw like '%tricycle%' or v_vehicle_raw like '%toda%' then
        v_vehicle := 'tricycle';
      else
        v_vehicle := v_vehicle_raw;
      end if;

      if v_vehicle is distinct from lower(trim(v_order.preferred_vehicle_type)) then
        v_block_reason := 'AGRIMARKET_DRIVER_VEHICLE_CHANGED';
      elsif lower(trim(coalesce(v_order.required_vehicle_type, 'either'))) = 'tricycle'
            and v_vehicle <> 'tricycle' then
        v_block_reason := 'AGRIMARKET_TRICYCLE_REQUIRED';
      end if;
    end if;
  end if;

  if v_block_reason is null and exists (
    select 1
    from public.bookings b
    where b.status in ('assigned','accepted','fare_proposed','ready','on_the_way','arrived','on_trip')
      and (b.driver_id = p_driver_id or b.assigned_driver_id = p_driver_id)
  ) then
    v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY';
  end if;

  if v_block_reason is null and exists (
    select 1
    from public.agrimarket_orders o
    where o.id <> v_order.id
      and o.assigned_driver_id = p_driver_id
      and o.status in ('driver_assigned','picked_up','delivering')
  ) then
    v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY';
  end if;

  if v_block_reason is not null then
    update public.agrimarket_driver_offers
    set status = 'cancelled', responded_at = p_now,
        reason_code = lower(v_block_reason), updated_at = p_now
    where id = v_offer.id;

    return jsonb_build_object(
      'ok', false,
      'error', v_block_reason,
      'order_id', v_offer.order_id,
      'released', true
    );
  end if;

  update public.agrimarket_driver_offers
  set status = 'accepted', responded_at = p_now, updated_at = p_now
  where id = v_offer.id;

  update public.agrimarket_orders
  set assigned_driver_id = p_driver_id,
      selected_vehicle_type = v_vehicle,
      driver_to_first_pickup_km = v_offer.pickup_road_distance_km,
      pickup_distance_fee = v_offer.pickup_distance_fee,
      pickup_fee_locked_at = p_now,
      status = 'driver_assigned',
      updated_at = p_now
  where id = v_order.id;

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'driver_id', p_driver_id,
    'selected_vehicle_type', v_vehicle,
    'pickup_road_distance_km', v_offer.pickup_road_distance_km,
    'pickup_distance_fee', v_offer.pickup_distance_fee,
    'route_plan', v_order.route_plan,
    'cash_collection_required', v_order.cash_collection_required,
    'cash_collection_amount', v_order.cash_collection_amount
  );
end;
$$;
