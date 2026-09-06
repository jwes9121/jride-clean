-- Apply before the matching API release. No feature flags or legacy data are changed.
alter table public.agrimarket_orders add column pickup_issue jsonb;

create or replace function public.agrimarket_guard_pickup_access_v1()
returns trigger language plpgsql security invoker set search_path = public as $$
declare p public.agrimarket_producers%rowtype;
begin
  if tg_op = 'INSERT' and (new.delivery_lat is null or new.delivery_lng is null) then
    raise exception 'AGRIMARKET_DELIVERY_PIN_REQUIRED';
  end if;
  if tg_op = 'INSERT' or new.status in ('dispatching','driver_assigned') then
    select * into p from public.agrimarket_producers where id=new.producer_id for share;
    if p.status is distinct from 'active' or p.accepting_orders is distinct from true then
      raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE';
    end if;
    if p.pickup_lat is null or p.pickup_lng is null or
       p.pickup_motorcycle_accessible is null or p.pickup_tricycle_accessible is null or
       p.pickup_roadside_handoff_required is null or nullif(trim(p.pickup_driver_directions),'') is null then
      raise exception 'AGRIMARKET_PICKUP_ACCESS_UNVERIFIED';
    end if;
    if (new.preferred_vehicle_type='tricycle' and not p.pickup_tricycle_accessible) or
       (new.preferred_vehicle_type='motorcycle' and not p.pickup_motorcycle_accessible) then
      raise exception 'AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.pickup_issue->>'status'='open' and
     new.status in ('picked_up','delivering','delivered','completed') then
    raise exception 'AGRIMARKET_PICKUP_ISSUE_OPEN';
  end if;
  return new;
end;
$$;
create trigger agrimarket_guard_pickup_access_trg
before insert or update of assigned_driver_id,status on public.agrimarket_orders
for each row execute function public.agrimarket_guard_pickup_access_v1();

-- Serialize check writes with driver actions. Even the legacy RPC cannot overwrite
-- a mismatch with PASS or consume inventory while an issue is open.
create or replace function public.agrimarket_guard_pickup_check_v1()
returns trigger language plpgsql security invoker set search_path = public as $$
declare o public.agrimarket_orders%rowtype;
begin
  select * into o from public.agrimarket_orders where id=new.order_id for update;
  if o.assigned_driver_id is distinct from new.driver_id or o.status <> 'driver_assigned' then
    raise exception 'AGRIMARKET_PICKUP_CHECK_NOT_ASSIGNED';
  end if;
  if o.pickup_issue->>'status'='open' and new.result='pass' then
    raise exception 'AGRIMARKET_PICKUP_ISSUE_OPEN';
  end if;
  if new.result='mismatch' and (o.pickup_issue->>'status') is distinct from 'open' then
    update public.agrimarket_orders set pickup_issue=jsonb_build_object(
      'status','open','reason',coalesce(nullif(trim(new.notes),''),'Pickup check mismatch'),
      'reported_by',new.driver_id,'reported_at',new.checked_at), updated_at=new.checked_at where id=o.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details)
    values(o.id,o.status,o.status,'driver',new.driver_id,'pickup_mismatch_reported',
      jsonb_build_object('order_item_id',new.order_item_id,'check_type',new.check_type,'notes',new.notes));
  end if;
  return new;
end;
$$;
create trigger agrimarket_guard_pickup_check_trg
before insert or update on public.agrimarket_pickup_checks
for each row execute function public.agrimarket_guard_pickup_check_v1();

create or replace function public.agrimarket_driver_execute_v2(
  p_order_code text,p_driver_id uuid,p_action text,p_payload jsonb default '{}'::jsonb,
  p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare o public.agrimarket_orders%rowtype; a text:=lower(trim(p_action)); n text; amount numeric; expected numeric; issue jsonb;
begin
  select * into o from public.agrimarket_orders where order_code=trim(p_order_code) for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if o.assigned_driver_id is distinct from p_driver_id or p_driver_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_ASSIGNED_TO_DRIVER');
  end if;
  if a='set_handling_fee' then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_FARMER_CONFIRMED_HANDLING_ONLY');
  end if;
  if a='report_load_mismatch' then
    if o.status <> 'driver_assigned' then return jsonb_build_object('ok',false,'error','AGRIMARKET_PICKUP_ISSUE_WRONG_STATUS'); end if;
    if o.pickup_issue->>'status'='open' then return jsonb_build_object('ok',true,'already_done',true,'next','resolve_mismatch'); end if;
    n:=nullif(trim(p_payload->>'reason'),'');
    if n is null or length(n)>1000 then return jsonb_build_object('ok',false,'error','AGRIMARKET_ISSUE_REASON_REQUIRED'); end if;
    issue:=jsonb_build_object('status','open','reason',n,'reported_by',p_driver_id,'reported_at',p_now);
    update public.agrimarket_orders set pickup_issue=issue,updated_at=p_now where id=o.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(o.id,o.status,o.status,'driver',p_driver_id,'load_mismatch_reported',issue,p_now);
    return jsonb_build_object('ok',true,'next','resolve_mismatch');
  end if;
  if a in ('confirm_farmer_refund','confirm_customer_refund') then
    if o.status <> 'driver_assigned' or (o.pickup_issue->>'status') is distinct from 'open' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_OPEN_PICKUP_ISSUE_REQUIRED');
    end if;
    expected:=case when a='confirm_farmer_refund' then coalesce(o.producer_paid_amount,0) else coalesce(o.customer_cash_collected_amount,0) end;
    begin amount:=(p_payload->>'amount')::numeric; exception when others then amount:=null; end;
    if expected<=0 or amount is distinct from expected then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_REFUND_AMOUNT_MISMATCH','expected_amount',expected);
    end if;
    if a='confirm_customer_refund' and coalesce(o.producer_paid_amount,0)>0 and not coalesce(o.pickup_issue ? 'confirm_farmer_refund',false) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_FARMER_REFUND_REQUIRED');
    end if;
    if o.pickup_issue ? a then return jsonb_build_object('ok',true,'already_done',true); end if;
    issue:=o.pickup_issue || jsonb_build_object(a,jsonb_build_object('amount',amount,'confirmed_by',p_driver_id,'confirmed_at',p_now));
    update public.agrimarket_orders set pickup_issue=issue,updated_at=p_now where id=o.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(o.id,o.status,o.status,'driver',p_driver_id,a,jsonb_build_object('amount',amount),p_now);
    return jsonb_build_object('ok',true,'next','resolve_mismatch');
  end if;
  if o.pickup_issue->>'status'='open' then return jsonb_build_object('ok',false,'error','AGRIMARKET_PICKUP_ISSUE_OPEN','next','resolve_mismatch'); end if;
  return public.agrimarket_driver_execute_v1(p_order_code,p_driver_id,a,p_payload,p_now);
end;
$$;

create or replace function public.agrimarket_admin_resolve_pickup_issue_v1(
  p_order_code text,p_resolution text,p_actor text,p_note text,p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare o public.agrimarket_orders%rowtype; issue jsonb; checks jsonb;
begin
  if nullif(trim(p_actor),'') is null or nullif(trim(p_note),'') is null or length(p_note)>1000 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_RESOLUTION_NOTE_REQUIRED');
  end if;
  select * into o from public.agrimarket_orders where order_code=trim(p_order_code) for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if (o.pickup_issue->>'status') is distinct from 'open' then
    if o.pickup_issue->>'resolution'=p_resolution then return jsonb_build_object('ok',true,'already_done',true); end if;
    return jsonb_build_object('ok',false,'error','AGRIMARKET_OPEN_PICKUP_ISSUE_REQUIRED');
  end if;
  if o.status <> 'driver_assigned' then return jsonb_build_object('ok',false,'error','AGRIMARKET_PICKUP_ISSUE_WRONG_STATUS'); end if;
  if p_resolution not in ('restored_to_booking','cancel') or p_resolution is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_RESOLUTION_INVALID');
  end if;
  if p_resolution='restored_to_booking' and
     (o.pickup_issue ? 'confirm_farmer_refund' or o.pickup_issue ? 'confirm_customer_refund') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REFUNDED_ORDER_MUST_CANCEL');
  end if;
  if p_resolution='cancel' and (
     (coalesce(o.producer_paid_amount,0)>0 and not (o.pickup_issue ? 'confirm_farmer_refund')) or
     (coalesce(o.customer_cash_collected_amount,0)>0 and not (o.pickup_issue ? 'confirm_customer_refund'))) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CASH_RETURNS_REQUIRED');
  end if;
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into checks from public.agrimarket_pickup_checks c where c.order_id=o.id;
  issue:=o.pickup_issue || jsonb_build_object('status',case when p_resolution='cancel' then 'cancelled' else 'resolved' end,
    'resolution',p_resolution,'resolved_by',p_actor,'resolution_note',p_note,'resolved_at',p_now);
  update public.agrimarket_orders set pickup_issue=issue,updated_at=p_now where id=o.id;
  if p_resolution='cancel' then
    perform public.agrimarket_release_active_reservations_v1(o.id,'released','pickup_mismatch_cancelled',p_now);
    update public.agrimarket_orders set status='cancelled',cancelled_at=p_now,cancel_reason='pickup_mismatch_cancelled',updated_at=p_now where id=o.id;
  else
    -- The original agreed load/price/vehicle must be restored, then physically rechecked.
    -- Material changes require cancellation and a new customer-approved booking.
    delete from public.agrimarket_pickup_checks where order_id=o.id;
  end if;
  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,reason_code,details,created_at)
  values(o.id,o.status,case when p_resolution='cancel' then 'cancelled' else o.status end,'admin',
    'pickup_issue_resolved',jsonb_build_object('issue',issue,'previous_checks',checks),p_now);
  return jsonb_build_object('ok',true,'resolution',p_resolution,'next',case when p_resolution='cancel' then 'cancelled' else 'verify_pickup' end);
end;
$$;

revoke all on function public.agrimarket_guard_pickup_access_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_guard_pickup_check_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_driver_execute_v2(text,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_admin_resolve_pickup_issue_v1(text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_driver_execute_v2(text,uuid,text,jsonb,timestamptz) to service_role;
grant execute on function public.agrimarket_admin_resolve_pickup_issue_v1(text,text,text,text,timestamptz) to service_role;
