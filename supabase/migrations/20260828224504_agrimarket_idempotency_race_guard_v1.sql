create or replace function public.agrimarket_create_reserved_order_v2(
  p_customer_user_id uuid,
  p_client_request_id uuid,
  p_delivery_address_id uuid,
  p_items jsonb,
  p_route_distance_km numeric,
  p_route_duration_seconds integer,
  p_preferred_vehicle_type text,
  p_route_provider text default 'mapbox_driving'
)
returns table(
  order_id uuid,
  order_code text,
  status text,
  producer_confirm_expires_at timestamptz,
  product_subtotal numeric,
  delivery_base_fee numeric,
  delivery_distance_fee numeric,
  delivery_fee numeric,
  marketplace_fee numeric,
  producer_product_net numeric,
  handling_fee numeric,
  total_payable numeric,
  delivery_company_cut numeric,
  driver_delivery_payout numeric,
  route_distance_km numeric,
  route_duration_seconds integer,
  preparation_minutes integer,
  preferred_vehicle_type text,
  required_vehicle_type text,
  pricing_version integer
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
  v_producer public.agrimarket_producers%rowtype;
  v_producer_id uuid;
  v_producer_count integer;
  v_item_count integer;
  v_distinct_item_count integer;
  v_matched_count integer;
  v_subtotal numeric(12,2);
  v_marketplace_fee numeric(12,2);
  v_prep_minutes integer;
  v_required_vehicle text;
  v_preferred_vehicle text := lower(trim(coalesce(p_preferred_vehicle_type, '')));
  v_bad text;
  v_row record;
  v_quote record;
  v_existing_id uuid;
begin
  if p_customer_user_id is null then
    raise exception 'AGRIMARKET_CUSTOMER_REQUIRED' using errcode = 'P0001';
  end if;

  if p_client_request_id is null then
    raise exception 'AGRIMARKET_CLIENT_REQUEST_ID_REQUIRED' using errcode = 'P0001';
  end if;

  select o.id
  into v_existing_id
  from public.agrimarket_orders o
  where o.customer_user_id = p_customer_user_id
    and o.client_request_id = p_client_request_id
  limit 1;

  if v_existing_id is not null then
    return query
    select o.id, o.order_code, o.status, o.producer_confirm_expires_at,
           o.product_subtotal, o.delivery_base_fee, o.delivery_distance_fee,
           o.delivery_fee, o.marketplace_fee, o.producer_product_net,
           o.handling_fee, o.total_payable, o.delivery_company_cut,
           o.driver_delivery_payout, o.route_distance_km, o.route_duration_seconds,
           o.preparation_minutes, o.preferred_vehicle_type,
           o.required_vehicle_type, o.pricing_version
    from public.agrimarket_orders o
    where o.id = v_existing_id;
    return;
  end if;

  if p_delivery_address_id is null then
    raise exception 'AGRIMARKET_DELIVERY_ADDRESS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'AGRIMARKET_ITEMS_REQUIRED' using errcode = 'P0001';
  end if;

  if p_route_distance_km is null or p_route_distance_km < 0 then
    raise exception 'AGRIMARKET_ROUTE_DISTANCE_REQUIRED' using errcode = 'P0001';
  end if;

  if p_route_duration_seconds is null or p_route_duration_seconds < 0 then
    raise exception 'AGRIMARKET_ROUTE_DURATION_REQUIRED' using errcode = 'P0001';
  end if;

  if p_route_provider <> 'mapbox_driving' then
    raise exception 'AGRIMARKET_ROUTE_PROVIDER_INVALID' using errcode = 'P0001';
  end if;

  if v_preferred_vehicle not in ('motorcycle', 'tricycle') then
    raise exception 'AGRIMARKET_INVALID_PREFERRED_VEHICLE' using errcode = 'P0001';
  end if;

  select * into v_quote
  from public.agrimarket_quote_delivery_v1(p_route_distance_km);

  select a.* into v_address
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

  select o.id
  into v_existing_id
  from public.agrimarket_orders o
  where o.customer_user_id = p_customer_user_id
    and o.client_request_id = p_client_request_id
  limit 1;

  if v_existing_id is not null then
    return query
    select o.id, o.order_code, o.status, o.producer_confirm_expires_at,
           o.product_subtotal, o.delivery_base_fee, o.delivery_distance_fee,
           o.delivery_fee, o.marketplace_fee, o.producer_product_net,
           o.handling_fee, o.total_payable, o.delivery_company_cut,
           o.driver_delivery_payout, o.route_distance_km, o.route_duration_seconds,
           o.preparation_minutes, o.preferred_vehicle_type,
           o.required_vehicle_type, o.pricing_version
    from public.agrimarket_orders o
    where o.id = v_existing_id;
    return;
  end if;

  select count(*), count(distinct p.producer_id), min(p.producer_id::text)::uuid,
         round(sum(p.unit_price * x.quantity), 2), max(p.default_prep_minutes),
         case
           when bool_or(p.vehicle_requirement = 'tricycle') then 'tricycle'
           when bool_and(p.vehicle_requirement = 'motorcycle') then 'motorcycle'
           else 'either'
         end
  into v_matched_count, v_producer_count, v_producer_id,
       v_subtotal, v_prep_minutes, v_required_vehicle
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  if v_matched_count <> v_item_count then
    raise exception 'AGRIMARKET_PRODUCT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_producer_count <> 1 then
    raise exception 'AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED' using errcode = 'P0001';
  end if;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id = v_producer_id
  for update;

  if v_producer.id is null or v_producer.status <> 'active' or v_producer.accepting_orders is distinct from true then
    raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE' using errcode = 'P0001';
  end if;

  select string_agg(p.name, ', ' order by p.name) into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id
  where p.is_active is distinct from true
     or x.quantity is null
     or x.quantity <= 0
     or p.remaining_quantity < x.quantity;

  if v_bad is not null then
    raise exception 'AGRIMARKET_ITEM_UNAVAILABLE: %', v_bad using errcode = 'P0001';
  end if;

  select string_agg(p.name, ', ' order by p.name) into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id
  where p.availability_mode = 'scheduled_harvest';

  if v_bad is not null then
    raise exception 'AGRIMARKET_SCHEDULED_HARVEST_POLICY_NOT_CONFIGURED: %', v_bad using errcode = 'P0001';
  end if;

  if v_required_vehicle <> 'either' and v_preferred_vehicle <> v_required_vehicle then
    raise exception 'AGRIMARKET_VEHICLE_REQUIREMENT_MISMATCH' using errcode = 'P0001';
  end if;

  v_marketplace_fee := round(v_subtotal * coalesce(v_producer.marketplace_fee_percent, 0) / 100, 2);
  v_order_code := 'AG-' || to_char(v_now at time zone 'Asia/Manila', 'YYYYMMDD') || '-' ||
                  upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.agrimarket_orders(
    id, order_code, customer_user_id, client_request_id, delivery_address_id,
    delivery_label, delivery_lat, delivery_lng,
    producer_id, status, producer_confirm_expires_at,
    preparation_minutes, preferred_vehicle_type, required_vehicle_type,
    route_distance_km, route_duration_seconds, route_provider,
    product_subtotal, marketplace_fee, handling_fee, handling_reason,
    pricing_version, delivery_base_fee, delivery_distance_fee,
    delivery_rate_per_km, delivery_fee, delivery_company_cut,
    pricing_snapshot, created_at, updated_at
  ) values (
    v_order_id, v_order_code, p_customer_user_id, p_client_request_id, p_delivery_address_id,
    v_address.address_text, v_address.lat, v_address.lng,
    v_producer_id, 'awaiting_producer', v_now + interval '5 minutes',
    coalesce(v_prep_minutes, 0), v_preferred_vehicle, v_required_vehicle,
    round(p_route_distance_km, 3), p_route_duration_seconds, p_route_provider,
    v_subtotal, v_marketplace_fee, 0, null,
    v_quote.pricing_version, v_quote.base_delivery_fee, v_quote.route_distance_fee,
    v_quote.route_fee_per_km, v_quote.delivery_fee, v_quote.delivery_company_cut,
    jsonb_build_object(
      'pricing_version', v_quote.pricing_version,
      'currency', v_quote.currency,
      'base_delivery_fee', v_quote.base_delivery_fee,
      'route_fee_per_km', v_quote.route_fee_per_km,
      'route_distance_km', v_quote.route_distance_km,
      'route_distance_fee', v_quote.route_distance_fee,
      'delivery_fee', v_quote.delivery_fee,
      'delivery_company_cut', v_quote.delivery_company_cut,
      'route_provider', p_route_provider,
      'marketplace_fee_percent', coalesce(v_producer.marketplace_fee_percent, 0)
    ), v_now, v_now
  );

  insert into public.agrimarket_order_items(
    order_id, product_id, product_name, product_group,
    species, breed, meat_cut, processing_form,
    condition_required, cargo_class, selling_unit,
    unit_price, quantity, handling_eligible, created_at
  )
  select v_order_id, p.id, p.name, p.product_group,
         p.species, p.breed, p.meat_cut, p.processing_form,
         p.condition, p.cargo_class, p.selling_unit,
         p.unit_price, x.quantity, p.handling_eligible, v_now
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  insert into public.agrimarket_inventory_reservations(
    order_id, order_item_id, product_id, quantity, status, expires_at, created_at
  )
  select v_order_id, oi.id, oi.product_id, oi.quantity,
         'active', v_now + interval '5 minutes', v_now
  from public.agrimarket_order_items oi
  where oi.order_id = v_order_id;

  with reserved as (
    select x.product_id, x.quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  )
  update public.agrimarket_products p
  set reserved_quantity = p.reserved_quantity + reserved.quantity,
      updated_at = v_now
  from reserved
  where p.id = reserved.product_id;

  insert into public.agrimarket_order_events(
    order_id, from_status, to_status, actor_type, actor_id, reason_code, details, created_at
  ) values (
    v_order_id, null, 'awaiting_producer', 'system', null, 'inventory_reserved',
    jsonb_build_object(
      'producer_confirmation_seconds', 300,
      'pricing_version', v_quote.pricing_version,
      'delivery_fee', v_quote.delivery_fee,
      'marketplace_fee', v_marketplace_fee,
      'handling_fee', 0,
      'route_distance_km', round(p_route_distance_km, 3),
      'route_duration_seconds', p_route_duration_seconds,
      'route_provider', p_route_provider,
      'client_request_id', p_client_request_id
    ), v_now
  );

  return query
  select o.id, o.order_code, o.status, o.producer_confirm_expires_at,
         o.product_subtotal, o.delivery_base_fee, o.delivery_distance_fee,
         o.delivery_fee, o.marketplace_fee, o.producer_product_net,
         o.handling_fee, o.total_payable, o.delivery_company_cut,
         o.driver_delivery_payout, o.route_distance_km, o.route_duration_seconds,
         o.preparation_minutes, o.preferred_vehicle_type,
         o.required_vehicle_type, o.pricing_version
  from public.agrimarket_orders o
  where o.id = v_order_id;
end;
$$;
