-- Structural fixture from the current production definitions; no production rows.
create role anon; create role authenticated; create role service_role;
create table public.agrimarket_driver_offers (
  offered_at timestamp with time zone default now(),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  id uuid default gen_random_uuid(),
  status text default 'offered'::text,
  pickup_distance_fee numeric(12,2) default 0,
  order_id uuid,
  estimated_seconds_to_farmer integer,
  expires_at timestamp with time zone,
  responded_at timestamp with time zone,
  assignment_anchor text,
  pickup_road_distance_km numeric(10,3),
  estimated_seconds_to_first_pickup integer,
  reason_code text,
  driver_id uuid,
  offer_rank integer
);
create table public.agrimarket_orders (
  id uuid default gen_random_uuid(),
  status text default 'awaiting_producer'::text,
  producer_confirm_expires_at timestamp with time zone default (now() + '00:05:00'::interval),
  required_vehicle_type text default 'either'::text,
  product_subtotal numeric(12,2) default 0,
  delivery_fee numeric(12,2) default 0,
  marketplace_fee numeric(12,2) default 0,
  handling_fee numeric(12,2) default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  pricing_version integer default 1,
  delivery_base_fee numeric(12,2) default 0,
  delivery_distance_fee numeric(12,2) default 0,
  delivery_rate_per_km numeric(10,2) default 0,
  delivery_company_cut numeric(12,2) default 0,
  pricing_snapshot jsonb default '{}'::jsonb,
  producer_product_net numeric(12,2) generated always as (GREATEST((product_subtotal - marketplace_fee), (0)::numeric)) stored,
  final_cash_collected_amount numeric(12,2) default 0,
  company_settlement_due numeric(12,2) generated always as ((COALESCE(marketplace_fee, (0)::numeric) + COALESCE(delivery_company_cut, (0)::numeric))) stored,
  cash_collection_required boolean default false,
  cash_collection_amount numeric(12,2) default 0,
  route_plan text default 'farmer_first'::text,
  assignment_anchor text default 'farmer'::text,
  pickup_distance_fee numeric(12,2) default 0,
  customer_cash_collected_amount numeric(12,2) default 0,
  producer_paid_amount numeric(12,2) default 0,
  wallet_settlement_status text default 'not_due'::text,
  wallet_settlement_amount numeric(12,2) default 0,
  fulfillment_mode text default 'always_available'::text,
  heavy_load_fee numeric(12,2) default 0,
  total_payable numeric(12,2) generated always as (((((product_subtotal + delivery_fee) + pickup_distance_fee) + heavy_load_fee) + handling_fee)) stored,
  driver_delivery_payout numeric(12,2) generated always as (((GREATEST(((delivery_fee + pickup_distance_fee) - delivery_company_cut), (0)::numeric) + heavy_load_fee) + handling_fee)) stored,
  wallet_settlement_error text,
  producer_id uuid,
  customer_reapproval_proposed_total numeric(12,2),
  checkout_preferred_vehicle_type text,
  handling_selected_at timestamp with time zone,
  customer_reapproval_response text,
  customer_reapproval_resume_status text,
  producer_paid_at timestamp with time zone,
  customer_approved_total numeric(12,2),
  customer_to_farmer_distance_km numeric(10,3),
  wallet_settled_at timestamp with time zone,
  delivery_lat double precision,
  handling_locked_at timestamp with time zone,
  delivery_confirmed_by_driver_id uuid,
  harvest_ready_at timestamp with time zone,
  pickup_issue jsonb,
  ready_at timestamp with time zone,
  customer_reapproval_required_at timestamp with time zone,
  delivery_address_id uuid,
  delivered_at timestamp with time zone,
  confirmed_cargo_weight_kg numeric(12,3),
  farmer_to_customer_duration_seconds integer,
  customer_to_farmer_duration_seconds integer,
  driver_to_first_pickup_km numeric(10,3),
  confirmed_handling_tier text,
  customer_user_id uuid,
  delivering_at timestamp with time zone,
  producer_timeout_at timestamp with time zone,
  pickup_fee_locked_at timestamp with time zone,
  delivery_lng double precision,
  confirmed_cargo_weight_basis text,
  route_distance_km numeric(10,3),
  handling_reason text,
  harvest_expected_start_at timestamp with time zone,
  customer_reapproval_responded_at timestamp with time zone,
  handling_selected_by_driver_id uuid,
  producer_responded_at timestamp with time zone,
  cancel_reason text,
  dispatch_started_at timestamp with time zone,
  farmer_to_customer_distance_km numeric(10,3),
  confirmed_cargo_weight_band text,
  customer_cash_collected_at timestamp with time zone,
  delivery_booking_id uuid,
  preferred_vehicle_type text,
  product_required_vehicle_type text,
  picked_up_at timestamp with time zone,
  producer_accepted_at timestamp with time zone,
  producer_paid_by_driver_id uuid,
  order_code text,
  final_cash_collected_at timestamp with time zone,
  route_provider text,
  preparation_minutes integer,
  harvest_expected_end_at timestamp with time zone,
  customer_approved_vehicle_type text,
  producer_rejected_at timestamp with time zone,
  delivery_label text,
  route_duration_seconds integer,
  customer_reapproval_proposed_vehicle_type text,
  client_request_id uuid,
  completed_at timestamp with time zone,
  selected_vehicle_type text,
  wallet_settlement_id uuid,
  assigned_driver_id uuid,
  estimated_cargo_weight_kg numeric(12,3),
  cancelled_at timestamp with time zone,
  customer_cash_collected_by_driver_id uuid
);
create table public.agrimarket_pickup_checks (
  id uuid default gen_random_uuid(),
  check_type text default 'condition'::text,
  checked_at timestamp with time zone default now(),
  order_id uuid,
  observed_condition text,
  expected_condition text,
  driver_id uuid,
  notes text,
  result text,
  order_item_id uuid
);
create table public.agrimarket_order_events (
  id uuid default gen_random_uuid(),
  details jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  actor_type text,
  order_id uuid,
  to_status text,
  reason_code text,
  from_status text,
  actor_id uuid
);
create table public.agrimarket_producers(id uuid primary key,vendor_name text,accepting_orders boolean default false);
create table public.agrimarket_products(id uuid primary key,producer_id uuid,is_active boolean default false,reserved_quantity numeric default 0,updated_at timestamptz);
create table public.agrimarket_inventory_reservations(order_id uuid,product_id uuid,quantity numeric,status text,released_at timestamptz);
create table public.drivers(id uuid);
create table public.driver_locations(driver_id uuid);
create schema cron;
create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
create function public.jride_vehicle_rank_v1(text) returns integer language sql immutable as
  $$select case $1 when 'motorcycle' then 1 when 'tricycle' then 2 when 'kolong_kolong' then 3 else 0 end$$;
CREATE OR REPLACE FUNCTION public.agrimarket_release_active_reservations_v1(p_order_id uuid, p_reservation_status text, p_reason text, p_at timestamp with time zone DEFAULT clock_timestamp())
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
  set reserved_quantity = greatest(p.reserved_quantity - release_qty.qty, 0),
      updated_at = p_at
  from release_qty
  where p.id = release_qty.product_id;

  update public.agrimarket_inventory_reservations r
  set status = p_reservation_status,
      released_at = p_at
  where r.order_id = p_order_id
    and r.status = 'active';
end;
$function$;
CREATE OR REPLACE FUNCTION public.agrimarket_apply_driver_approach_order_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_approach_distance numeric(12,3);
  v_quote jsonb;
begin
  if new.assigned_driver_id is null
     and new.pickup_fee_locked_at is null then
    new.pickup_distance_fee := 0;
    return new;
  end if;

  if new.driver_to_first_pickup_km is null
     or new.driver_to_first_pickup_km < 0 then
    raise exception 'AGRIMARKET_DRIVER_APPROACH_FIRST_LEG_REQUIRED'
      using errcode = 'P0001';
  end if;

  if new.assignment_anchor = 'customer' then
    if new.customer_to_farmer_distance_km is null
       or new.customer_to_farmer_distance_km < 0 then
      raise exception 'AGRIMARKET_DRIVER_APPROACH_CUSTOMER_FARMER_ROUTE_REQUIRED'
        using errcode = 'P0001';
    end if;

    v_approach_distance := round(
      new.driver_to_first_pickup_km + new.customer_to_farmer_distance_km,
      3
    );
  else
    v_approach_distance := round(new.driver_to_first_pickup_km, 3);
  end if;

  v_quote := public.agrimarket_compute_driver_approach_fee_v1(
    v_approach_distance
  );

  new.pickup_distance_fee := (v_quote->>'fee')::numeric;
  new.pricing_snapshot := coalesce(new.pricing_snapshot, '{}'::jsonb)
    || jsonb_build_object(
      'pickup_distance_fee_rule', v_quote->>'rule',
      'driver_approach_distance_basis', 'assigned_driver_to_farmer_road_route',
      'driver_approach_distance_km', (v_quote->>'distance_km')::numeric,
      'driver_approach_free_km', (v_quote->>'free_km')::numeric,
      'driver_approach_block_km', (v_quote->>'block_km')::numeric,
      'driver_approach_tier_one_end_km', (v_quote->>'tier_one_end_km')::numeric,
      'driver_approach_tier_one_fee_per_block', (v_quote->>'tier_one_fee_per_block')::numeric,
      'driver_approach_tier_two_fee_per_block', (v_quote->>'tier_two_fee_per_block')::numeric,
      'driver_approach_raw_max_fee', (v_quote->>'raw_max_fee')::numeric,
      'driver_approach_base_delivery_fee_credit', (v_quote->>'base_delivery_fee_credit')::numeric,
      'driver_approach_raw_pickup_fee', (v_quote->>'raw_pickup_fee')::numeric,
      'driver_approach_pickup_fee_absorbed_by_base', (v_quote->>'pickup_fee_absorbed_by_base')::numeric,
      'driver_approach_charge', (v_quote->>'approach_charge')::numeric,
      'pickup_distance_fee', (v_quote->>'fee')::numeric
    );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.agrimarket_guard_pending_customer_reapproval_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

create trigger agrimarket_guard_pending_customer_reapproval_trg before update of status on public.agrimarket_orders for each row execute function public.agrimarket_guard_pending_customer_reapproval_v1();
create trigger agrimarket_apply_driver_approach_order_trg before update of assigned_driver_id,driver_to_first_pickup_km,pickup_distance_fee,pickup_fee_locked_at on public.agrimarket_orders for each row execute function public.agrimarket_apply_driver_approach_order_v1();
