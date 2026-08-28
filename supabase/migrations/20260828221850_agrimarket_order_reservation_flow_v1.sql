create index if not exists agrimarket_orders_delivery_address_idx
  on public.agrimarket_orders(delivery_address_id);

create index if not exists agrimarket_order_items_order_idx
  on public.agrimarket_order_items(order_id);

create index if not exists agrimarket_order_items_product_idx
  on public.agrimarket_order_items(product_id);

create index if not exists agrimarket_inventory_reservations_order_idx
  on public.agrimarket_inventory_reservations(order_id);

create index if not exists agrimarket_pickup_checks_order_item_idx
  on public.agrimarket_pickup_checks(order_item_id);

create or replace function public.agrimarket_release_active_reservations_v1(
  p_order_id uuid,
  p_reservation_status text,
  p_reason text,
  p_at timestamptz default clock_timestamp()
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_reservation_status not in ('released', 'expired') then
    raise exception 'AGRIMARKET_INVALID_RELEASE_STATUS' using errcode = 'P0001';
  end if;

  perform 1
  from public.agrimarket_inventory_reservations r
  where r.order_id = p_order_id
    and r.status = 'active'
  for update;

  with release_qty as (
    select r.product_id, sum(r.quantity)::numeric as qty
    from public.agrimarket_inventory_reservations r
    where r.order_id = p_order_id
      and r.status = 'active'
    group by r.product_id
  )
  update public.agrimarket_products p
  set reserved_qty = greatest(p.reserved_qty - release_qty.qty, 0),
      updated_at = p_at
  from release_qty
  where p.id = release_qty.product_id;

  update public.agrimarket_inventory_reservations r
  set status = p_reservation_status,
      released_at = p_at,
      release_reason = nullif(trim(coalesce(p_reason, '')), ''),
      updated_at = p_at
  where r.order_id = p_order_id
    and r.status = 'active';
end;
$$;

create or replace function public.agrimarket_create_reserved_order_v1(
  p_customer_user_id uuid,
  p_delivery_address_id uuid,
  p_items jsonb,
  p_delivery_fee numeric,
  p_handling_fee numeric
)
returns table(
  order_id uuid,
  order_code text,
  status text,
  producer_confirmation_deadline timestamptz,
  product_subtotal numeric,
  delivery_fee numeric,
  handling_fee numeric,
  total_amount numeric,
  preparation_minutes integer,
  requested_vehicle_type text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_order_id uuid := gen_random_uuid();
  v_order_code text;
  v_address public.passenger_addresses%rowtype;
  v_producer_id uuid;
  v_producer_count integer;
  v_item_count integer;
  v_distinct_item_count integer;
  v_matched_count integer;
  v_subtotal numeric(12,2);
  v_prep_minutes integer;
  v_vehicle text;
  v_weight numeric(12,3);
  v_all_kg boolean;
  v_pickup_label text;
  v_pickup_lat numeric;
  v_pickup_lng numeric;
  v_bad text;
  v_row record;
begin
  if p_customer_user_id is null then
    raise exception 'AGRIMARKET_CUSTOMER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_delivery_address_id is null then
    raise exception 'AGRIMARKET_DELIVERY_ADDRESS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'AGRIMARKET_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_delivery_fee is null or p_delivery_fee < 0 then
    raise exception 'AGRIMARKET_INVALID_DELIVERY_FEE' using errcode = 'P0001';
  end if;

  if p_handling_fee is null or p_handling_fee not in (0, 10, 20, 30, 40, 50) then
    raise exception 'AGRIMARKET_INVALID_HANDLING_FEE' using errcode = 'P0001';
  end if;

  select a.*
  into v_address
  from public.passenger_addresses a
  where a.id = p_delivery_address_id
    and a.created_by_user_id = p_customer_user_id
    and a.is_active = true
  limit 1;

  if v_address.id is null then
    raise exception 'AGRIMARKET_DELIVERY_ADDRESS_NOT_OWNED' using errcode = 'P0001';
  end if;

  if v_address.lat is null or v_address.lng is null then
    raise exception 'AGRIMARKET_DELIVERY_PIN_REQUIRED' using errcode = 'P0001';
  end if;

  select count(*), count(distinct x.product_id)
  into v_item_count, v_distinct_item_count
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric);

  if v_item_count <> jsonb_array_length(p_items) or v_distinct_item_count <> v_item_count then
    raise exception 'AGRIMARKET_DUPLICATE_OR_INVALID_ITEMS' using errcode = 'P0001';
  end if;

  for v_row in
    select p.id
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
    join public.agrimarket_products p on p.id = x.product_id
    order by p.id
    for update of p
  loop
    null;
  end loop;

  select count(*), count(distinct p.producer_id), min(p.producer_id),
         round(sum(p.price_per_unit * x.quantity), 2),
         max(p.preparation_minutes),
         case
           when bool_or(p.preferred_vehicle = 'Tricycle') then 'Tricycle'
           when bool_and(p.preferred_vehicle = 'Motorcycle') then 'Motorcycle'
           else 'either'
         end,
         bool_and(p.unit = 'kg'),
         case when bool_and(p.unit = 'kg') then sum(x.quantity) else null end
  into v_matched_count, v_producer_count, v_producer_id,
       v_subtotal, v_prep_minutes, v_vehicle, v_all_kg, v_weight
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  if v_matched_count <> v_item_count then
    raise exception 'AGRIMARKET_PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_producer_count <> 1 then
    raise exception 'AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED' using errcode = 'P0001';
  end if;

  select p.pickup_label, p.pickup_lat, p.pickup_lng
  into v_pickup_label, v_pickup_lat, v_pickup_lng
  from public.agrimarket_producers p
  where p.id = v_producer_id
    and p.is_active = true
    and p.can_accept_orders = true
    and (p.paused_until is null or p.paused_until <= v_now)
  for update;

  if v_pickup_label is null then
    raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select string_agg(p.product_code, ', ' order by p.product_code)
  into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id
  where p.is_active is distinct from true
     or x.quantity is null
     or x.quantity <= 0
     or x.quantity < p.minimum_order_qty
     or mod(x.quantity - p.minimum_order_qty, p.quantity_step) <> 0
     or p.available_qty < x.quantity;

  if v_bad is not null then
    raise exception 'AGRIMARKET_ITEM_UNAVAILABLE: %', v_bad using errcode = 'P0001';
  end if;

  select string_agg(p.product_code, ', ' order by p.product_code)
  into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id
  where p.availability_type = 'scheduled_harvest';

  if v_bad is not null then
    raise exception 'AGRIMARKET_SCHEDULED_HARVEST_POLICY_NOT_CONFIGURED: %', v_bad using errcode = 'P0001';
  end if;

  v_order_code := 'AG-' || to_char(v_now at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
                  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.agrimarket_orders(
    id, order_code, customer_user_id, passenger_id, delivery_address_id,
    producer_id, status, producer_confirmation_deadline,
    preparation_minutes, product_subtotal, delivery_fee, handling_fee,
    requested_vehicle_type, estimated_cargo_weight_kg,
    pickup_label, pickup_lat, pickup_lng,
    delivery_label, delivery_lat, delivery_lng,
    reserve_expires_at, created_at, updated_at
  ) values (
    v_order_id, v_order_code, p_customer_user_id, p_customer_user_id, p_delivery_address_id,
    v_producer_id, 'pending_producer_confirmation', v_now + interval '5 minutes',
    coalesce(v_prep_minutes, 0), v_subtotal, round(p_delivery_fee, 2), p_handling_fee,
    v_vehicle, v_weight,
    v_pickup_label, v_pickup_lat, v_pickup_lng,
    v_address.address_text, v_address.lat, v_address.lng,
    v_now + interval '5 minutes', v_now, v_now
  );

  insert into public.agrimarket_order_items(
    order_id, product_id, product_name, category, unit,
    unit_price, quantity, species, cut_name, requires_live_pickup_check, created_at
  )
  select v_order_id, p.id, p.product_name, p.category, p.unit,
         p.price_per_unit, x.quantity, p.species, p.cut_name,
         p.requires_live_pickup_check, v_now
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  insert into public.agrimarket_inventory_reservations(
    order_id, product_id, quantity, status, expires_at, created_at, updated_at
  )
  select v_order_id, p.id, x.quantity, 'active', v_now + interval '5 minutes', v_now, v_now
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  with reserved as (
    select x.product_id, x.quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  )
  update public.agrimarket_products p
  set reserved_qty = p.reserved_qty + reserved.quantity,
      updated_at = v_now
  from reserved
  where p.id = reserved.product_id;

  insert into public.agrimarket_handling_fee_events(
    order_id, event_type, fee_amount, reason, actor_type, actor_id, created_at
  ) values (
    v_order_id, 'initial_quote', p_handling_fee,
    'Server-supplied Agrimarket handling quote', 'system', null, v_now
  );

  insert into public.agrimarket_order_events(
    order_id, from_status, to_status, actor_type, actor_id, reason_code, metadata, created_at
  ) values (
    v_order_id, null, 'pending_producer_confirmation', 'system', null,
    'inventory_reserved',
    jsonb_build_object(
      'producer_confirmation_seconds', 300,
      'delivery_fee', round(p_delivery_fee, 2),
      'handling_fee', p_handling_fee
    ),
    v_now
  );

  return query
  select o.id, o.order_code, o.status, o.producer_confirmation_deadline,
         o.product_subtotal, o.delivery_fee, o.handling_fee, o.total_amount,
         o.preparation_minutes, o.requested_vehicle_type
  from public.agrimarket_orders o
  where o.id = v_order_id;
end;
$$;

create or replace function public.agrimarket_producer_decide_order_v1(
  p_order_code text,
  p_vendor_account_id uuid,
  p_decision text,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns table(
  order_id uuid,
  order_code text,
  status text,
  producer_confirmed_at timestamptz,
  producer_rejected_at timestamptz,
  preparation_due_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_vendor_ok boolean := false;
begin
  if trim(coalesce(p_order_code, '')) = '' or p_vendor_account_id is null then
    raise exception 'AGRIMARKET_PRODUCER_AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  if v_decision not in ('accept', 'reject') then
    raise exception 'AGRIMARKET_INVALID_PRODUCER_DECISION' using errcode = 'P0001';
  end if;

  select o.*
  into v_order
  from public.agrimarket_orders o
  where o.order_code = trim(p_order_code)
  for update;

  if v_order.id is null then
    raise exception 'AGRIMARKET_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;

  select exists(
    select 1
    from public.agrimarket_producers p
    where p.id = v_order.producer_id
      and p.vendor_account_id = p_vendor_account_id
      and p.is_active = true
  ) into v_vendor_ok;

  if not v_vendor_ok then
    raise exception 'AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER' using errcode = 'P0001';
  end if;

  if v_order.status <> 'pending_producer_confirmation' then
    return query
    select o.id, o.order_code, o.status, o.producer_confirmed_at,
           o.producer_rejected_at, o.preparation_due_at
    from public.agrimarket_orders o
    where o.id = v_order.id;
    return;
  end if;

  if v_order.producer_confirmation_deadline <= p_now then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id, 'expired', 'Producer confirmation timed out after 5 minutes', p_now
    );

    update public.agrimarket_orders o
    set status = 'producer_timeout',
        updated_at = p_now
    where o.id = v_order.id;

    insert into public.agrimarket_order_events(
      order_id, from_status, to_status, actor_type, actor_id, reason_code, metadata, created_at
    ) values (
      v_order.id, 'pending_producer_confirmation', 'producer_timeout', 'system', null,
      'producer_confirmation_timeout', '{}'::jsonb, p_now
    );
  elsif v_decision = 'reject' then
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id, 'released', coalesce(nullif(trim(p_reason), ''), 'Producer rejected order'), p_now
    );

    update public.agrimarket_orders o
    set status = 'producer_rejected',
        producer_rejected_at = p_now,
        producer_rejection_reason = nullif(trim(coalesce(p_reason, '')), ''),
        updated_at = p_now
    where o.id = v_order.id;

    insert into public.agrimarket_order_events(
      order_id, from_status, to_status, actor_type, actor_id, reason_code, metadata, created_at
    ) values (
      v_order.id, 'pending_producer_confirmation', 'producer_rejected', 'producer',
      p_vendor_account_id::text, 'producer_rejected',
      jsonb_build_object('reason', nullif(trim(coalesce(p_reason, '')), '')), p_now
    );
  else
    update public.agrimarket_inventory_reservations r
    set expires_at = null,
        updated_at = p_now
    where r.order_id = v_order.id
      and r.status = 'active';

    update public.agrimarket_orders o
    set status = 'producer_confirmed',
        producer_confirmed_at = p_now,
        preparation_due_at = p_now + make_interval(mins => greatest(o.preparation_minutes, 0)),
        dispatch_after = p_now + make_interval(mins => greatest(o.preparation_minutes, 0)),
        reserve_expires_at = null,
        updated_at = p_now
    where o.id = v_order.id;

    insert into public.agrimarket_order_events(
      order_id, from_status, to_status, actor_type, actor_id, reason_code, metadata, created_at
    ) values (
      v_order.id, 'pending_producer_confirmation', 'producer_confirmed', 'producer',
      p_vendor_account_id::text, 'producer_accepted',
      jsonb_build_object('preparation_minutes', v_order.preparation_minutes), p_now
    );
  end if;

  return query
  select o.id, o.order_code, o.status, o.producer_confirmed_at,
         o.producer_rejected_at, o.preparation_due_at
  from public.agrimarket_orders o
  where o.id = v_order.id;
end;
$$;

create or replace function public.agrimarket_expire_pending_orders_v1(
  p_now timestamptz default clock_timestamp(),
  p_limit integer default 200
)
returns table(
  order_id uuid,
  order_code text,
  expired_at timestamptz
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order record;
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
begin
  for v_order in
    select o.id, o.order_code
    from public.agrimarket_orders o
    where o.status = 'pending_producer_confirmation'
      and o.producer_confirmation_deadline <= p_now
    order by o.producer_confirmation_deadline, o.id
    limit v_limit
    for update skip locked
  loop
    perform public.agrimarket_release_active_reservations_v1(
      v_order.id, 'expired', 'Producer confirmation timed out after 5 minutes', p_now
    );

    update public.agrimarket_orders o
    set status = 'producer_timeout',
        updated_at = p_now
    where o.id = v_order.id
      and o.status = 'pending_producer_confirmation';

    if found then
      insert into public.agrimarket_order_events(
        order_id, from_status, to_status, actor_type, actor_id, reason_code, metadata, created_at
      ) values (
        v_order.id, 'pending_producer_confirmation', 'producer_timeout', 'system', null,
        'producer_confirmation_timeout', '{}'::jsonb, p_now
      );

      order_id := v_order.id;
      order_code := v_order.order_code;
      expired_at := p_now;
      return next;
    end if;
  end loop;
end;
$$;

revoke all on function public.agrimarket_release_active_reservations_v1(uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agrimarket_create_reserved_order_v1(uuid, uuid, jsonb, numeric, numeric) from public, anon, authenticated;
revoke all on function public.agrimarket_producer_decide_order_v1(text, uuid, text, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agrimarket_expire_pending_orders_v1(timestamptz, integer) from public, anon, authenticated;

grant execute on function public.agrimarket_release_active_reservations_v1(uuid, text, text, timestamptz) to service_role;
grant execute on function public.agrimarket_create_reserved_order_v1(uuid, uuid, jsonb, numeric, numeric) to service_role;
grant execute on function public.agrimarket_producer_decide_order_v1(text, uuid, text, text, timestamptz) to service_role;
grant execute on function public.agrimarket_expire_pending_orders_v1(timestamptz, integer) to service_role;
