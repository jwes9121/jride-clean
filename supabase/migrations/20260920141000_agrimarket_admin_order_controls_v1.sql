-- Administrative actions serialize with driver acceptance and cash/pickup actions.
create or replace function public.agrimarket_admin_order_action_v1(
  p_order_code text,p_action text,p_actor text,p_note text,
  p_expected_status text,p_expected_driver_id uuid,p_expected_offer_id uuid)
returns jsonb language plpgsql set search_path=public as $$
declare o public.agrimarket_orders%rowtype; v_offer uuid; v_now timestamptz:=clock_timestamp(); v_next text; v_checks jsonb;
begin
  if p_action is null or p_action not in ('cancel','reassign') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ADMIN_ACTION_INVALID');
  end if;
  if length(trim(coalesce(p_actor,'')))<2 or length(trim(coalesce(p_note,'')))<5 or length(p_note)>1000 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ADMIN_REASON_REQUIRED');
  end if;
  select * into o from public.agrimarket_orders where order_code=trim(p_order_code) for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  select id into v_offer from public.agrimarket_driver_offers
    where order_id=o.id and status='offered' order by offered_at desc limit 1 for update;
  if o.status is distinct from p_expected_status or o.assigned_driver_id is distinct from p_expected_driver_id
     or v_offer is distinct from p_expected_offer_id then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_CHANGED','message','Order changed. Refresh and review it before trying again.');
  end if;
  if o.status not in ('awaiting_producer','awaiting_harvest','producer_accepted','preparing','awaiting_customer_reapproval','ready_for_dispatch','dispatching','driver_assigned') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ADMIN_ACTION_WRONG_STATUS');
  end if;
  if o.picked_up_at is not null or o.delivering_at is not null or o.delivered_at is not null
     or o.customer_cash_collected_at is not null or coalesce(o.customer_cash_collected_amount,0)>0
     or o.producer_paid_at is not null or coalesce(o.producer_paid_amount,0)>0
     or o.final_cash_collected_at is not null or coalesce(o.final_cash_collected_amount,0)>0
     or o.pickup_issue->>'status'='open' then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_RECOVERY_REQUIRED',
      'message','Cash, goods or a pickup issue require recovery before this order can be changed.');
  end if;
  if p_action='reassign' and (o.status not in ('dispatching','driver_assigned','preparing','ready_for_dispatch')
     or (o.assigned_driver_id is null and v_offer is null)) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ACTIVE_ASSIGNMENT_REQUIRED');
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into v_checks from public.agrimarket_pickup_checks c where order_id=o.id;
  update public.agrimarket_driver_offers set status='cancelled',responded_at=v_now,
    reason_code='admin_'||p_action,updated_at=v_now where order_id=o.id and status in ('offered','accepted');
  if p_action='cancel' then
    perform public.agrimarket_release_active_reservations_v1(o.id,'released','admin_cancelled',v_now);
    v_next:='cancelled';
    update public.agrimarket_orders set status=v_next,cancelled_at=v_now,cancel_reason='admin_cancelled',updated_at=v_now where id=o.id;
  else
    v_next:=case when o.ready_at>v_now then 'preparing' else 'ready_for_dispatch' end;
    delete from public.agrimarket_pickup_checks where order_id=o.id;
    update public.agrimarket_orders set status=v_next,assigned_driver_id=null,selected_vehicle_type=null,
      driver_to_first_pickup_km=null,pickup_distance_fee=0,pickup_fee_locked_at=null,dispatch_started_at=null,
      pricing_snapshot=coalesce(pricing_snapshot,'{}'::jsonb)-array['driver_approach_distance_km','driver_approach_charge','pickup_distance_fee'],
      updated_at=v_now where id=o.id;
  end if;
  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,reason_code,details,created_at)
  values(o.id,o.status,v_next,'admin','admin_'||p_action,jsonb_build_object('actor',p_actor,'note',trim(p_note),
    'previous_driver_id',o.assigned_driver_id,'previous_offer_id',v_offer,'previous_pickup_fee',o.pickup_distance_fee,'previous_pickup_checks',v_checks),v_now);
  return jsonb_build_object('ok',true,'order_id',o.id,'order_code',o.order_code,'status',v_next,'action',p_action);
end;
$$;
revoke all on function public.agrimarket_admin_order_action_v1(text,text,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.agrimarket_admin_order_action_v1(text,text,text,text,text,uuid,uuid) to service_role;

-- A dispatcher that started routing before cancellation must not publish a stale offer.
create or replace function public.agrimarket_guard_offer_order_v1()
returns trigger language plpgsql set search_path=public as $$
declare o public.agrimarket_orders%rowtype;
begin
  if new.status='offered' then
    select * into o from public.agrimarket_orders where id=new.order_id for update;
    if not found or o.assigned_driver_id is not null or o.status not in ('preparing','ready_for_dispatch','dispatching') then
      raise exception 'AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE' using errcode='P0001';
    end if;
  end if;
  return new;
end;
$$;
create trigger agrimarket_guard_offer_order_trg before insert or update of status on public.agrimarket_driver_offers
for each row execute function public.agrimarket_guard_offer_order_v1();
revoke all on function public.agrimarket_guard_offer_order_v1() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.agrimarket_driver_decide_offer_v1(p_offer_id uuid, p_driver_id uuid, p_decision text, p_reason text DEFAULT NULL::text, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_offer public.agrimarket_driver_offers%rowtype;
  v_order public.agrimarket_orders%rowtype;
  v_driver public.drivers%rowtype;
  v_location public.driver_locations%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_vehicle text;
  v_min_wallet numeric;
  v_block_reason text;
begin
  if v_decision not in ('accept','decline') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_DRIVER_DECISION');
  end if;

  -- Match Admin actions: acquire the order lock before the offer lock.
  perform 1 from public.agrimarket_orders
  where id=(select order_id from public.agrimarket_driver_offers where id=p_offer_id and driver_id=p_driver_id)
  for update;

  select * into v_offer
  from public.agrimarket_driver_offers
  where id=p_offer_id and driver_id=p_driver_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_DRIVER_OFFER_NOT_FOUND'); end if;
  if v_offer.status<>'offered' then
    return jsonb_build_object('ok',true,'already_resolved',true,'status',v_offer.status,'order_id',v_offer.order_id);
  end if;

  if v_offer.expires_at<=p_now then
    update public.agrimarket_driver_offers
    set status='expired',responded_at=p_now,reason_code='offer_timeout',updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',false,'error','AGRIMARKET_DRIVER_OFFER_EXPIRED','order_id',v_offer.order_id);
  end if;

  if v_decision='decline' then
    update public.agrimarket_driver_offers
    set status='declined',responded_at=p_now,
        reason_code=nullif(trim(coalesce(p_reason,'')),''),updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',true,'accepted',false,'order_id',v_offer.order_id);
  end if;

  select * into v_order from public.agrimarket_orders where id=v_offer.order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.assigned_driver_id is not null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_ALREADY_ASSIGNED'); end if;
  if v_order.status not in ('dispatching','preparing','ready_for_dispatch') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE','status',v_order.status);
  end if;

  select * into v_driver from public.drivers where id=p_driver_id for update;
  if not found then v_block_reason := 'AGRIMARKET_DRIVER_NOT_FOUND';
  else
    v_min_wallet := greatest(coalesce(v_driver.min_wallet_required,250),250);
    if coalesce(v_driver.wallet_locked,false) then v_block_reason := 'AGRIMARKET_DRIVER_WALLET_LOCKED';
    elsif coalesce(v_driver.wallet_balance,0)<v_min_wallet then v_block_reason := 'AGRIMARKET_DRIVER_WALLET_BELOW_MINIMUM';
    elsif lower(trim(coalesce(v_driver.roster_status,''))) not in ('','active') then v_block_reason := 'AGRIMARKET_DRIVER_ROSTER_INELIGIBLE';
    end if;
  end if;

  if v_block_reason is null then
    select * into v_location
    from public.driver_locations
    where driver_id=p_driver_id
    order by updated_at desc
    limit 1;

    if not found then v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_MISSING';
    elsif v_location.updated_at < p_now-interval '5 minutes' then v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_STALE';
    elsif lower(trim(coalesce(v_location.status,''))) not in ('online','available','idle','waiting') then
      v_block_reason := 'AGRIMARKET_DRIVER_NOT_AVAILABLE';
    else
      v_vehicle := public.jride_normalize_vehicle_type_v1(v_location.vehicle_type);
      if v_vehicle is distinct from public.jride_normalize_vehicle_type_v1(v_order.preferred_vehicle_type) then
        v_block_reason := 'AGRIMARKET_DRIVER_VEHICLE_CHANGED';
      elsif public.jride_vehicle_rank_v1(v_vehicle) < public.jride_vehicle_rank_v1(v_order.required_vehicle_type) then
        v_block_reason := 'AGRIMARKET_REQUIRED_VEHICLE_MISMATCH';
      end if;
    end if;
  end if;

  if v_block_reason is null and exists(
    select 1 from public.bookings b
    where b.status in ('assigned','accepted','fare_proposed','ready','on_the_way','arrived','on_trip')
      and (b.driver_id=p_driver_id or b.assigned_driver_id=p_driver_id)
  ) then v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY'; end if;

  if v_block_reason is null and exists(
    select 1 from public.agrimarket_orders o
    where o.id<>v_order.id and o.assigned_driver_id=p_driver_id
      and o.status in ('driver_assigned','picked_up','delivering')
  ) then v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY'; end if;

  if v_block_reason is not null then
    update public.agrimarket_driver_offers
    set status='cancelled',responded_at=p_now,reason_code=lower(v_block_reason),updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',false,'error',v_block_reason,'order_id',v_offer.order_id,'released',true);
  end if;

  update public.agrimarket_driver_offers
  set status='accepted',responded_at=p_now,updated_at=p_now
  where id=v_offer.id;

  update public.agrimarket_orders
  set assigned_driver_id=p_driver_id,
      selected_vehicle_type=v_vehicle,
      driver_to_first_pickup_km=v_offer.pickup_road_distance_km,
      pickup_distance_fee=v_offer.pickup_distance_fee,
      pickup_fee_locked_at=p_now,
      status='driver_assigned',
      updated_at=p_now
  where id=v_order.id;

  return jsonb_build_object(
    'ok',true,'accepted',true,'order_id',v_order.id,'order_code',v_order.order_code,
    'driver_id',p_driver_id,'selected_vehicle_type',v_vehicle,
    'pickup_road_distance_km',v_offer.pickup_road_distance_km,
    'pickup_distance_fee',v_offer.pickup_distance_fee,
    'route_plan',v_order.route_plan,
    'cash_collection_required',v_order.cash_collection_required,
    'cash_collection_amount',v_order.cash_collection_amount
  );
end;
$function$;
