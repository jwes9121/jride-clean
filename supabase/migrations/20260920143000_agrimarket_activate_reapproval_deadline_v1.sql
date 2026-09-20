-- Activate after the customer, farmer and Admin countdown UI is deployed.
create trigger agrimarket_reapproval_deadline_trg
before insert or update of status,customer_reapproval_expires_at on public.agrimarket_orders
for each row execute function public.agrimarket_reapproval_deadline_v1();

-- Existing pending orders receive one full window when this policy is enabled.
update public.agrimarket_orders set customer_reapproval_expires_at=clock_timestamp()+interval '5 minutes'
where status='awaiting_customer_reapproval' and customer_reapproval_response is null;

CREATE OR REPLACE FUNCTION public.agrimarket_customer_respond_reapproval_v1(p_order_code text, p_customer_user_id uuid, p_response text, p_now timestamp with time zone DEFAULT clock_timestamp())
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_order public.agrimarket_orders%rowtype;
  v_response text := lower(trim(coalesce(p_response,'')));
  v_resume_status text;
  v_current_total numeric(12,2);
  v_revised_vehicle text;
begin
  if v_response not in ('accept','reject') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_REAPPROVAL_RESPONSE');
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(coalesce(p_order_code,''))
    and o.customer_user_id=p_customer_user_id
  for update;

  if v_order.id is null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.status<>'awaiting_customer_reapproval' or v_order.customer_reapproval_response is not null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REAPPROVAL_WRONG_STATUS','status',v_order.status);
  end if;

  p_now := clock_timestamp();
  if v_order.customer_reapproval_expires_at is null or v_order.customer_reapproval_expires_at<=p_now then
    perform public.agrimarket_expire_customer_reapproval_v1(v_order.id);
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REAPPROVAL_EXPIRED');
  end if;

  v_current_total := round(coalesce(v_order.total_payable,0),2);
  v_revised_vehicle := case
    when public.jride_vehicle_rank_v1(v_order.customer_approved_vehicle_type)
         < public.jride_vehicle_rank_v1(v_order.required_vehicle_type)
      then v_order.required_vehicle_type
    else v_order.customer_approved_vehicle_type
  end;

  if v_order.customer_reapproval_proposed_total is distinct from v_current_total
     or v_order.customer_reapproval_proposed_vehicle_type is distinct from v_revised_vehicle then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REAPPROVAL_PROPOSAL_STALE');
  end if;

  if v_response='reject' then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id,'released','Customer rejected revised Agrimarket charges',p_now
    );
    update public.agrimarket_orders
    set status='cancelled',cancelled_at=p_now,cancel_reason='customer_rejected_revised_charges',
        customer_reapproval_responded_at=p_now,customer_reapproval_response='reject',updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values(
      v_order.id,'awaiting_customer_reapproval','cancelled','customer',p_customer_user_id,
      'customer_reapproval_rejected',
      jsonb_build_object(
        'approved_total',v_order.customer_approved_total,'revised_total',v_current_total,
        'approved_vehicle_type',v_order.customer_approved_vehicle_type,'revised_vehicle_type',v_revised_vehicle
      ),p_now
    );
    return jsonb_build_object('ok',true,'status','cancelled','response','reject');
  end if;

  v_resume_status := coalesce(v_order.customer_reapproval_resume_status,'preparing');
  if v_resume_status not in ('producer_accepted','preparing','ready_for_dispatch') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_REAPPROVAL_RESUME_STATUS_INVALID');
  end if;

  update public.agrimarket_orders
  set customer_approved_total=v_current_total,
      customer_approved_vehicle_type=v_revised_vehicle,
      customer_reapproval_responded_at=p_now,
      customer_reapproval_response='accept',
      status=v_resume_status,
      updated_at=p_now
  where id=v_order.id;

  insert into public.agrimarket_order_events(
    order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
  ) values(
    v_order.id,'awaiting_customer_reapproval',v_resume_status,'customer',p_customer_user_id,
    'customer_reapproval_accepted',
    jsonb_build_object('approved_total',v_current_total,'approved_vehicle_type',v_revised_vehicle,'resume_status',v_resume_status),
    p_now
  );

  return jsonb_build_object(
    'ok',true,'status',v_resume_status,'response','accept',
    'customer_approved_total',v_current_total,'customer_approved_vehicle_type',v_revised_vehicle
  );
end;
$function$;


select cron.schedule('agrimarket-reapproval-expiry','10 seconds',
  'select public.agrimarket_expire_customer_reapproval_v1()');
