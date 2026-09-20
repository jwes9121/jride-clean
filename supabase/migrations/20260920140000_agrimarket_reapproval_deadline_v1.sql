-- Five-minute customer consent window. Database time is authoritative.
alter table public.agrimarket_orders add column customer_reapproval_expires_at timestamptz;

create or replace function public.agrimarket_reapproval_deadline_v1()
returns trigger language plpgsql set search_path=public as $$
begin
  if new.status='awaiting_customer_reapproval' and new.customer_reapproval_response is null then
    if tg_op='INSERT' or old.status is distinct from 'awaiting_customer_reapproval' then
      new.customer_reapproval_expires_at := clock_timestamp() + interval '5 minutes';
    else
      new.customer_reapproval_expires_at := coalesce(old.customer_reapproval_expires_at,clock_timestamp()+interval '5 minutes');
    end if;
  elsif tg_op='UPDATE' and old.status='awaiting_customer_reapproval' and new.status='preparing'
        and new.customer_reapproval_response in ('accept','not_required') then
    new.ready_at := clock_timestamp()+make_interval(mins=>coalesce(new.preparation_minutes,0));
  end if;
  return new;
end;
$$;
create index agrimarket_reapproval_deadline_idx on public.agrimarket_orders(customer_reapproval_expires_at)
where status='awaiting_customer_reapproval' and customer_reapproval_response is null;

create or replace function public.agrimarket_expire_customer_reapproval_v1(p_order_id uuid default null)
returns integer language plpgsql set search_path=public as $$
declare o public.agrimarket_orders%rowtype; v_now timestamptz:=clock_timestamp(); v_count integer:=0;
begin
  for o in select * from public.agrimarket_orders
    where status='awaiting_customer_reapproval' and customer_reapproval_response is null
      and customer_reapproval_expires_at<=v_now and (p_order_id is null or id=p_order_id)
    order by customer_reapproval_expires_at,id limit 500 for update skip locked
  loop
    perform public.agrimarket_release_active_reservations_v1(o.id,'expired','customer_reapproval_timeout',v_now);
    update public.agrimarket_orders set status='cancelled',cancelled_at=v_now,
      cancel_reason='customer_reapproval_timeout',updated_at=v_now where id=o.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,reason_code,details,created_at)
    values(o.id,o.status,'cancelled','system','customer_reapproval_timeout',
      jsonb_build_object('deadline',o.customer_reapproval_expires_at),v_now);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.agrimarket_reapproval_deadline_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_expire_customer_reapproval_v1(uuid) from public,anon,authenticated;
grant execute on function public.agrimarket_expire_customer_reapproval_v1(uuid) to service_role;
-- Bind consent to the proposal actually displayed to the customer.
create or replace function public.agrimarket_customer_respond_reapproval_v2(
  p_order_code text,p_customer_user_id uuid,p_response text,
  p_expected_total numeric,p_expected_vehicle text,p_expected_deadline timestamptz)
returns jsonb language plpgsql set search_path=public as $$
declare o public.agrimarket_orders%rowtype;
begin
  select * into o from public.agrimarket_orders
    where order_code=trim(p_order_code) and customer_user_id=p_customer_user_id for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if p_response='accept' and (p_expected_total is distinct from o.customer_reapproval_proposed_total
     or p_expected_vehicle is distinct from o.customer_reapproval_proposed_vehicle_type
     or p_expected_deadline is distinct from o.customer_reapproval_expires_at) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REAPPROVAL_PROPOSAL_STALE');
  end if;
  return public.agrimarket_customer_respond_reapproval_v1(p_order_code,p_customer_user_id,p_response,clock_timestamp());
end;
$$;
revoke all on function public.agrimarket_customer_respond_reapproval_v2(text,uuid,text,numeric,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_customer_respond_reapproval_v2(text,uuid,text,numeric,text,timestamptz) to service_role;
