-- A customer can approve a tricycle while an unassigned order waits for a
-- driver. The checkout choice remains recorded; no vehicle is changed without
-- passenger action and no offered driver is displaced.
create function public.agrimarket_customer_switch_to_tricycle_v1(
  p_order_code text,p_customer_user_id uuid,p_expected_vehicle text,p_expected_total numeric
) returns jsonb language plpgsql set search_path='public' as $fn$
declare
  o public.agrimarket_orders%rowtype;
  p public.agrimarket_producers%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if trim(coalesce(p_order_code,''))='' or p_customer_user_id is null
     or p_expected_vehicle is distinct from 'motorcycle' or p_expected_total is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_VEHICLE_SWITCH_REVISION_REQUIRED');
  end if;

  select * into o from public.agrimarket_orders
  where order_code=trim(p_order_code) and customer_user_id=p_customer_user_id for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;

  if o.customer_approved_vehicle_type='tricycle' and o.preferred_vehicle_type='tricycle'
     and round(o.customer_approved_total,2)=round(p_expected_total,2) then
    return jsonb_build_object('ok',true,'already_done',true,'status',o.status,'vehicle','tricycle');
  end if;

  if o.status not in ('preparing','ready_for_dispatch') or o.assigned_driver_id is not null
     or o.dispatch_started_at is not null or o.selected_vehicle_type is not null
     or o.pickup_fee_locked_at is not null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_VEHICLE_SWITCH_WRONG_STATUS');
  end if;
  if o.customer_approved_vehicle_type is distinct from p_expected_vehicle
     or o.preferred_vehicle_type is distinct from p_expected_vehicle
     or o.required_vehicle_type not in ('either','motorcycle','tricycle')
     or round(o.total_payable,2) is distinct from round(o.customer_approved_total,2)
     or round(o.customer_approved_total,2) is distinct from round(p_expected_total,2)
     or exists (select 1 from public.agrimarket_harvest_proposals h
       where h.order_id=o.id and h.status='pending_customer') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_VEHICLE_SWITCH_STALE');
  end if;
  if exists (select 1 from public.agrimarket_driver_offers f
    where f.order_id=o.id and f.status='offered' and f.expires_at>v_now) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_VEHICLE_SWITCH_ACTIVE_OFFER');
  end if;

  select * into p from public.agrimarket_producers where id=o.producer_id;
  if not found or p.status<>'active' or p.accepting_orders is distinct from true
     or p.pickup_tricycle_accessible is distinct from true
     or p.pickup_lat is null or p.pickup_lng is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE');
  end if;

  update public.agrimarket_orders
  set customer_approved_vehicle_type='tricycle',updated_at=v_now
  where id=o.id;

  insert into public.agrimarket_order_events
    (order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
  values (o.id,o.status,o.status,'customer',p_customer_user_id,'customer_vehicle_switch',
    jsonb_build_object('from_vehicle','motorcycle','to_vehicle','tricycle',
      'approved_total',o.customer_approved_total,'checkout_vehicle',o.checkout_preferred_vehicle_type),v_now);

  return jsonb_build_object('ok',true,'status',o.status,'vehicle','tricycle',
    'approved_total',o.customer_approved_total);
end;
$fn$;

revoke all on function public.agrimarket_customer_switch_to_tricycle_v1(text,uuid,text,numeric)
  from public,anon,authenticated;
grant execute on function public.agrimarket_customer_switch_to_tricycle_v1(text,uuid,text,numeric)
  to service_role;
