create or replace function public.agrimarket_producer_decide_order_v3(
  p_order_code text,
  p_producer_id uuid,
  p_decision text,
  p_preparation_minutes integer default null,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns table(
  order_id uuid,
  order_code text,
  status text,
  producer_responded_at timestamptz,
  producer_accepted_at timestamptz,
  producer_rejected_at timestamptz,
  producer_timeout_at timestamptz,
  preparation_minutes integer,
  ready_at timestamptz
)
language plpgsql
set search_path = public
as $function$
declare
  v_order public.agrimarket_orders%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
begin
  if trim(coalesce(p_order_code,'')) = '' or p_producer_id is null then
    raise exception 'AGRIMARKET_PRODUCER_AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if v_decision not in ('accept','reject') then
    raise exception 'AGRIMARKET_INVALID_PRODUCER_DECISION' using errcode = 'P0001';
  end if;
  if v_decision = 'accept' and (p_preparation_minutes is null or p_preparation_minutes < 0 or p_preparation_minutes > 1440) then
    raise exception 'AGRIMARKET_PREPARATION_MINUTES_REQUIRED' using errcode = 'P0001';
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code = trim(p_order_code)
  for update;

  if v_order.id is null then
    raise exception 'AGRIMARKET_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_order.producer_id <> p_producer_id or not exists(
    select 1 from public.agrimarket_producers p where p.id = p_producer_id and p.status = 'active'
  ) then
    raise exception 'AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER' using errcode = 'P0001';
  end if;

  if v_order.status <> 'awaiting_producer' then
    return query
    select o.id,o.order_code,o.status,o.producer_responded_at,o.producer_accepted_at,
           o.producer_rejected_at,o.producer_timeout_at,o.preparation_minutes,o.ready_at
    from public.agrimarket_orders o where o.id=v_order.id;
    return;
  end if;

  if v_order.producer_confirm_expires_at <= p_now then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id,'expired','Producer confirmation timed out after 5 minutes',p_now
    );
    update public.agrimarket_orders
    set status='producer_timeout',producer_responded_at=p_now,producer_timeout_at=p_now,updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','producer_timeout','system',null,'producer_confirmation_timeout','{}'::jsonb,p_now);
  elsif v_decision = 'reject' then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id,'released',coalesce(nullif(trim(p_reason),''),'Producer rejected order'),p_now
    );
    update public.agrimarket_orders
    set status='producer_rejected',producer_responded_at=p_now,producer_rejected_at=p_now,
        cancel_reason=nullif(trim(coalesce(p_reason,'')),''),updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','producer_rejected','producer',p_producer_id,'producer_rejected',
           jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),'')),p_now);
  else
    update public.agrimarket_inventory_reservations
    set expires_at=null
    where order_id=v_order.id and status='active';
    update public.agrimarket_orders
    set status='preparing',producer_responded_at=p_now,producer_accepted_at=p_now,
        preparation_minutes=p_preparation_minutes,
        ready_at=p_now + make_interval(mins => p_preparation_minutes),updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','preparing','producer',p_producer_id,'producer_accepted',
           jsonb_build_object('preparation_minutes',p_preparation_minutes),p_now);
  end if;

  return query
  select o.id,o.order_code,o.status,o.producer_responded_at,o.producer_accepted_at,
         o.producer_rejected_at,o.producer_timeout_at,o.preparation_minutes,o.ready_at
  from public.agrimarket_orders o where o.id=v_order.id;
end;
$function$;

revoke all on function public.agrimarket_producer_decide_order_v3(text,uuid,text,integer,text,timestamptz) from public, anon, authenticated;
grant execute on function public.agrimarket_producer_decide_order_v3(text,uuid,text,integer,text,timestamptz) to service_role;
