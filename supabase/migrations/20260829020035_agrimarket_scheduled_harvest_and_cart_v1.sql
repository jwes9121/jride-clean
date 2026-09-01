alter table public.agrimarket_products
  add column harvest_order_cutoff_at timestamptz;

alter table public.agrimarket_products
  add constraint agrimarket_products_harvest_cutoff_required_chk
    check (availability_mode = 'always_available' or harvest_order_cutoff_at is not null),
  add constraint agrimarket_products_harvest_cutoff_before_start_chk
    check (harvest_order_cutoff_at is null or harvest_start_at is null or harvest_order_cutoff_at <= harvest_start_at);

alter table public.agrimarket_orders
  add column fulfillment_mode text not null default 'always_available',
  add column harvest_expected_start_at timestamptz,
  add column harvest_expected_end_at timestamptz,
  add column harvest_ready_at timestamptz;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_fulfillment_mode_chk
    check (fulfillment_mode in ('always_available','scheduled_harvest')),
  add constraint agrimarket_orders_harvest_window_chk
    check (fulfillment_mode = 'always_available' or harvest_expected_start_at is not null),
  add constraint agrimarket_orders_harvest_end_chk
    check (harvest_expected_end_at is null or harvest_expected_start_at is null or harvest_expected_end_at >= harvest_expected_start_at);

alter table public.agrimarket_order_items
  add column availability_mode text not null default 'always_available',
  add column harvest_start_at timestamptz,
  add column harvest_end_at timestamptz,
  add column harvest_order_cutoff_at timestamptz;

alter table public.agrimarket_order_items
  add constraint agrimarket_order_items_availability_mode_chk
    check (availability_mode in ('always_available','scheduled_harvest')),
  add constraint agrimarket_order_items_harvest_window_chk
    check (availability_mode = 'always_available' or harvest_start_at is not null),
  add constraint agrimarket_order_items_harvest_end_chk
    check (harvest_end_at is null or harvest_start_at is null or harvest_end_at >= harvest_start_at);

create table public.agrimarket_harvest_proposals (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  proposal_type text not null,
  status text not null default 'pending_customer',
  proposed_items jsonb not null default '[]'::jsonb,
  proposed_harvest_start_at timestamptz,
  proposed_harvest_end_at timestamptz,
  producer_reason text,
  proposed_by_producer_id uuid not null references public.agrimarket_producers(id) on delete restrict,
  proposed_at timestamptz not null default now(),
  customer_response text,
  customer_responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_harvest_proposals_type_chk check (proposal_type in ('quantity_shortfall','delay')),
  constraint agrimarket_harvest_proposals_status_chk check (status in ('pending_customer','accepted','rejected','cancelled')),
  constraint agrimarket_harvest_proposals_items_chk check (jsonb_typeof(proposed_items) = 'array'),
  constraint agrimarket_harvest_proposals_response_chk check (customer_response is null or customer_response in ('accept','reject')),
  constraint agrimarket_harvest_proposals_window_chk check (proposed_harvest_end_at is null or proposed_harvest_start_at is null or proposed_harvest_end_at >= proposed_harvest_start_at)
);

create unique index agrimarket_harvest_proposals_one_pending_idx
  on public.agrimarket_harvest_proposals(order_id)
  where status = 'pending_customer';

create index agrimarket_harvest_proposals_order_idx
  on public.agrimarket_harvest_proposals(order_id, proposed_at desc);

create index agrimarket_orders_harvest_scan_idx
  on public.agrimarket_orders(status, harvest_expected_start_at)
  where fulfillment_mode = 'scheduled_harvest';

alter table public.agrimarket_harvest_proposals enable row level security;
revoke all on table public.agrimarket_harvest_proposals from public, anon, authenticated;
grant all privileges on table public.agrimarket_harvest_proposals to service_role;

create or replace function public.agrimarket_reprice_after_harvest_adjustment_v1(
  p_order_id uuid,
  p_now timestamptz default clock_timestamp()
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_subtotal numeric(12,2);
  v_threshold numeric(12,2);
  v_cash_first boolean;
  v_required_vehicle text;
  v_service_distance numeric(10,3);
  v_service_duration integer;
  v_quote record;
begin
  select o.* into v_order
  from public.agrimarket_orders o
  where o.id = p_order_id
  for update;

  if v_order.id is null then
    raise exception 'AGRIMARKET_ORDER_NOT_FOUND' using errcode='P0001';
  end if;

  select round(coalesce(sum(oi.line_total),0),2),
         case when bool_or(p.vehicle_requirement='tricycle') then 'tricycle' else 'either' end
  into v_subtotal, v_required_vehicle
  from public.agrimarket_order_items oi
  left join public.agrimarket_products p on p.id = oi.product_id
  where oi.order_id = p_order_id;

  if v_subtotal <= 0 then
    raise exception 'AGRIMARKET_ORDER_HAS_NO_ACTIVE_ITEMS' using errcode='P0001';
  end if;

  select s.cash_first_threshold
  into v_threshold
  from public.agrimarket_pricing_settings s
  where s.id=1 and s.is_active=true;

  if v_threshold is null then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode='P0001';
  end if;

  v_cash_first := v_subtotal > v_threshold;

  if v_order.farmer_to_customer_distance_km is null
     or v_order.farmer_to_customer_duration_seconds is null then
    raise exception 'AGRIMARKET_FARMER_CUSTOMER_ROUTE_REQUIRED' using errcode='P0001';
  end if;

  if v_cash_first then
    if v_order.customer_to_farmer_distance_km is null
       or v_order.customer_to_farmer_duration_seconds is null then
      raise exception 'AGRIMARKET_CUSTOMER_FARMER_ROUTE_REQUIRED' using errcode='P0001';
    end if;
    v_service_distance := round(v_order.customer_to_farmer_distance_km + v_order.farmer_to_customer_distance_km,3);
    v_service_duration := v_order.customer_to_farmer_duration_seconds + v_order.farmer_to_customer_duration_seconds;
  else
    v_service_distance := round(v_order.farmer_to_customer_distance_km,3);
    v_service_duration := v_order.farmer_to_customer_duration_seconds;
  end if;

  select * into v_quote
  from public.agrimarket_quote_delivery_v1(v_service_distance);

  update public.agrimarket_orders o
  set product_subtotal = v_subtotal,
      marketplace_fee = 0,
      cash_collection_required = v_cash_first,
      cash_collection_amount = case when v_cash_first then v_subtotal else 0 end,
      route_plan = case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
      assignment_anchor = case when v_cash_first then 'customer' else 'farmer' end,
      route_distance_km = v_service_distance,
      route_duration_seconds = v_service_duration,
      delivery_base_fee = v_quote.base_delivery_fee,
      delivery_distance_fee = v_quote.route_distance_fee,
      delivery_rate_per_km = v_quote.route_fee_per_km,
      delivery_fee = v_quote.delivery_fee,
      delivery_company_cut = v_quote.delivery_company_cut,
      required_vehicle_type = coalesce(v_required_vehicle,'either'),
      pricing_snapshot = o.pricing_snapshot || jsonb_build_object(
        'harvest_adjustment_repriced_at', p_now,
        'product_subtotal', v_subtotal,
        'cash_collection_required', v_cash_first,
        'route_plan', case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
        'route_distance_km', v_service_distance,
        'delivery_fee', v_quote.delivery_fee
      ),
      updated_at = p_now
  where o.id = p_order_id;
end;
$$;

create or replace function public.agrimarket_create_reserved_order_v4(
  p_customer_user_id uuid,
  p_client_request_id uuid,
  p_delivery_address_id uuid,
  p_items jsonb,
  p_farmer_to_customer_distance_km numeric,
  p_farmer_to_customer_duration_seconds integer,
  p_customer_to_farmer_distance_km numeric,
  p_customer_to_farmer_duration_seconds integer,
  p_preferred_vehicle_type text,
  p_route_provider text default 'mapbox_driving'
)
returns table(
  order_id uuid,
  order_code text,
  status text,
  fulfillment_mode text,
  harvest_expected_start_at timestamptz,
  harvest_expected_end_at timestamptz,
  producer_confirm_expires_at timestamptz,
  product_subtotal numeric,
  cash_collection_required boolean,
  cash_collection_amount numeric,
  route_plan text,
  assignment_anchor text,
  delivery_fee numeric,
  total_payable numeric,
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
  v_existing_id uuid;
  v_address public.passenger_addresses%rowtype;
  v_producer public.agrimarket_producers%rowtype;
  v_producer_id uuid;
  v_product_count integer;
  v_input_count integer;
  v_distinct_input_count integer;
  v_producer_count integer;
  v_mode_count integer;
  v_mode text;
  v_subtotal numeric(12,2);
  v_threshold numeric(12,2);
  v_cash_first boolean;
  v_required_vehicle text;
  v_preferred_vehicle text := lower(trim(coalesce(p_preferred_vehicle_type,'')));
  v_service_distance numeric(10,3);
  v_service_duration integer;
  v_quote record;
  v_bad text;
  v_harvest_start timestamptz;
  v_harvest_end timestamptz;
  v_harvest_start_count integer;
  v_harvest_end_count integer;
  v_cutoff timestamptz;
  v_all_cutoffs_present boolean;
  v_row record;
begin
  if p_customer_user_id is null or p_client_request_id is null then
    raise exception 'AGRIMARKET_CUSTOMER_AND_REQUEST_REQUIRED' using errcode='P0001';
  end if;
  if p_delivery_address_id is null then
    raise exception 'AGRIMARKET_DELIVERY_ADDRESS_REQUIRED' using errcode='P0001';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'AGRIMARKET_ITEMS_REQUIRED' using errcode='P0001';
  end if;
  if v_preferred_vehicle not in ('motorcycle','tricycle') then
    raise exception 'AGRIMARKET_INVALID_PREFERRED_VEHICLE' using errcode='P0001';
  end if;
  if p_route_provider <> 'mapbox_driving' then
    raise exception 'AGRIMARKET_ROUTE_PROVIDER_INVALID' using errcode='P0001';
  end if;
  if p_farmer_to_customer_distance_km is null or p_farmer_to_customer_distance_km < 0
     or p_farmer_to_customer_duration_seconds is null or p_farmer_to_customer_duration_seconds < 0 then
    raise exception 'AGRIMARKET_FARMER_CUSTOMER_ROUTE_REQUIRED' using errcode='P0001';
  end if;

  select o.id into v_existing_id
  from public.agrimarket_orders o
  where o.customer_user_id=p_customer_user_id and o.client_request_id=p_client_request_id
  limit 1;

  if v_existing_id is not null then
    return query
    select o.id,o.order_code,o.status,o.fulfillment_mode,o.harvest_expected_start_at,o.harvest_expected_end_at,
           o.producer_confirm_expires_at,o.product_subtotal,o.cash_collection_required,o.cash_collection_amount,
           o.route_plan,o.assignment_anchor,o.delivery_fee,o.total_payable,o.preferred_vehicle_type,
           o.required_vehicle_type,o.pricing_version
    from public.agrimarket_orders o where o.id=v_existing_id;
    return;
  end if;

  select a.* into v_address
  from public.passenger_addresses a
  where a.id=p_delivery_address_id
    and a.created_by_user_id=p_customer_user_id
    and a.is_active=true
  limit 1;

  if v_address.id is null then
    raise exception 'AGRIMARKET_DELIVERY_ADDRESS_NOT_OWNED' using errcode='P0001';
  end if;
  if v_address.lat is null or v_address.lng is null then
    raise exception 'AGRIMARKET_DELIVERY_PIN_REQUIRED' using errcode='P0001';
  end if;

  select count(*),count(distinct x.product_id)
  into v_input_count,v_distinct_input_count
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric);
  if v_input_count <> jsonb_array_length(p_items) or v_input_count <> v_distinct_input_count then
    raise exception 'AGRIMARKET_DUPLICATE_OR_INVALID_ITEMS' using errcode='P0001';
  end if;

  for v_row in
    select p.id
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
    join public.agrimarket_products p on p.id=x.product_id
    order by p.id
    for update of p
  loop null; end loop;

  select o.id into v_existing_id
  from public.agrimarket_orders o
  where o.customer_user_id=p_customer_user_id and o.client_request_id=p_client_request_id
  limit 1;
  if v_existing_id is not null then
    return query
    select o.id,o.order_code,o.status,o.fulfillment_mode,o.harvest_expected_start_at,o.harvest_expected_end_at,
           o.producer_confirm_expires_at,o.product_subtotal,o.cash_collection_required,o.cash_collection_amount,
           o.route_plan,o.assignment_anchor,o.delivery_fee,o.total_payable,o.preferred_vehicle_type,
           o.required_vehicle_type,o.pricing_version
    from public.agrimarket_orders o where o.id=v_existing_id;
    return;
  end if;

  select count(*),count(distinct p.producer_id),min(p.producer_id::text)::uuid,
         count(distinct p.availability_mode),min(p.availability_mode),
         round(sum(p.unit_price*x.quantity),2),
         case when bool_or(p.vehicle_requirement='tricycle') then 'tricycle' else 'either' end,
         min(p.harvest_start_at),min(p.harvest_end_at),
         count(distinct p.harvest_start_at),count(distinct coalesce(p.harvest_end_at,p.harvest_start_at)),
         min(p.harvest_order_cutoff_at),bool_and(p.harvest_order_cutoff_at is not null)
  into v_product_count,v_producer_count,v_producer_id,
       v_mode_count,v_mode,v_subtotal,v_required_vehicle,
       v_harvest_start,v_harvest_end,v_harvest_start_count,v_harvest_end_count,
       v_cutoff,v_all_cutoffs_present
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  join public.agrimarket_products p on p.id=x.product_id;

  if v_product_count <> v_input_count then
    raise exception 'AGRIMARKET_PRODUCT_NOT_FOUND' using errcode='P0001';
  end if;
  if v_producer_count <> 1 then
    raise exception 'AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED' using errcode='P0001';
  end if;
  if v_mode_count <> 1 then
    raise exception 'AGRIMARKET_MIXED_AVAILABILITY_CART_NOT_ALLOWED' using errcode='P0001';
  end if;

  select p.* into v_producer
  from public.agrimarket_producers p
  where p.id=v_producer_id
  for update;
  if v_producer.id is null or v_producer.status <> 'active' or v_producer.accepting_orders is distinct from true then
    raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE' using errcode='P0001';
  end if;

  select string_agg(p.name,', ' order by p.name) into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  join public.agrimarket_products p on p.id=x.product_id
  where p.is_active is distinct from true
     or x.quantity is null or x.quantity <= 0
     or p.remaining_quantity < x.quantity;
  if v_bad is not null then
    raise exception 'AGRIMARKET_ITEM_UNAVAILABLE: %',v_bad using errcode='P0001';
  end if;

  if v_mode='scheduled_harvest' then
    if v_harvest_start_count <> 1 or v_harvest_end_count <> 1 then
      raise exception 'AGRIMARKET_SCHEDULED_ITEMS_REQUIRE_SAME_HARVEST_WINDOW' using errcode='P0001';
    end if;
    if not coalesce(v_all_cutoffs_present,false) or v_cutoff < v_now then
      raise exception 'AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED' using errcode='P0001';
    end if;
  end if;

  if v_required_vehicle='tricycle' and v_preferred_vehicle <> 'tricycle' then
    raise exception 'AGRIMARKET_VEHICLE_REQUIREMENT_MISMATCH' using errcode='P0001';
  end if;

  select s.cash_first_threshold into v_threshold
  from public.agrimarket_pricing_settings s
  where s.id=1 and s.is_active=true;
  if v_threshold is null then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode='P0001';
  end if;

  v_cash_first := v_subtotal > v_threshold;
  if v_cash_first then
    if p_customer_to_farmer_distance_km is null or p_customer_to_farmer_distance_km < 0
       or p_customer_to_farmer_duration_seconds is null or p_customer_to_farmer_duration_seconds < 0 then
      raise exception 'AGRIMARKET_CUSTOMER_FARMER_ROUTE_REQUIRED' using errcode='P0001';
    end if;
    v_service_distance := round(p_customer_to_farmer_distance_km+p_farmer_to_customer_distance_km,3);
    v_service_duration := p_customer_to_farmer_duration_seconds+p_farmer_to_customer_duration_seconds;
  else
    v_service_distance := round(p_farmer_to_customer_distance_km,3);
    v_service_duration := p_farmer_to_customer_duration_seconds;
  end if;

  select * into v_quote
  from public.agrimarket_quote_delivery_v1(v_service_distance);

  v_order_code := 'AG-' || to_char(v_now at time zone 'Asia/Manila','YYYYMMDD') || '-' ||
                  upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

  insert into public.agrimarket_orders(
    id,order_code,customer_user_id,client_request_id,delivery_address_id,
    delivery_label,delivery_lat,delivery_lng,producer_id,status,producer_confirm_expires_at,
    fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,
    preferred_vehicle_type,required_vehicle_type,
    farmer_to_customer_distance_km,farmer_to_customer_duration_seconds,
    customer_to_farmer_distance_km,customer_to_farmer_duration_seconds,
    route_distance_km,route_duration_seconds,route_provider,
    product_subtotal,marketplace_fee,handling_fee,
    cash_collection_required,cash_collection_amount,route_plan,assignment_anchor,
    pricing_version,delivery_base_fee,delivery_distance_fee,delivery_rate_per_km,delivery_fee,delivery_company_cut,
    pricing_snapshot,created_at,updated_at
  ) values (
    v_order_id,v_order_code,p_customer_user_id,p_client_request_id,p_delivery_address_id,
    v_address.address_text,v_address.lat,v_address.lng,v_producer_id,'awaiting_producer',v_now+interval '5 minutes',
    v_mode,case when v_mode='scheduled_harvest' then v_harvest_start else null end,
    case when v_mode='scheduled_harvest' then v_harvest_end else null end,
    v_preferred_vehicle,v_required_vehicle,
    round(p_farmer_to_customer_distance_km,3),p_farmer_to_customer_duration_seconds,
    case when v_cash_first then round(p_customer_to_farmer_distance_km,3) else null end,
    case when v_cash_first then p_customer_to_farmer_duration_seconds else null end,
    v_service_distance,v_service_duration,p_route_provider,
    v_subtotal,0,0,
    v_cash_first,case when v_cash_first then v_subtotal else 0 end,
    case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
    case when v_cash_first then 'customer' else 'farmer' end,
    v_quote.pricing_version,v_quote.base_delivery_fee,v_quote.route_distance_fee,v_quote.route_fee_per_km,
    v_quote.delivery_fee,v_quote.delivery_company_cut,
    jsonb_build_object(
      'pricing_version',v_quote.pricing_version,
      'cash_first_threshold',v_threshold,
      'fulfillment_mode',v_mode,
      'harvest_expected_start_at',case when v_mode='scheduled_harvest' then v_harvest_start else null end,
      'harvest_expected_end_at',case when v_mode='scheduled_harvest' then v_harvest_end else null end,
      'route_plan',case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
      'route_distance_km',v_service_distance,
      'delivery_fee',v_quote.delivery_fee,
      'marketplace_fee_percent',0
    ),v_now,v_now
  );

  insert into public.agrimarket_order_items(
    order_id,product_id,product_name,product_group,species,breed,meat_cut,processing_form,
    condition_required,cargo_class,selling_unit,unit_price,quantity,handling_eligible,
    availability_mode,harvest_start_at,harvest_end_at,harvest_order_cutoff_at,created_at
  )
  select v_order_id,p.id,p.name,p.product_group,p.species,p.breed,p.meat_cut,p.processing_form,
         p.condition,p.cargo_class,p.selling_unit,p.unit_price,x.quantity,p.handling_eligible,
         p.availability_mode,p.harvest_start_at,p.harvest_end_at,p.harvest_order_cutoff_at,v_now
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  join public.agrimarket_products p on p.id=x.product_id;

  insert into public.agrimarket_inventory_reservations(order_id,order_item_id,product_id,quantity,status,expires_at,created_at)
  select v_order_id,oi.id,oi.product_id,oi.quantity,'active',v_now+interval '5 minutes',v_now
  from public.agrimarket_order_items oi where oi.order_id=v_order_id;

  with r as (
    select x.product_id,x.quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  )
  update public.agrimarket_products p
  set reserved_quantity=p.reserved_quantity+r.quantity,updated_at=v_now
  from r where p.id=r.product_id;

  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
  values(v_order_id,null,'awaiting_producer','system',null,'inventory_reserved',
         jsonb_build_object('fulfillment_mode',v_mode,'producer_confirmation_seconds',300,
                            'harvest_expected_start_at',case when v_mode='scheduled_harvest' then v_harvest_start else null end,
                            'harvest_expected_end_at',case when v_mode='scheduled_harvest' then v_harvest_end else null end),v_now);

  return query
  select o.id,o.order_code,o.status,o.fulfillment_mode,o.harvest_expected_start_at,o.harvest_expected_end_at,
         o.producer_confirm_expires_at,o.product_subtotal,o.cash_collection_required,o.cash_collection_amount,
         o.route_plan,o.assignment_anchor,o.delivery_fee,o.total_payable,o.preferred_vehicle_type,o.required_vehicle_type,o.pricing_version
  from public.agrimarket_orders o where o.id=v_order_id;
end;
$$;

create or replace function public.agrimarket_producer_decide_order_v4(
  p_order_code text,
  p_producer_id uuid,
  p_decision text,
  p_preparation_minutes integer default null,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
begin
  if trim(coalesce(p_order_code,''))='' or p_producer_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PRODUCER_AUTH_REQUIRED');
  end if;
  if v_decision not in ('accept','reject') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_PRODUCER_DECISION');
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(p_order_code)
  for update;

  if v_order.id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND');
  end if;
  if v_order.producer_id <> p_producer_id or not exists(
    select 1 from public.agrimarket_producers p where p.id=p_producer_id and p.status='active'
  ) then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER');
  end if;
  if v_order.status <> 'awaiting_producer' then
    return jsonb_build_object('ok',true,'already_done',true,'order_code',v_order.order_code,'status',v_order.status,
                              'fulfillment_mode',v_order.fulfillment_mode,'ready_at',v_order.ready_at);
  end if;

  if v_order.producer_confirm_expires_at <= p_now then
    perform public.agrimarket_release_active_reservations_v1(v_order.id,'expired','Producer confirmation timed out after 5 minutes',p_now);
    update public.agrimarket_orders
    set status='producer_timeout',producer_responded_at=p_now,producer_timeout_at=p_now,updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','producer_timeout','system',null,'producer_confirmation_timeout','{}'::jsonb,p_now);
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PRODUCER_CONFIRMATION_TIMEOUT','status','producer_timeout');
  end if;

  if v_decision='reject' then
    perform public.agrimarket_release_active_reservations_v1(v_order.id,'released',coalesce(nullif(trim(p_reason),''),'Producer rejected order'),p_now);
    update public.agrimarket_orders
    set status='producer_rejected',producer_responded_at=p_now,producer_rejected_at=p_now,
        cancel_reason=nullif(trim(coalesce(p_reason,'')),''),updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','producer_rejected','producer',p_producer_id,'producer_rejected',
           jsonb_build_object('reason',nullif(trim(coalesce(p_reason,'')),'')),p_now);
    return jsonb_build_object('ok',true,'order_code',v_order.order_code,'status','producer_rejected');
  end if;

  update public.agrimarket_inventory_reservations
  set expires_at=null
  where order_id=v_order.id and status='active';

  if v_order.fulfillment_mode='scheduled_harvest' then
    update public.agrimarket_orders
    set status='awaiting_harvest',producer_responded_at=p_now,producer_accepted_at=p_now,
        preparation_minutes=null,ready_at=null,updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_producer','awaiting_harvest','producer',p_producer_id,'scheduled_harvest_reservation_accepted',
           jsonb_build_object('harvest_expected_start_at',v_order.harvest_expected_start_at,
                              'harvest_expected_end_at',v_order.harvest_expected_end_at),p_now);
    return jsonb_build_object('ok',true,'order_code',v_order.order_code,'status','awaiting_harvest',
                              'fulfillment_mode','scheduled_harvest','harvest_expected_start_at',v_order.harvest_expected_start_at,
                              'harvest_expected_end_at',v_order.harvest_expected_end_at);
  end if;

  if p_preparation_minutes is null or p_preparation_minutes < 0 or p_preparation_minutes > 1440 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PREPARATION_MINUTES_REQUIRED');
  end if;

  update public.agrimarket_orders
  set status='preparing',producer_responded_at=p_now,producer_accepted_at=p_now,
      preparation_minutes=p_preparation_minutes,ready_at=p_now+make_interval(mins=>p_preparation_minutes),updated_at=p_now
  where id=v_order.id;
  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
  values(v_order.id,'awaiting_producer','preparing','producer',p_producer_id,'producer_accepted',
         jsonb_build_object('preparation_minutes',p_preparation_minutes),p_now);
  return jsonb_build_object('ok',true,'order_code',v_order.order_code,'status','preparing',
                            'fulfillment_mode','always_available','preparation_minutes',p_preparation_minutes,
                            'ready_at',p_now+make_interval(mins=>p_preparation_minutes));
end;
$$;

create or replace function public.agrimarket_producer_harvest_action_v1(
  p_order_code text,
  p_producer_id uuid,
  p_action text,
  p_preparation_minutes integer default null,
  p_proposed_start_at timestamptz default null,
  p_proposed_end_at timestamptz default null,
  p_proposed_items jsonb default '[]'::jsonb,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order public.agrimarket_orders%rowtype;
  v_action text := lower(trim(coalesce(p_action,'')));
  v_proposal_id uuid;
  v_input_count integer;
  v_distinct_count integer;
  v_item_count integer;
  v_invalid_count integer;
  v_lower_count integer;
  v_positive_sum numeric;
  v_normalized jsonb;
begin
  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(coalesce(p_order_code,''))
  for update;

  if v_order.id is null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.producer_id <> p_producer_id then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER'); end if;
  if v_order.fulfillment_mode <> 'scheduled_harvest' then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_SCHEDULED_HARVEST'); end if;
  if v_order.status <> 'awaiting_harvest' then return jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_ACTION_WRONG_STATUS','status',v_order.status); end if;
  if exists(select 1 from public.agrimarket_harvest_proposals hp where hp.order_id=v_order.id and hp.status='pending_customer') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_PROPOSAL_ALREADY_PENDING');
  end if;

  if v_action='ready' then
    if p_preparation_minutes is null or p_preparation_minutes < 0 or p_preparation_minutes > 1440 then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_PREPARATION_MINUTES_REQUIRED');
    end if;
    update public.agrimarket_orders
    set harvest_ready_at=p_now,preparation_minutes=p_preparation_minutes,
        ready_at=p_now+make_interval(mins=>p_preparation_minutes),status='preparing',updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_harvest','preparing','producer',p_producer_id,'harvest_ready',
           jsonb_build_object('preparation_minutes',p_preparation_minutes),p_now);
    return jsonb_build_object('ok',true,'status','preparing','harvest_ready_at',p_now,
                              'ready_at',p_now+make_interval(mins=>p_preparation_minutes));
  elsif v_action='delay' then
    if p_proposed_start_at is null or p_proposed_start_at <= p_now then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_VALID_DELAY_DATE_REQUIRED');
    end if;
    if p_proposed_end_at is not null and p_proposed_end_at < p_proposed_start_at then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_DELAY_WINDOW');
    end if;
    insert into public.agrimarket_harvest_proposals(
      order_id,proposal_type,status,proposed_items,proposed_harvest_start_at,proposed_harvest_end_at,
      producer_reason,proposed_by_producer_id,proposed_at,created_at,updated_at
    ) values (
      v_order.id,'delay','pending_customer','[]'::jsonb,p_proposed_start_at,p_proposed_end_at,
      nullif(trim(coalesce(p_reason,'')),''),p_producer_id,p_now,p_now,p_now
    ) returning id into v_proposal_id;
  elsif v_action='shortfall' then
    if p_proposed_items is null or jsonb_typeof(p_proposed_items) <> 'array' or jsonb_array_length(p_proposed_items)=0 then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_SHORTFALL_ITEMS_REQUIRED');
    end if;
    select count(*),count(distinct x.product_id)
    into v_input_count,v_distinct_count
    from jsonb_to_recordset(p_proposed_items) as x(product_id uuid,quantity numeric);
    select count(*) into v_item_count from public.agrimarket_order_items oi where oi.order_id=v_order.id;
    if v_input_count <> v_item_count or v_distinct_count <> v_input_count then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_SHORTFALL_MUST_COVER_ALL_ITEMS');
    end if;

    select count(*),count(*) filter(where x.quantity < oi.quantity),coalesce(sum(x.quantity),0),
           jsonb_agg(jsonb_build_object(
             'order_item_id',oi.id,'product_id',oi.product_id,'product_name',oi.product_name,
             'selling_unit',oi.selling_unit,'original_quantity',oi.quantity,'proposed_quantity',x.quantity
           ) order by oi.created_at)
    into v_invalid_count,v_lower_count,v_positive_sum,v_normalized
    from public.agrimarket_order_items oi
    join jsonb_to_recordset(p_proposed_items) as x(product_id uuid,quantity numeric)
      on x.product_id=oi.product_id
    where oi.order_id=v_order.id
      and (x.quantity is null or x.quantity < 0 or x.quantity > oi.quantity);

    if v_invalid_count > 0 then return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_SHORTFALL_QUANTITY'); end if;

    select count(*) filter(where x.quantity < oi.quantity),coalesce(sum(x.quantity),0),
           jsonb_agg(jsonb_build_object(
             'order_item_id',oi.id,'product_id',oi.product_id,'product_name',oi.product_name,
             'selling_unit',oi.selling_unit,'original_quantity',oi.quantity,'proposed_quantity',x.quantity
           ) order by oi.created_at)
    into v_lower_count,v_positive_sum,v_normalized
    from public.agrimarket_order_items oi
    join jsonb_to_recordset(p_proposed_items) as x(product_id uuid,quantity numeric)
      on x.product_id=oi.product_id
    where oi.order_id=v_order.id;

    if v_lower_count=0 then return jsonb_build_object('ok',false,'error','AGRIMARKET_SHORTFALL_MUST_REDUCE_QUANTITY'); end if;
    if v_positive_sum <= 0 then return jsonb_build_object('ok',false,'error','AGRIMARKET_SHORTFALL_CANNOT_ZERO_ENTIRE_ORDER'); end if;

    insert into public.agrimarket_harvest_proposals(
      order_id,proposal_type,status,proposed_items,producer_reason,proposed_by_producer_id,proposed_at,created_at,updated_at
    ) values (
      v_order.id,'quantity_shortfall','pending_customer',coalesce(v_normalized,'[]'::jsonb),
      nullif(trim(coalesce(p_reason,'')),''),p_producer_id,p_now,p_now,p_now
    ) returning id into v_proposal_id;
  else
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_HARVEST_ACTION');
  end if;

  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
  values(v_order.id,'awaiting_harvest','awaiting_harvest','producer',p_producer_id,
         case when v_action='delay' then 'harvest_delay_proposed' else 'harvest_shortfall_proposed' end,
         jsonb_build_object('proposal_id',v_proposal_id,'reason',nullif(trim(coalesce(p_reason,'')),'')),p_now);

  return jsonb_build_object('ok',true,'status','awaiting_harvest','proposal_id',v_proposal_id,
                            'proposal_type',case when v_action='delay' then 'delay' else 'quantity_shortfall' end,
                            'customer_response_required',true);
end;
$$;

create or replace function public.agrimarket_customer_respond_harvest_v1(
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
  v_proposal public.agrimarket_harvest_proposals%rowtype;
  v_response text := lower(trim(coalesce(p_response,'')));
begin
  if v_response not in ('accept','reject') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_HARVEST_RESPONSE');
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(coalesce(p_order_code,'')) and o.customer_user_id=p_customer_user_id
  for update;
  if v_order.id is null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.fulfillment_mode <> 'scheduled_harvest' or v_order.status <> 'awaiting_harvest' then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_HARVEST_RESPONSE_WRONG_STATUS','status',v_order.status);
  end if;

  select hp.* into v_proposal
  from public.agrimarket_harvest_proposals hp
  where hp.order_id=v_order.id and hp.status='pending_customer'
  order by hp.proposed_at desc
  limit 1
  for update;
  if v_proposal.id is null then return jsonb_build_object('ok',false,'error','AGRIMARKET_NO_PENDING_HARVEST_PROPOSAL'); end if;

  if v_response='reject' then
    perform public.agrimarket_release_active_reservations_v1(v_order.id,'released','Customer rejected harvest change',p_now);
    update public.agrimarket_harvest_proposals
    set status='rejected',customer_response='reject',customer_responded_at=p_now,updated_at=p_now
    where id=v_proposal.id;
    update public.agrimarket_orders
    set status='cancelled',cancelled_at=p_now,cancel_reason='customer_rejected_harvest_change',updated_at=p_now
    where id=v_order.id;
    insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
    values(v_order.id,'awaiting_harvest','cancelled','customer',p_customer_user_id,'harvest_change_rejected',
           jsonb_build_object('proposal_id',v_proposal.id,'proposal_type',v_proposal.proposal_type),p_now);
    return jsonb_build_object('ok',true,'status','cancelled','proposal_status','rejected');
  end if;

  if v_proposal.proposal_type='delay' then
    update public.agrimarket_orders
    set harvest_expected_start_at=v_proposal.proposed_harvest_start_at,
        harvest_expected_end_at=v_proposal.proposed_harvest_end_at,updated_at=p_now
    where id=v_order.id;
    update public.agrimarket_order_items
    set harvest_start_at=v_proposal.proposed_harvest_start_at,
        harvest_end_at=v_proposal.proposed_harvest_end_at
    where order_id=v_order.id and availability_mode='scheduled_harvest';
  else
    with proposed as (
      select (x->>'order_item_id')::uuid as order_item_id,
             (x->>'proposed_quantity')::numeric as proposed_quantity
      from jsonb_array_elements(v_proposal.proposed_items) x
    ), deltas as (
      select oi.id as order_item_id,oi.product_id,oi.quantity as old_quantity,p.proposed_quantity,
             oi.quantity-p.proposed_quantity as release_quantity
      from public.agrimarket_order_items oi
      join proposed p on p.order_item_id=oi.id
      where oi.order_id=v_order.id
    ), release_by_product as (
      select product_id,sum(release_quantity)::numeric as qty
      from deltas where release_quantity > 0 group by product_id
    )
    update public.agrimarket_products ap
    set reserved_quantity=greatest(ap.reserved_quantity-rbp.qty,0),updated_at=p_now
    from release_by_product rbp
    where ap.id=rbp.product_id;

    with proposed as (
      select (x->>'order_item_id')::uuid as order_item_id,
             (x->>'proposed_quantity')::numeric as proposed_quantity
      from jsonb_array_elements(v_proposal.proposed_items) x
    )
    update public.agrimarket_inventory_reservations r
    set quantity=p.proposed_quantity
    from proposed p
    where r.order_id=v_order.id and r.order_item_id=p.order_item_id
      and r.status='active' and p.proposed_quantity > 0;

    with proposed as (
      select (x->>'order_item_id')::uuid as order_item_id,
             (x->>'proposed_quantity')::numeric as proposed_quantity
      from jsonb_array_elements(v_proposal.proposed_items) x
    )
    update public.agrimarket_order_items oi
    set quantity=p.proposed_quantity
    from proposed p
    where oi.order_id=v_order.id and oi.id=p.order_item_id and p.proposed_quantity > 0;

    with proposed as (
      select (x->>'order_item_id')::uuid as order_item_id,
             (x->>'proposed_quantity')::numeric as proposed_quantity
      from jsonb_array_elements(v_proposal.proposed_items) x
    )
    delete from public.agrimarket_order_items oi
    using proposed p
    where oi.order_id=v_order.id and oi.id=p.order_item_id and p.proposed_quantity=0;

    perform public.agrimarket_reprice_after_harvest_adjustment_v1(v_order.id,p_now);
  end if;

  update public.agrimarket_harvest_proposals
  set status='accepted',customer_response='accept',customer_responded_at=p_now,updated_at=p_now
  where id=v_proposal.id;

  insert into public.agrimarket_order_events(order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at)
  values(v_order.id,'awaiting_harvest','awaiting_harvest','customer',p_customer_user_id,'harvest_change_accepted',
         jsonb_build_object('proposal_id',v_proposal.id,'proposal_type',v_proposal.proposal_type),p_now);

  return jsonb_build_object('ok',true,'status','awaiting_harvest','proposal_status','accepted',
                            'proposal_type',v_proposal.proposal_type);
end;
$$;

revoke all on function public.agrimarket_reprice_after_harvest_adjustment_v1(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_create_reserved_order_v4(uuid,uuid,uuid,jsonb,numeric,integer,numeric,integer,text,text) from public,anon,authenticated;
revoke all on function public.agrimarket_producer_decide_order_v4(text,uuid,text,integer,text,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_producer_harvest_action_v1(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_customer_respond_harvest_v1(text,uuid,text,timestamptz) from public,anon,authenticated;

grant execute on function public.agrimarket_reprice_after_harvest_adjustment_v1(uuid,timestamptz) to service_role;
grant execute on function public.agrimarket_create_reserved_order_v4(uuid,uuid,uuid,jsonb,numeric,integer,numeric,integer,text,text) to service_role;
grant execute on function public.agrimarket_producer_decide_order_v4(text,uuid,text,integer,text,timestamptz) to service_role;
grant execute on function public.agrimarket_producer_harvest_action_v1(text,uuid,text,integer,timestamptz,timestamptz,jsonb,text,timestamptz) to service_role;
grant execute on function public.agrimarket_customer_respond_harvest_v1(text,uuid,text,timestamptz) to service_role;
