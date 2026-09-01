-- AGRIMARKET CUSTOMER REAPPROVAL GATE - STEP 4 V1
--
-- Scope: customer consent gate only.
-- No Heavy Load pricing, Driver Approach pricing, or weight-based vehicle
-- calculation is introduced here.
--
-- The gate compares the current pre-dispatch customer total against the amount
-- the customer has already approved. It also pauses when a later rule changes a
-- motorcycle-approved order into a tricycle-required order.

do $$
begin
  if to_regprocedure(
    'public.agrimarket_confirm_order_cargo_v2(text,uuid,text,numeric,text,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP4_REQUIRES_CARGO_CONFIRMATION_V2';
  end if;

  if to_regprocedure(
    'public.agrimarket_release_active_reservations_v1(uuid,text,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP4_REQUIRES_RESERVATION_RELEASE_V1';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='agrimarket_orders'
      and column_name='handling_fee'
  ) then
    raise exception 'AGRIMARKET_STEP4_REQUIRES_SPECIAL_HANDLING_SLOT';
  end if;
end;
$$;

alter table public.agrimarket_orders
  add column customer_approved_total numeric(12,2),
  add column customer_approved_vehicle_type text,
  add column customer_reapproval_required_at timestamptz,
  add column customer_reapproval_responded_at timestamptz,
  add column customer_reapproval_response text,
  add column customer_reapproval_proposed_total numeric(12,2),
  add column customer_reapproval_proposed_vehicle_type text,
  add column customer_reapproval_resume_status text;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_customer_approved_total_chk
    check (customer_approved_total is null or customer_approved_total >= 0),
  add constraint agrimarket_orders_customer_approved_vehicle_chk
    check (
      customer_approved_vehicle_type is null
      or customer_approved_vehicle_type in ('motorcycle','tricycle')
    ),
  add constraint agrimarket_orders_customer_reapproval_response_chk
    check (
      customer_reapproval_response is null
      or customer_reapproval_response in ('accept','reject','not_required')
    ),
  add constraint agrimarket_orders_customer_reapproval_total_chk
    check (
      customer_reapproval_proposed_total is null
      or customer_reapproval_proposed_total >= 0
    ),
  add constraint agrimarket_orders_customer_reapproval_vehicle_chk
    check (
      customer_reapproval_proposed_vehicle_type is null
      or customer_reapproval_proposed_vehicle_type in ('motorcycle','tricycle')
    ),
  add constraint agrimarket_orders_customer_reapproval_resume_status_chk
    check (
      customer_reapproval_resume_status is null
      or customer_reapproval_resume_status in (
        'producer_accepted','preparing','ready_for_dispatch'
      )
    );

-- Existing rows were already accepted under their current total/vehicle state.
update public.agrimarket_orders
set customer_approved_total = round(coalesce(total_payable,0),2),
    customer_approved_vehicle_type = case
      when preferred_vehicle_type='tricycle' then 'tricycle'
      else 'motorcycle'
    end
where customer_approved_total is null
   or customer_approved_vehicle_type is null;

alter table public.agrimarket_orders
  alter column customer_approved_total set not null,
  alter column customer_approved_vehicle_type set not null;

-- Add the one new lifecycle state without changing any existing state.
alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_status_chk;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_status_chk
  check (
    status in (
      'awaiting_producer',
      'awaiting_harvest',
      'producer_accepted',
      'preparing',
      'awaiting_customer_reapproval',
      'ready_for_dispatch',
      'dispatching',
      'driver_assigned',
      'picked_up',
      'delivering',
      'delivered',
      'completed',
      'producer_rejected',
      'producer_timeout',
      'cancelled',
      'exception'
    )
  );

-- New orders snapshot the customer's checkout approval. This trigger is kept
-- independent of the order-creation RPC so future create-RPC versions cannot
-- accidentally omit the baseline.
create or replace function public.agrimarket_initialize_customer_approval_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.customer_approved_total := round(
    coalesce(new.product_subtotal,0)
    + coalesce(new.delivery_fee,0)
    + coalesce(new.pickup_distance_fee,0)
    + coalesce(new.handling_fee,0),
    2
  );

  new.customer_approved_vehicle_type := case
    when new.preferred_vehicle_type='tricycle' then 'tricycle'
    else 'motorcycle'
  end;

  new.customer_reapproval_required_at := null;
  new.customer_reapproval_responded_at := null;
  new.customer_reapproval_response := null;
  new.customer_reapproval_proposed_total := null;
  new.customer_reapproval_proposed_vehicle_type := null;
  new.customer_reapproval_resume_status := null;

  return new;
end;
$$;

revoke all on function public.agrimarket_initialize_customer_approval_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_initialize_customer_approval_trg
  on public.agrimarket_orders;

create trigger agrimarket_initialize_customer_approval_trg
before insert on public.agrimarket_orders
for each row
execute function public.agrimarket_initialize_customer_approval_v1();

-- Re-evaluate consent after farmer-confirmed handling changes or a future
-- required-vehicle update. Step 5/7 may extend the trigger column list when
-- they introduce additional recalculated fields.
create or replace function public.agrimarket_evaluate_customer_reapproval_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_current_total numeric(12,2);
  v_approved_total numeric(12,2);
  v_approved_vehicle text;
  v_revised_vehicle text;
  v_price_increased boolean;
  v_vehicle_escalated boolean;
  v_resume_status text;
  v_was_pending boolean;
  v_proposal_changed boolean;
begin
  v_current_total := round(coalesce(new.total_payable,0),2);
  v_approved_total := round(coalesce(new.customer_approved_total,0),2);
  v_approved_vehicle := coalesce(new.customer_approved_vehicle_type,'motorcycle');

  v_revised_vehicle := case
    when new.required_vehicle_type='tricycle' then 'tricycle'
    else v_approved_vehicle
  end;

  v_price_increased := v_current_total > v_approved_total;
  v_vehicle_escalated :=
    v_revised_vehicle='tricycle' and v_approved_vehicle <> 'tricycle';

  v_was_pending :=
    new.status='awaiting_customer_reapproval'
    and new.customer_reapproval_response is null;

  if v_price_increased or v_vehicle_escalated then
    if new.assigned_driver_id is not null
       or new.status in (
         'dispatching','driver_assigned','picked_up','delivering',
         'delivered','completed'
       ) then
      raise exception 'AGRIMARKET_CUSTOMER_REAPPROVAL_REQUIRED_AFTER_DISPATCH'
        using errcode='P0001';
    end if;

    if new.status not in (
      'producer_accepted','preparing','ready_for_dispatch',
      'awaiting_customer_reapproval'
    ) then
      raise exception 'AGRIMARKET_CUSTOMER_REAPPROVAL_WRONG_STATUS'
        using errcode='P0001';
    end if;

    v_resume_status := case
      when new.status='awaiting_customer_reapproval'
        then coalesce(new.customer_reapproval_resume_status,'preparing')
      else new.status
    end;

    v_proposal_changed :=
      not v_was_pending
      or new.customer_reapproval_proposed_total is distinct from v_current_total
      or new.customer_reapproval_proposed_vehicle_type is distinct from v_revised_vehicle;

    update public.agrimarket_orders
    set status='awaiting_customer_reapproval',
        customer_reapproval_required_at=case
          when v_was_pending then coalesce(customer_reapproval_required_at,v_now)
          else v_now
        end,
        customer_reapproval_responded_at=null,
        customer_reapproval_response=null,
        customer_reapproval_proposed_total=v_current_total,
        customer_reapproval_proposed_vehicle_type=v_revised_vehicle,
        customer_reapproval_resume_status=v_resume_status,
        updated_at=v_now
    where id=new.id;

    if v_proposal_changed then
      insert into public.agrimarket_order_events(
        order_id,from_status,to_status,actor_type,actor_id,
        reason_code,details,created_at
      )
      values(
        new.id,
        new.status,
        'awaiting_customer_reapproval',
        'system',
        null,
        'customer_reapproval_required',
        jsonb_build_object(
          'approved_total',v_approved_total,
          'revised_total',v_current_total,
          'price_increased',v_price_increased,
          'approved_vehicle_type',v_approved_vehicle,
          'revised_vehicle_type',v_revised_vehicle,
          'vehicle_escalated',v_vehicle_escalated,
          'resume_status',v_resume_status
        ),
        v_now
      );
    end if;

    return null;
  end if;

  -- If a pending revision becomes unchanged/lower before the customer responds,
  -- remove the gate automatically, as locked in the V1 policy.
  if v_was_pending then
    v_resume_status := coalesce(
      new.customer_reapproval_resume_status,
      'preparing'
    );

    update public.agrimarket_orders
    set status=v_resume_status,
        customer_reapproval_responded_at=v_now,
        customer_reapproval_response='not_required',
        customer_reapproval_proposed_total=v_current_total,
        customer_reapproval_proposed_vehicle_type=v_revised_vehicle,
        updated_at=v_now
    where id=new.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,
      reason_code,details,created_at
    )
    values(
      new.id,
      'awaiting_customer_reapproval',
      v_resume_status,
      'system',
      null,
      'customer_reapproval_no_longer_required',
      jsonb_build_object(
        'approved_total',v_approved_total,
        'current_total',v_current_total,
        'approved_vehicle_type',v_approved_vehicle,
        'current_vehicle_type',v_revised_vehicle
      ),
      v_now
    );
  end if;

  return null;
end;
$$;

revoke all on function public.agrimarket_evaluate_customer_reapproval_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_evaluate_customer_reapproval_trg
  on public.agrimarket_orders;

create trigger agrimarket_evaluate_customer_reapproval_trg
after update of confirmed_handling_tier, handling_fee, required_vehicle_type
on public.agrimarket_orders
for each row
execute function public.agrimarket_evaluate_customer_reapproval_v1();

-- Fail closed if any unrelated status transition tries to escape a pending
-- customer gate. The acceptance RPC changes response and status atomically.
create or replace function public.agrimarket_guard_pending_customer_reapproval_v1()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if old.status='awaiting_customer_reapproval'
     and old.customer_reapproval_response is null
     and new.status is distinct from old.status
     and coalesce(new.customer_reapproval_response,'') not in (
       'accept','reject','not_required'
     )
     and new.status not in (
       'cancelled','producer_rejected','producer_timeout','exception'
     ) then
    raise exception 'AGRIMARKET_CUSTOMER_REAPPROVAL_REQUIRED_BEFORE_DISPATCH'
      using errcode='P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.agrimarket_guard_pending_customer_reapproval_v1()
  from public,anon,authenticated,service_role;

drop trigger if exists agrimarket_guard_pending_customer_reapproval_trg
  on public.agrimarket_orders;

create trigger agrimarket_guard_pending_customer_reapproval_trg
before update of status
on public.agrimarket_orders
for each row
execute function public.agrimarket_guard_pending_customer_reapproval_v1();

-- Customer response is the only application RPC that accepts the revised
-- pre-dispatch amount/vehicle. Rejecting releases inventory and cancels.
create or replace function public.agrimarket_customer_respond_reapproval_v1(
  p_order_code text,
  p_customer_user_id uuid,
  p_response text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_response text := lower(trim(coalesce(p_response,'')));
  v_resume_status text;
  v_current_total numeric(12,2);
  v_revised_vehicle text;
begin
  if v_response not in ('accept','reject') then
    return jsonb_build_object(
      'ok',false,'error','AGRIMARKET_INVALID_REAPPROVAL_RESPONSE'
    );
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(coalesce(p_order_code,''))
    and o.customer_user_id=p_customer_user_id
  for update;

  if v_order.id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND');
  end if;

  if v_order.status <> 'awaiting_customer_reapproval'
     or v_order.customer_reapproval_response is not null then
    return jsonb_build_object(
      'ok',false,
      'error','AGRIMARKET_REAPPROVAL_WRONG_STATUS',
      'status',v_order.status
    );
  end if;

  v_current_total := round(coalesce(v_order.total_payable,0),2);
  v_revised_vehicle := case
    when v_order.required_vehicle_type='tricycle' then 'tricycle'
    else v_order.customer_approved_vehicle_type
  end;

  if v_order.customer_reapproval_proposed_total is distinct from v_current_total
     or v_order.customer_reapproval_proposed_vehicle_type is distinct from v_revised_vehicle then
    return jsonb_build_object(
      'ok',false,
      'error','AGRIMARKET_REAPPROVAL_PROPOSAL_STALE'
    );
  end if;

  if v_response='reject' then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id,
      'released',
      'Customer rejected revised Agrimarket charges',
      p_now
    );

    update public.agrimarket_orders
    set status='cancelled',
        cancelled_at=p_now,
        cancel_reason='customer_rejected_revised_charges',
        customer_reapproval_responded_at=p_now,
        customer_reapproval_response='reject',
        updated_at=p_now
    where id=v_order.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,
      reason_code,details,created_at
    )
    values(
      v_order.id,
      'awaiting_customer_reapproval',
      'cancelled',
      'customer',
      p_customer_user_id,
      'customer_reapproval_rejected',
      jsonb_build_object(
        'approved_total',v_order.customer_approved_total,
        'revised_total',v_current_total,
        'approved_vehicle_type',v_order.customer_approved_vehicle_type,
        'revised_vehicle_type',v_revised_vehicle
      ),
      p_now
    );

    return jsonb_build_object(
      'ok',true,'status','cancelled','response','reject'
    );
  end if;

  v_resume_status := coalesce(
    v_order.customer_reapproval_resume_status,
    'preparing'
  );

  if v_resume_status not in (
    'producer_accepted','preparing','ready_for_dispatch'
  ) then
    return jsonb_build_object(
      'ok',false,'error','AGRIMARKET_REAPPROVAL_RESUME_STATUS_INVALID'
    );
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
    order_id,from_status,to_status,actor_type,actor_id,
    reason_code,details,created_at
  )
  values(
    v_order.id,
    'awaiting_customer_reapproval',
    v_resume_status,
    'customer',
    p_customer_user_id,
    'customer_reapproval_accepted',
    jsonb_build_object(
      'approved_total',v_current_total,
      'approved_vehicle_type',v_revised_vehicle,
      'resume_status',v_resume_status
    ),
    p_now
  );

  return jsonb_build_object(
    'ok',true,
    'status',v_resume_status,
    'response','accept',
    'customer_approved_total',v_current_total,
    'customer_approved_vehicle_type',v_revised_vehicle
  );
end;
$$;

revoke all on function public.agrimarket_customer_respond_reapproval_v1(
  text,uuid,text,timestamptz
) from public,anon,authenticated,service_role;

grant execute on function public.agrimarket_customer_respond_reapproval_v1(
  text,uuid,text,timestamptz
) to service_role;

comment on column public.agrimarket_orders.customer_approved_total is
  'Latest pre-dispatch Agrimarket total explicitly approved by the customer.';
comment on column public.agrimarket_orders.customer_approved_vehicle_type is
  'Motorcycle or tricycle state already approved by the customer.';
comment on column public.agrimarket_orders.customer_reapproval_proposed_total is
  'Current revised pre-dispatch total awaiting customer approval.';
comment on column public.agrimarket_orders.customer_reapproval_proposed_vehicle_type is
  'Current revised vehicle state awaiting customer approval.';
comment on function public.agrimarket_customer_respond_reapproval_v1(
  text,uuid,text,timestamptz
) is
  'Accepts or rejects a pending Agrimarket revised-price/vehicle proposal before dispatch.';

-- Self-verifying postconditions.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.agrimarket_orders'::regclass
      and conname='agrimarket_orders_status_chk'
      and pg_get_constraintdef(oid) like '%awaiting_customer_reapproval%'
  ) then
    raise exception 'AGRIMARKET_STEP4_STATUS_NOT_INSTALLED';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.agrimarket_orders'::regclass
      and tgname='agrimarket_evaluate_customer_reapproval_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP4_EVALUATOR_TRIGGER_MISSING';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid='public.agrimarket_orders'::regclass
      and tgname='agrimarket_guard_pending_customer_reapproval_trg'
      and not tgisinternal
  ) then
    raise exception 'AGRIMARKET_STEP4_DISPATCH_GUARD_MISSING';
  end if;

  if exists (
    select 1 from public.agrimarket_orders
    where customer_approved_total is null
       or customer_approved_vehicle_type is null
  ) then
    raise exception 'AGRIMARKET_STEP4_APPROVAL_BASELINE_MISSING';
  end if;

  if to_regprocedure(
    'public.agrimarket_customer_respond_reapproval_v1(text,uuid,text,timestamptz)'
  ) is null then
    raise exception 'AGRIMARKET_STEP4_RESPONSE_RPC_MISSING';
  end if;
end;
$$;