alter table public.agrimarket_pricing_settings
  add column cash_first_threshold numeric(12,2) not null default 500,
  add constraint agrimarket_pricing_cash_first_threshold_chk check (cash_first_threshold >= 0);

alter table public.agrimarket_orders
  add column cash_collection_required boolean not null default false,
  add column cash_collection_amount numeric(12,2) not null default 0,
  add column route_plan text not null default 'farmer_first',
  add column assignment_anchor text not null default 'farmer',
  add column farmer_to_customer_distance_km numeric(10,3),
  add column farmer_to_customer_duration_seconds integer,
  add column customer_to_farmer_distance_km numeric(10,3),
  add column customer_to_farmer_duration_seconds integer,
  add column driver_to_first_pickup_km numeric(10,3),
  add column pickup_distance_fee numeric(12,2) not null default 0,
  add column pickup_fee_locked_at timestamptz;

alter table public.agrimarket_orders
  add constraint agrimarket_orders_cash_collection_chk check (cash_collection_amount >= 0),
  add constraint agrimarket_orders_route_plan_chk check (route_plan in ('farmer_first','customer_cash_first')),
  add constraint agrimarket_orders_assignment_anchor_chk check (assignment_anchor in ('farmer','customer')),
  add constraint agrimarket_orders_leg_distance_chk check (
    (farmer_to_customer_distance_km is null or farmer_to_customer_distance_km >= 0)
    and (customer_to_farmer_distance_km is null or customer_to_farmer_distance_km >= 0)
    and (driver_to_first_pickup_km is null or driver_to_first_pickup_km >= 0)
  ),
  add constraint agrimarket_orders_leg_duration_chk check (
    (farmer_to_customer_duration_seconds is null or farmer_to_customer_duration_seconds >= 0)
    and (customer_to_farmer_duration_seconds is null or customer_to_farmer_duration_seconds >= 0)
  ),
  add constraint agrimarket_orders_pickup_fee_chk check (pickup_distance_fee >= 0);

alter table public.agrimarket_orders drop column total_payable;
alter table public.agrimarket_orders drop column driver_delivery_payout;

alter table public.agrimarket_orders
  add column total_payable numeric(12,2)
    generated always as (product_subtotal + delivery_fee + pickup_distance_fee + handling_fee) stored,
  add column driver_delivery_payout numeric(12,2)
    generated always as (
      greatest(delivery_fee + pickup_distance_fee - delivery_company_cut, 0::numeric) + handling_fee
    ) stored;

create table public.agrimarket_driver_offers (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  driver_id uuid not null references public.drivers(id) on delete restrict,
  offer_rank integer not null,
  status text not null default 'offered',
  assignment_anchor text not null,
  pickup_road_distance_km numeric(10,3) not null,
  pickup_distance_fee numeric(12,2) not null default 0,
  estimated_seconds_to_first_pickup integer,
  estimated_seconds_to_farmer integer,
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  reason_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_driver_offers_order_driver_uidx unique(order_id, driver_id),
  constraint agrimarket_driver_offers_rank_chk check (offer_rank >= 1),
  constraint agrimarket_driver_offers_status_chk check (status in ('offered','accepted','declined','expired','cancelled')),
  constraint agrimarket_driver_offers_anchor_chk check (assignment_anchor in ('farmer','customer')),
  constraint agrimarket_driver_offers_distance_chk check (pickup_road_distance_km >= 0),
  constraint agrimarket_driver_offers_fee_chk check (pickup_distance_fee >= 0),
  constraint agrimarket_driver_offers_seconds_chk check (
    (estimated_seconds_to_first_pickup is null or estimated_seconds_to_first_pickup >= 0)
    and (estimated_seconds_to_farmer is null or estimated_seconds_to_farmer >= 0)
  )
);

create index agrimarket_driver_offers_order_status_idx
  on public.agrimarket_driver_offers(order_id, status, expires_at);
create index agrimarket_driver_offers_driver_status_idx
  on public.agrimarket_driver_offers(driver_id, status, expires_at);

alter table public.agrimarket_driver_offers enable row level security;
revoke all on table public.agrimarket_driver_offers from public, anon, authenticated;
grant all privileges on table public.agrimarket_driver_offers to service_role;

create or replace function public.agrimarket_create_reserved_order_v3(
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
  producer_confirm_expires_at timestamptz,
  product_subtotal numeric,
  cash_collection_required boolean,
  cash_collection_amount numeric,
  route_plan text,
  assignment_anchor text,
  delivery_base_fee numeric,
  delivery_distance_fee numeric,
  delivery_fee numeric,
  pickup_distance_fee numeric,
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
  v_threshold numeric(12,2);
  v_pre_subtotal numeric(12,2);
  v_pre_cash_first boolean;
  v_actual_cash_first boolean;
  v_service_distance numeric(10,3);
  v_service_duration integer;
  v_created record;
begin
  select s.cash_first_threshold
  into v_threshold
  from public.agrimarket_pricing_settings s
  where s.id = 1 and s.is_active = true;

  if v_threshold is null then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  if p_farmer_to_customer_distance_km is null or p_farmer_to_customer_distance_km < 0
     or p_farmer_to_customer_duration_seconds is null or p_farmer_to_customer_duration_seconds < 0 then
    raise exception 'AGRIMARKET_FARMER_CUSTOMER_ROUTE_REQUIRED' using errcode = 'P0001';
  end if;

  select round(sum(p.unit_price * x.quantity), 2)
  into v_pre_subtotal
  from jsonb_to_recordset(p_items) as x(product_id uuid, quantity numeric)
  join public.agrimarket_products p on p.id = x.product_id;

  v_pre_cash_first := coalesce(v_pre_subtotal, 0) > v_threshold;

  if v_pre_cash_first then
    if p_customer_to_farmer_distance_km is null or p_customer_to_farmer_distance_km < 0
       or p_customer_to_farmer_duration_seconds is null or p_customer_to_farmer_duration_seconds < 0 then
      raise exception 'AGRIMARKET_CUSTOMER_FARMER_ROUTE_REQUIRED' using errcode = 'P0001';
    end if;
    v_service_distance := round(p_customer_to_farmer_distance_km + p_farmer_to_customer_distance_km, 3);
    v_service_duration := p_customer_to_farmer_duration_seconds + p_farmer_to_customer_duration_seconds;
  else
    v_service_distance := round(p_farmer_to_customer_distance_km, 3);
    v_service_duration := p_farmer_to_customer_duration_seconds;
  end if;

  select * into v_created
  from public.agrimarket_create_reserved_order_v2(
    p_customer_user_id,
    p_client_request_id,
    p_delivery_address_id,
    p_items,
    v_service_distance,
    v_service_duration,
    p_preferred_vehicle_type,
    p_route_provider
  );

  v_actual_cash_first := coalesce(v_created.product_subtotal, 0) > v_threshold;
  if v_actual_cash_first is distinct from v_pre_cash_first then
    raise exception 'AGRIMARKET_ROUTE_PLAN_PRICE_CHANGED_RETRY' using errcode = 'P0001';
  end if;

  update public.agrimarket_orders o
  set cash_collection_required = v_actual_cash_first,
      cash_collection_amount = case when v_actual_cash_first then o.product_subtotal else 0 end,
      route_plan = case when v_actual_cash_first then 'customer_cash_first' else 'farmer_first' end,
      assignment_anchor = case when v_actual_cash_first then 'customer' else 'farmer' end,
      farmer_to_customer_distance_km = round(p_farmer_to_customer_distance_km, 3),
      farmer_to_customer_duration_seconds = p_farmer_to_customer_duration_seconds,
      customer_to_farmer_distance_km = case when v_actual_cash_first then round(p_customer_to_farmer_distance_km, 3) else null end,
      customer_to_farmer_duration_seconds = case when v_actual_cash_first then p_customer_to_farmer_duration_seconds else null end,
      pricing_snapshot = o.pricing_snapshot || jsonb_build_object(
        'cash_first_threshold', v_threshold,
        'cash_collection_required', v_actual_cash_first,
        'route_plan', case when v_actual_cash_first then 'customer_cash_first' else 'farmer_first' end,
        'assignment_anchor', case when v_actual_cash_first then 'customer' else 'farmer' end,
        'farmer_to_customer_distance_km', round(p_farmer_to_customer_distance_km, 3),
        'customer_to_farmer_distance_km', case when v_actual_cash_first then round(p_customer_to_farmer_distance_km, 3) else null end,
        'pickup_distance_fee_rule', 'shared_jride_first_1_5km_free'
      ),
      updated_at = clock_timestamp()
  where o.id = v_created.order_id;

  return query
  select o.id, o.order_code, o.status, o.producer_confirm_expires_at,
         o.product_subtotal, o.cash_collection_required, o.cash_collection_amount,
         o.route_plan, o.assignment_anchor,
         o.delivery_base_fee, o.delivery_distance_fee, o.delivery_fee,
         o.pickup_distance_fee, o.marketplace_fee, o.producer_product_net,
         o.handling_fee, o.total_payable, o.delivery_company_cut,
         o.driver_delivery_payout, o.route_distance_km, o.route_duration_seconds,
         o.preparation_minutes, o.preferred_vehicle_type, o.required_vehicle_type,
         o.pricing_version
  from public.agrimarket_orders o
  where o.id = v_created.order_id;
end;
$$;

create or replace function public.agrimarket_producer_decide_order_v2(
  p_order_code text,
  p_vendor_account_id uuid,
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
security invoker
set search_path = public
as $$
declare
  v_order_id uuid;
  v_owner_ok boolean;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_result record;
begin
  select o.id,
         exists(
           select 1 from public.agrimarket_producers p
           where p.id = o.producer_id
             and p.vendor_account_id = p_vendor_account_id
             and p.status = 'active'
         )
  into v_order_id, v_owner_ok
  from public.agrimarket_orders o
  where o.order_code = trim(coalesce(p_order_code, ''))
  limit 1;

  if v_order_id is null then
    raise exception 'AGRIMARKET_ORDER_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not coalesce(v_owner_ok, false) then
    raise exception 'AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER' using errcode = 'P0001';
  end if;

  if v_decision = 'accept' then
    if p_preparation_minutes is null or p_preparation_minutes < 0 or p_preparation_minutes > 1440 then
      raise exception 'AGRIMARKET_PREPARATION_MINUTES_REQUIRED' using errcode = 'P0001';
    end if;
    update public.agrimarket_orders
    set preparation_minutes = p_preparation_minutes,
        updated_at = p_now
    where id = v_order_id;
  end if;

  select * into v_result
  from public.agrimarket_producer_decide_order_v1(
    p_order_code, p_vendor_account_id, v_decision, p_reason, p_now
  );

  if v_decision = 'accept' and v_result.status = 'producer_accepted' then
    update public.agrimarket_orders
    set status = 'preparing',
        ready_at = p_now + make_interval(mins => p_preparation_minutes),
        updated_at = p_now
    where id = v_order_id;
  end if;

  return query
  select o.id, o.order_code, o.status, o.producer_responded_at,
         o.producer_accepted_at, o.producer_rejected_at, o.producer_timeout_at,
         o.preparation_minutes, o.ready_at
  from public.agrimarket_orders o
  where o.id = v_order_id;
end;
$$;

create or replace function public.agrimarket_driver_decide_offer_v1(
  p_offer_id uuid,
  p_driver_id uuid,
  p_decision text,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_offer public.agrimarket_driver_offers%rowtype;
  v_order public.agrimarket_orders%rowtype;
  v_decision text := lower(trim(coalesce(p_decision, '')));
  v_vehicle_raw text;
  v_vehicle text;
begin
  if v_decision not in ('accept','decline') then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_INVALID_DRIVER_DECISION');
  end if;

  select * into v_offer
  from public.agrimarket_driver_offers
  where id = p_offer_id and driver_id = p_driver_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_DRIVER_OFFER_NOT_FOUND');
  end if;

  if v_offer.status <> 'offered' then
    return jsonb_build_object('ok', true, 'already_resolved', true, 'status', v_offer.status, 'order_id', v_offer.order_id);
  end if;

  if v_offer.expires_at <= p_now then
    update public.agrimarket_driver_offers
    set status='expired', responded_at=p_now, updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_DRIVER_OFFER_EXPIRED', 'order_id', v_offer.order_id);
  end if;

  if v_decision = 'decline' then
    update public.agrimarket_driver_offers
    set status='declined', responded_at=p_now, reason_code=nullif(trim(coalesce(p_reason,'')),''), updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok', true, 'accepted', false, 'order_id', v_offer.order_id);
  end if;

  select * into v_order
  from public.agrimarket_orders
  where id=v_offer.order_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_ORDER_NOT_FOUND');
  end if;
  if v_order.assigned_driver_id is not null then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_ORDER_ALREADY_ASSIGNED');
  end if;
  if v_order.status not in ('dispatching','preparing','ready_for_dispatch') then
    return jsonb_build_object('ok', false, 'error', 'AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE', 'status', v_order.status);
  end if;

  select lower(trim(coalesce(dl.vehicle_type,'')))
  into v_vehicle_raw
  from public.driver_locations dl
  where dl.driver_id=p_driver_id
  order by dl.updated_at desc
  limit 1;

  if v_vehicle_raw like '%motor%' or v_vehicle_raw like '%moto%' or v_vehicle_raw like '%bike%' then
    v_vehicle := 'motorcycle';
  elsif v_vehicle_raw like '%trike%' or v_vehicle_raw like '%tricycle%' or v_vehicle_raw like '%toda%' then
    v_vehicle := 'tricycle';
  else
    v_vehicle := v_vehicle_raw;
  end if;

  update public.agrimarket_driver_offers
  set status='accepted', responded_at=p_now, updated_at=p_now
  where id=v_offer.id;

  update public.agrimarket_orders
  set assigned_driver_id=p_driver_id,
      selected_vehicle_type=v_vehicle,
      driver_to_first_pickup_km=v_offer.pickup_road_distance_km,
      pickup_distance_fee=v_offer.pickup_distance_fee,
      pickup_fee_locked_at=p_now,
      status='driver_assigned',
      updated_at=p_now
  where id=v_order.id;

  return jsonb_build_object(
    'ok', true,
    'accepted', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'driver_id', p_driver_id,
    'pickup_road_distance_km', v_offer.pickup_road_distance_km,
    'pickup_distance_fee', v_offer.pickup_distance_fee,
    'route_plan', v_order.route_plan,
    'cash_collection_required', v_order.cash_collection_required,
    'cash_collection_amount', v_order.cash_collection_amount
  );
end;
$$;

revoke all on function public.agrimarket_create_reserved_order_v2(uuid, uuid, uuid, jsonb, numeric, integer, text, text) from service_role;
revoke all on function public.agrimarket_create_reserved_order_v3(uuid, uuid, uuid, jsonb, numeric, integer, numeric, integer, text, text) from public, anon, authenticated;
revoke all on function public.agrimarket_producer_decide_order_v1(text, uuid, text, text, timestamptz) from service_role;
revoke all on function public.agrimarket_producer_decide_order_v2(text, uuid, text, integer, text, timestamptz) from public, anon, authenticated;
revoke all on function public.agrimarket_driver_decide_offer_v1(uuid, uuid, text, text, timestamptz) from public, anon, authenticated;

grant execute on function public.agrimarket_create_reserved_order_v3(uuid, uuid, uuid, jsonb, numeric, integer, numeric, integer, text, text) to service_role;
grant execute on function public.agrimarket_producer_decide_order_v2(text, uuid, text, integer, text, timestamptz) to service_role;
grant execute on function public.agrimarket_driver_decide_offer_v1(uuid, uuid, text, text, timestamptz) to service_role;
