alter table public.agrimarket_orders
  add column customer_cash_collected_at timestamptz,
  add column customer_cash_collected_amount numeric(12,2) not null default 0,
  add column customer_cash_collected_by_driver_id uuid,
  add column producer_paid_at timestamptz,
  add column producer_paid_amount numeric(12,2) not null default 0,
  add column producer_paid_by_driver_id uuid,
  add column final_cash_collected_at timestamptz,
  add column final_cash_collected_amount numeric(12,2) not null default 0,
  add column delivery_confirmed_by_driver_id uuid,
  add column company_settlement_due numeric(12,2)
    generated always as (coalesce(marketplace_fee,0) + coalesce(delivery_company_cut,0)) stored,
  add column wallet_settlement_status text not null default 'not_due',
  add column wallet_settlement_amount numeric(12,2) not null default 0,
  add column wallet_settlement_id uuid,
  add column wallet_settled_at timestamptz,
  add column wallet_settlement_error text;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_cash_amounts_chk check (
    customer_cash_collected_amount >= 0
    and producer_paid_amount >= 0
    and final_cash_collected_amount >= 0
    and wallet_settlement_amount >= 0
  ),
  add constraint agrimarket_orders_wallet_settlement_status_chk check (
    wallet_settlement_status in ('not_due','pending','settled','failed')
  );

alter table public.driver_wallet_transactions
  add column agrimarket_order_id uuid references public.agrimarket_orders(id) on delete set null;

create index if not exists driver_wallet_transactions_agrimarket_order_idx
  on public.driver_wallet_transactions(agrimarket_order_id)
  where agrimarket_order_id is not null;

create unique index if not exists driver_wallet_transactions_agrimarket_settlement_uidx
  on public.driver_wallet_transactions(agrimarket_order_id)
  where agrimarket_order_id is not null
    and reason = 'agrimarket_cash_settlement_v1';

create unique index if not exists agrimarket_pickup_checks_unique_v1
  on public.agrimarket_pickup_checks(order_id,order_item_id,driver_id,check_type);

create or replace function public.agrimarket_settle_delivered_order_v1(
  p_order_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_driver public.drivers%rowtype;
  v_due numeric(12,2);
  v_old_balance numeric(12,2);
  v_new_balance numeric(12,2);
  v_settlement_id uuid;
  v_existing_tx uuid;
  v_min_wallet numeric(12,2);
begin
  select * into v_order
  from public.agrimarket_orders
  where id = p_order_id
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND');
  end if;

  if v_order.status = 'completed' and v_order.wallet_settlement_status = 'settled' then
    return jsonb_build_object(
      'ok',true,'settled',true,'already_settled',true,
      'order_id',v_order.id,'order_code',v_order.order_code,
      'status',v_order.status,'wallet_settlement_amount',v_order.wallet_settlement_amount
    );
  end if;

  if v_order.status not in ('delivered','completed') then
    return jsonb_build_object(
      'ok',false,'error','AGRIMARKET_ORDER_NOT_DELIVERED','status',v_order.status
    );
  end if;

  if v_order.assigned_driver_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ASSIGNED_DRIVER_REQUIRED');
  end if;

  v_due := round(coalesce(v_order.marketplace_fee,0) + coalesce(v_order.delivery_company_cut,0),2);

  select t.id into v_existing_tx
  from public.driver_wallet_transactions t
  where t.agrimarket_order_id = v_order.id
    and t.reason = 'agrimarket_cash_settlement_v1'
  order by t.created_at desc
  limit 1;

  if v_existing_tx is not null then
    update public.agrimarket_orders
    set wallet_settlement_status = 'settled',
        wallet_settlement_amount = v_due,
        wallet_settled_at = coalesce(wallet_settled_at,p_now),
        wallet_settlement_error = null,
        status = 'completed',
        completed_at = coalesce(completed_at,p_now),
        updated_at = p_now
    where id = v_order.id;

    return jsonb_build_object(
      'ok',true,'settled',true,'already_settled',true,
      'order_id',v_order.id,'order_code',v_order.order_code,
      'status','completed','wallet_settlement_amount',v_due
    );
  end if;

  if v_due <= 0 then
    update public.agrimarket_orders
    set wallet_settlement_status = 'settled',
        wallet_settlement_amount = 0,
        wallet_settlement_id = coalesce(wallet_settlement_id,gen_random_uuid()),
        wallet_settled_at = p_now,
        wallet_settlement_error = null,
        status = 'completed',
        completed_at = coalesce(completed_at,p_now),
        updated_at = p_now
    where id = v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,v_order.status,'completed','system',null,
      'cash_settlement_completed',jsonb_build_object('wallet_deduction',0),p_now
    );

    return jsonb_build_object(
      'ok',true,'settled',true,'order_id',v_order.id,'order_code',v_order.order_code,
      'status','completed','wallet_settlement_amount',0
    );
  end if;

  select * into v_driver
  from public.drivers
  where id = v_order.assigned_driver_id
  for update;

  if not found then
    update public.agrimarket_orders
    set wallet_settlement_status='failed',
        wallet_settlement_error='AGRIMARKET_DRIVER_NOT_FOUND',
        updated_at=p_now
    where id=v_order.id;
    return jsonb_build_object('ok',false,'error','AGRIMARKET_DRIVER_NOT_FOUND');
  end if;

  v_old_balance := round(coalesce(v_driver.wallet_balance,0),2);
  v_min_wallet := greatest(coalesce(v_driver.min_wallet_required,250),250);

  if v_old_balance < v_due then
    update public.agrimarket_orders
    set wallet_settlement_status='pending',
        wallet_settlement_amount=v_due,
        wallet_settlement_error='INSUFFICIENT_DRIVER_WALLET_FOR_CASH_SETTLEMENT',
        updated_at=p_now
    where id=v_order.id;

    if coalesce(v_order.wallet_settlement_error,'') <> 'INSUFFICIENT_DRIVER_WALLET_FOR_CASH_SETTLEMENT' then
      insert into public.driver_notifications(driver_id,type,message)
      values (
        v_order.assigned_driver_id,
        'agrimarket_settlement_due',
        format(
          'Agrimarket order %s is delivered. Please top up at least %s so the JRide cash settlement can complete.',
          v_order.order_code,
          chr(8369) || to_char(v_due,'FM999999990.00')
        )
      );
    end if;

    return jsonb_build_object(
      'ok',true,'settled',false,'settlement_pending',true,
      'settlement_pending_reason','INSUFFICIENT_DRIVER_WALLET_FOR_CASH_SETTLEMENT',
      'order_id',v_order.id,'order_code',v_order.order_code,'status','delivered',
      'wallet_balance',v_old_balance,'wallet_settlement_amount',v_due
    );
  end if;

  v_new_balance := round(v_old_balance - v_due,2);
  v_settlement_id := gen_random_uuid();

  insert into public.driver_wallet_transactions(
    driver_id,amount,balance_after,reason,booking_id,wallet_settlement_id,agrimarket_order_id,created_at
  ) values (
    v_order.assigned_driver_id,-v_due,v_new_balance,'agrimarket_cash_settlement_v1',
    null,v_settlement_id,v_order.id,p_now
  );

  update public.drivers
  set wallet_balance = v_new_balance
  where id = v_order.assigned_driver_id;

  if v_old_balance > v_min_wallet and v_new_balance <= v_min_wallet then
    insert into public.driver_notifications(driver_id,type,message)
    values (
      v_order.assigned_driver_id,
      'low_wallet',
      format(
        'Your JRide load wallet is now %s. Minimum required to accept new bookings is %s. Please top up.',
        chr(8369) || to_char(v_new_balance,'FM999999990.00'),
        chr(8369) || to_char(v_min_wallet,'FM999999990.00')
      )
    );
  end if;

  update public.agrimarket_orders
  set wallet_settlement_status='settled',
      wallet_settlement_amount=v_due,
      wallet_settlement_id=v_settlement_id,
      wallet_settled_at=p_now,
      wallet_settlement_error=null,
      status='completed',
      completed_at=coalesce(completed_at,p_now),
      updated_at=p_now
  where id=v_order.id;

  insert into public.agrimarket_order_events(
    order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
  ) values (
    v_order.id,v_order.status,'completed','system',null,
    'cash_settlement_completed',
    jsonb_build_object(
      'wallet_settlement_id',v_settlement_id,
      'wallet_deduction',v_due,
      'marketplace_fee',coalesce(v_order.marketplace_fee,0),
      'delivery_company_cut',coalesce(v_order.delivery_company_cut,0),
      'wallet_balance_after',v_new_balance
    ),p_now
  );

  return jsonb_build_object(
    'ok',true,'settled',true,'order_id',v_order.id,'order_code',v_order.order_code,
    'status','completed','wallet_settlement_id',v_settlement_id,
    'wallet_settlement_amount',v_due,'wallet_balance_after',v_new_balance
  );
end;
$$;

create or replace function public.agrimarket_driver_execute_v1(
  p_order_code text,
  p_driver_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_item public.agrimarket_order_items%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_amount numeric(12,2);
  v_expected numeric(12,2);
  v_reason text;
  v_check_type text;
  v_result text;
  v_observed text;
  v_notes text;
  v_item_id uuid;
  v_has_handling boolean;
  v_previous_handling numeric(12,2);
  v_previous_selected_at timestamptz;
  v_settlement jsonb;
begin
  if trim(coalesce(p_order_code,'')) = '' or p_driver_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_AND_DRIVER_REQUIRED');
  end if;

  select * into v_order
  from public.agrimarket_orders
  where order_code = trim(p_order_code)
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND');
  end if;

  if v_order.assigned_driver_id is distinct from p_driver_id then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_ASSIGNED_TO_DRIVER');
  end if;

  if v_action = 'collect_customer_cash' then
    if not v_order.cash_collection_required or v_order.route_plan <> 'customer_cash_first' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CUSTOMER_CASH_FIRST_NOT_REQUIRED');
    end if;
    if v_order.status <> 'driver_assigned' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CASH_COLLECTION_WRONG_STATUS','status',v_order.status);
    end if;
    if v_order.customer_cash_collected_at is not null then
      return jsonb_build_object(
        'ok',true,'already_done',true,'action',v_action,
        'amount',v_order.customer_cash_collected_amount,'next','pay_farmer'
      );
    end if;
    begin
      v_amount := round((p_payload->>'amount')::numeric,2);
    exception when others then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_CASH_AMOUNT_REQUIRED');
    end;
    v_expected := round(coalesce(v_order.cash_collection_amount,0),2);
    if v_amount is distinct from v_expected then
      return jsonb_build_object(
        'ok',false,'error','AGRIMARKET_CUSTOMER_CASH_AMOUNT_MISMATCH',
        'expected_amount',v_expected,'received_amount',v_amount
      );
    end if;

    update public.agrimarket_orders
    set customer_cash_collected_at=p_now,
        customer_cash_collected_amount=v_amount,
        customer_cash_collected_by_driver_id=p_driver_id,
        updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,v_order.status,v_order.status,'driver',p_driver_id,
      'customer_product_cash_collected',jsonb_build_object('amount',v_amount),p_now
    );

    return jsonb_build_object('ok',true,'action',v_action,'amount',v_amount,'next','pay_farmer');
  end if;

  if v_action = 'pay_farmer' then
    if v_order.status <> 'driver_assigned' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_FARMER_PAYMENT_WRONG_STATUS','status',v_order.status);
    end if;
    if v_order.cash_collection_required and v_order.customer_cash_collected_at is null then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_COLLECT_CUSTOMER_CASH_FIRST');
    end if;
    if v_order.producer_paid_at is not null then
      return jsonb_build_object(
        'ok',true,'already_done',true,'action',v_action,
        'amount',v_order.producer_paid_amount,'next','verify_pickup'
      );
    end if;
    begin
      v_amount := round((p_payload->>'amount')::numeric,2);
    exception when others then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_FARMER_PAYMENT_REQUIRED');
    end;
    v_expected := round(coalesce(v_order.producer_product_net,v_order.product_subtotal),2);
    if v_amount is distinct from v_expected then
      return jsonb_build_object(
        'ok',false,'error','AGRIMARKET_FARMER_PAYMENT_AMOUNT_MISMATCH',
        'expected_amount',v_expected,'paid_amount',v_amount
      );
    end if;

    update public.agrimarket_orders
    set producer_paid_at=p_now,
        producer_paid_amount=v_amount,
        producer_paid_by_driver_id=p_driver_id,
        updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,v_order.status,v_order.status,'driver',p_driver_id,
      'producer_paid',
      jsonb_build_object(
        'amount',v_amount,
        'driver_cash_advance',not v_order.cash_collection_required,
        'marketplace_fee_withheld',coalesce(v_order.marketplace_fee,0)
      ),p_now
    );

    return jsonb_build_object(
      'ok',true,'action',v_action,'amount',v_amount,
      'driver_cash_advance',not v_order.cash_collection_required,
      'next','verify_pickup'
    );
  end if;

  if v_action = 'set_handling_fee' then
    if v_order.status <> 'driver_assigned' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_HANDLING_WRONG_STATUS','status',v_order.status);
    end if;
    if v_order.handling_locked_at is not null then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_HANDLING_FEE_LOCKED');
    end if;
    begin
      v_amount := round((p_payload->>'amount')::numeric,2);
    exception when others then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_HANDLING_AMOUNT_REQUIRED');
    end;
    if v_amount not in (0,10,20,30,40,50) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_HANDLING_FEE');
    end if;

    select exists(
      select 1 from public.agrimarket_order_items oi
      where oi.order_id=v_order.id and oi.handling_eligible=true
    ) into v_has_handling;

    v_reason := nullif(trim(coalesce(p_payload->>'reason','')),'');
    if v_amount > 0 and not v_has_handling then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_HANDLING_NOT_ELIGIBLE');
    end if;
    if v_amount > 0 and v_reason not in (
      'carry_load_sack','multiple_sacks','heavy_crate','livestock_loading','unloading_assistance','other_approved'
    ) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_HANDLING_REASON_REQUIRED');
    end if;
    if v_amount = 0 then
      v_reason := null;
    end if;

    v_previous_handling := v_order.handling_fee;
    v_previous_selected_at := v_order.handling_selected_at;

    update public.agrimarket_orders
    set handling_fee=v_amount,
        handling_reason=v_reason,
        handling_selected_by_driver_id=p_driver_id,
        handling_selected_at=p_now,
        updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_handling_fee_events(
      order_id,driver_id,amount,reason,action,created_at
    ) values (
      v_order.id,p_driver_id,v_amount,v_reason,
      case when v_previous_selected_at is null then 'selected' else 'changed' end,
      p_now
    );

    return jsonb_build_object(
      'ok',true,'action',v_action,'handling_fee',v_amount,'handling_reason',v_reason,
      'previous_handling_fee',coalesce(v_previous_handling,0),
      'total_payable',round(v_order.product_subtotal + v_order.delivery_fee + v_order.pickup_distance_fee + v_amount,2),
      'next','verify_pickup'
    );
  end if;

  if v_action = 'verify_item' then
    if v_order.status <> 'driver_assigned' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_PICKUP_VERIFICATION_WRONG_STATUS','status',v_order.status);
    end if;
    if v_order.producer_paid_at is null then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_PAY_FARMER_BEFORE_PICKUP_VERIFICATION');
    end if;

    begin
      v_item_id := (p_payload->>'order_item_id')::uuid;
    exception when others then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_ORDER_ITEM_ID_REQUIRED');
    end;
    v_check_type := lower(trim(coalesce(p_payload->>'check_type','')));
    v_result := lower(trim(coalesce(p_payload->>'result','')));
    v_observed := nullif(trim(coalesce(p_payload->>'observed_condition','')),'');
    v_notes := nullif(trim(coalesce(p_payload->>'notes','')),'');

    if v_check_type not in ('quantity','condition','cargo') then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_PICKUP_CHECK_TYPE');
    end if;
    if v_result not in ('pass','mismatch') then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_PICKUP_CHECK_RESULT');
    end if;

    select * into v_item
    from public.agrimarket_order_items
    where id=v_item_id and order_id=v_order.id;

    if not found then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_ITEM_NOT_FOUND');
    end if;

    if v_check_type='condition' and v_result='pass' and v_observed is null then
      v_observed := v_item.condition_required;
    end if;

    insert into public.agrimarket_pickup_checks(
      order_id,order_item_id,driver_id,check_type,expected_condition,
      result,observed_condition,notes,checked_at
    ) values (
      v_order.id,v_item.id,p_driver_id,v_check_type,v_item.condition_required,
      v_result,v_observed,v_notes,p_now
    )
    on conflict (order_id,order_item_id,driver_id,check_type)
    do update set
      expected_condition=excluded.expected_condition,
      result=excluded.result,
      observed_condition=excluded.observed_condition,
      notes=excluded.notes,
      checked_at=excluded.checked_at;

    return jsonb_build_object(
      'ok',true,'action',v_action,'order_item_id',v_item.id,
      'check_type',v_check_type,'result',v_result,
      'received_live',case when v_item.condition_required='live_at_pickup' and v_check_type='condition' then v_result='pass' else null end,
      'next',case when v_result='mismatch' then 'resolve_mismatch' else 'continue_verification' end
    );
  end if;

  if v_action = 'confirm_pickup' then
    if v_order.status in ('picked_up','delivering','delivered','completed') then
      return jsonb_build_object('ok',true,'already_done',true,'action',v_action,'status',v_order.status);
    end if;
    if v_order.status <> 'driver_assigned' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CONFIRM_PICKUP_WRONG_STATUS','status',v_order.status);
    end if;
    if v_order.producer_paid_at is null then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_FARMER_PAYMENT_REQUIRED_BEFORE_PICKUP');
    end if;
    if v_order.cash_collection_required and v_order.customer_cash_collected_at is null then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CUSTOMER_CASH_REQUIRED_BEFORE_PICKUP');
    end if;

    if exists(
      select 1 from public.agrimarket_order_items oi
      where oi.order_id=v_order.id
        and not exists(
          select 1 from public.agrimarket_pickup_checks pc
          where pc.order_id=v_order.id and pc.order_item_id=oi.id
            and pc.driver_id=p_driver_id and pc.check_type='quantity' and pc.result='pass'
        )
    ) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_QUANTITY_CHECK_REQUIRED_FOR_ALL_ITEMS');
    end if;

    if exists(
      select 1 from public.agrimarket_order_items oi
      where oi.order_id=v_order.id and oi.condition_required <> 'normal'
        and not exists(
          select 1 from public.agrimarket_pickup_checks pc
          where pc.order_id=v_order.id and pc.order_item_id=oi.id
            and pc.driver_id=p_driver_id and pc.check_type='condition' and pc.result='pass'
        )
    ) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CONDITION_CHECK_REQUIRED');
    end if;

    if exists(
      select 1 from public.agrimarket_order_items oi
      where oi.order_id=v_order.id
        and oi.cargo_class in ('bulk_sack','crate','live_fish','live_poultry','live_livestock')
        and not exists(
          select 1 from public.agrimarket_pickup_checks pc
          where pc.order_id=v_order.id and pc.order_item_id=oi.id
            and pc.driver_id=p_driver_id and pc.check_type='cargo' and pc.result='pass'
        )
    ) then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_CHECK_REQUIRED');
    end if;

    with consumed as (
      select r.product_id,sum(r.quantity)::numeric as qty
      from public.agrimarket_inventory_reservations r
      where r.order_id=v_order.id and r.status='active'
      group by r.product_id
    )
    update public.agrimarket_products p
    set reserved_quantity=greatest(p.reserved_quantity-consumed.qty,0),
        sold_quantity=p.sold_quantity+consumed.qty,
        updated_at=p_now
    from consumed
    where p.id=consumed.product_id;

    update public.agrimarket_inventory_reservations
    set status='consumed',consumed_at=p_now
    where order_id=v_order.id and status='active';

    update public.agrimarket_orders
    set status='picked_up',picked_up_at=p_now,
        handling_locked_at=p_now,updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_handling_fee_events(
      order_id,driver_id,amount,reason,action,created_at
    ) values (
      v_order.id,p_driver_id,coalesce(v_order.handling_fee,0),v_order.handling_reason,'locked',p_now
    );

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,'driver_assigned','picked_up','driver',p_driver_id,'pickup_confirmed',
      jsonb_build_object(
        'handling_fee',coalesce(v_order.handling_fee,0),
        'producer_paid_amount',coalesce(v_order.producer_paid_amount,0),
        'customer_cash_collected_amount',coalesce(v_order.customer_cash_collected_amount,0)
      ),p_now
    );

    return jsonb_build_object(
      'ok',true,'action',v_action,'status','picked_up',
      'handling_fee_locked',coalesce(v_order.handling_fee,0),'next','start_delivery'
    );
  end if;

  if v_action = 'start_delivery' then
    if v_order.status in ('delivering','delivered','completed') then
      return jsonb_build_object('ok',true,'already_done',true,'action',v_action,'status',v_order.status);
    end if;
    if v_order.status <> 'picked_up' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_START_DELIVERY_WRONG_STATUS','status',v_order.status);
    end if;

    update public.agrimarket_orders
    set status='delivering',delivering_at=p_now,updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,'picked_up','delivering','driver',p_driver_id,'delivery_started','{}'::jsonb,p_now
    );

    return jsonb_build_object('ok',true,'action',v_action,'status','delivering','next','confirm_delivery');
  end if;

  if v_action = 'confirm_delivery' then
    if v_order.status = 'completed' then
      return jsonb_build_object(
        'ok',true,'already_done',true,'action',v_action,'status','completed',
        'wallet_settlement_status',v_order.wallet_settlement_status
      );
    end if;
    if v_order.status = 'delivered' then
      return public.agrimarket_settle_delivered_order_v1(v_order.id,p_now);
    end if;
    if v_order.status <> 'delivering' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CONFIRM_DELIVERY_WRONG_STATUS','status',v_order.status);
    end if;

    begin
      v_amount := round((p_payload->>'amount')::numeric,2);
    exception when others then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_FINAL_CASH_AMOUNT_REQUIRED');
    end;
    v_expected := round(greatest(coalesce(v_order.total_payable,0)-coalesce(v_order.customer_cash_collected_amount,0),0),2);
    if v_amount is distinct from v_expected then
      return jsonb_build_object(
        'ok',false,'error','AGRIMARKET_FINAL_CASH_AMOUNT_MISMATCH',
        'expected_amount',v_expected,'received_amount',v_amount
      );
    end if;

    update public.agrimarket_orders
    set final_cash_collected_at=p_now,
        final_cash_collected_amount=v_amount,
        delivery_confirmed_by_driver_id=p_driver_id,
        delivered_at=p_now,
        status='delivered',
        wallet_settlement_status='pending',
        wallet_settlement_amount=company_settlement_due,
        wallet_settlement_error=null,
        updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values (
      v_order.id,'delivering','delivered','driver',p_driver_id,'delivery_confirmed',
      jsonb_build_object(
        'final_cash_collected',v_amount,
        'earlier_customer_cash_collected',coalesce(v_order.customer_cash_collected_amount,0),
        'total_customer_cash',round(v_amount+coalesce(v_order.customer_cash_collected_amount,0),2),
        'total_payable',v_order.total_payable
      ),p_now
    );

    v_settlement := public.agrimarket_settle_delivered_order_v1(v_order.id,p_now);
    return jsonb_build_object(
      'ok',true,'action',v_action,'delivered',true,
      'final_cash_collected',v_amount,'settlement',v_settlement,
      'status',coalesce(v_settlement->>'status','delivered')
    );
  end if;

  if v_action = 'retry_settlement' then
    if v_order.status not in ('delivered','completed') then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_SETTLEMENT_NOT_DUE','status',v_order.status);
    end if;
    return public.agrimarket_settle_delivered_order_v1(v_order.id,p_now);
  end if;

  return jsonb_build_object('ok',false,'error','AGRIMARKET_UNKNOWN_DRIVER_ACTION','action',v_action);
end;
$$;

create or replace function public.agrimarket_retry_pending_settlements_v1(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 100
)
returns table(
  order_id uuid,
  order_code text,
  settled boolean,
  result jsonb
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row record;
  v_result jsonb;
  v_limit integer := least(greatest(coalesce(p_limit,100),1),500);
begin
  for v_row in
    select o.id,o.order_code
    from public.agrimarket_orders o
    where o.status='delivered'
      and o.wallet_settlement_status in ('pending','failed')
    order by o.delivered_at nulls last,o.id
    limit v_limit
  loop
    v_result := public.agrimarket_settle_delivered_order_v1(v_row.id,p_now);
    order_id := v_row.id;
    order_code := v_row.order_code;
    settled := coalesce((v_result->>'settled')::boolean,false);
    result := v_result;
    return next;
  end loop;
end;
$$;

revoke all on function public.agrimarket_settle_delivered_order_v1(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_driver_execute_v1(text,uuid,text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_retry_pending_settlements_v1(timestamptz,integer) from public,anon,authenticated;

grant execute on function public.agrimarket_settle_delivered_order_v1(uuid,timestamptz) to service_role;
grant execute on function public.agrimarket_driver_execute_v1(text,uuid,text,jsonb,timestamptz) to service_role;
grant execute on function public.agrimarket_retry_pending_settlements_v1(timestamptz,integer) to service_role;
