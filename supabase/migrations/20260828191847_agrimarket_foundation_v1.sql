create table public.agrimarket_producers (
  id uuid primary key default gen_random_uuid(),
  vendor_account_id uuid unique references public.vendor_accounts(id) on delete set null,
  contact_name text not null,
  town text not null,
  barangay text,
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  status text not null default 'pending',
  accepting_orders boolean not null default true,
  joining_fee numeric(12,2) not null default 0,
  listing_fee numeric(12,2) not null default 0,
  marketplace_fee_percent numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_producers_status_chk check (status in ('pending','active','paused','suspended')),
  constraint agrimarket_producers_lat_chk check (pickup_lat between -90 and 90),
  constraint agrimarket_producers_lng_chk check (pickup_lng between -180 and 180),
  constraint agrimarket_producers_joining_fee_chk check (joining_fee >= 0),
  constraint agrimarket_producers_listing_fee_chk check (listing_fee >= 0),
  constraint agrimarket_producers_marketplace_fee_chk check (marketplace_fee_percent between 0 and 100)
);

create table public.agrimarket_products (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.agrimarket_producers(id) on delete cascade,
  name text not null,
  description text,
  product_group text not null,
  species text,
  breed text,
  meat_cut text,
  processing_form text,
  condition text not null default 'normal',
  cargo_class text not null,
  selling_unit text not null,
  unit_price numeric(12,2) not null,
  listed_quantity numeric(12,3) not null default 0,
  reserved_quantity numeric(12,3) not null default 0,
  sold_quantity numeric(12,3) not null default 0,
  remaining_quantity numeric(12,3) generated always as (greatest(listed_quantity - reserved_quantity - sold_quantity, 0::numeric)) stored,
  availability_mode text not null default 'always_available',
  harvest_start_at timestamptz,
  harvest_end_at timestamptz,
  default_prep_minutes integer not null default 15,
  vehicle_requirement text not null default 'either',
  handling_eligible boolean not null default false,
  photo_urls text[] not null default '{}'::text[],
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_products_name_chk check (length(trim(name)) >= 2),
  constraint agrimarket_products_group_chk check (product_group in ('produce','grain','aquatic','poultry','livestock','meat','eggs','other_agri')),
  constraint agrimarket_products_processing_form_chk check (processing_form is null or processing_form in ('whole','chopped','sliced','ground','other')),
  constraint agrimarket_products_condition_chk check (condition in ('normal','fresh','chilled','frozen','live_at_pickup')),
  constraint agrimarket_products_cargo_class_chk check (cargo_class in ('standard_produce','fragile_produce','bulk_sack','crate','live_fish','live_poultry','live_livestock','fresh_meat','chilled_meat','frozen_meat','other_agri')),
  constraint agrimarket_products_unit_price_chk check (unit_price >= 0),
  constraint agrimarket_products_quantities_chk check (listed_quantity >= 0 and reserved_quantity >= 0 and sold_quantity >= 0 and reserved_quantity + sold_quantity <= listed_quantity),
  constraint agrimarket_products_availability_chk check (availability_mode in ('always_available','scheduled_harvest')),
  constraint agrimarket_products_harvest_window_chk check ((availability_mode = 'always_available') or (harvest_start_at is not null)),
  constraint agrimarket_products_harvest_end_chk check (harvest_end_at is null or harvest_start_at is null or harvest_end_at >= harvest_start_at),
  constraint agrimarket_products_prep_chk check (default_prep_minutes between 0 and 1440),
  constraint agrimarket_products_vehicle_chk check (vehicle_requirement in ('either','motorcycle','tricycle'))
);

create table public.agrimarket_orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  customer_user_id uuid not null,
  delivery_address_id uuid references public.passenger_addresses(id) on delete set null,
  delivery_label text not null,
  delivery_lat double precision not null,
  delivery_lng double precision not null,
  producer_id uuid not null references public.agrimarket_producers(id) on delete restrict,
  status text not null default 'awaiting_producer',
  producer_confirm_expires_at timestamptz not null default (now() + interval '5 minutes'),
  producer_responded_at timestamptz,
  producer_accepted_at timestamptz,
  producer_rejected_at timestamptz,
  producer_timeout_at timestamptz,
  preparation_minutes integer,
  ready_at timestamptz,
  preferred_vehicle_type text not null,
  required_vehicle_type text not null default 'either',
  selected_vehicle_type text,
  route_distance_km numeric(10,3),
  route_duration_seconds integer,
  product_subtotal numeric(12,2) not null default 0,
  delivery_fee numeric(12,2) not null default 0,
  marketplace_fee numeric(12,2) not null default 0,
  handling_fee numeric(12,2) not null default 0,
  handling_reason text,
  handling_selected_by_driver_id uuid,
  handling_selected_at timestamptz,
  handling_locked_at timestamptz,
  total_payable numeric(12,2) generated always as (product_subtotal + delivery_fee + marketplace_fee + handling_fee) stored,
  dispatch_started_at timestamptz,
  assigned_driver_id uuid,
  delivery_booking_id uuid unique references public.bookings(id) on delete set null,
  picked_up_at timestamptz,
  delivering_at timestamptz,
  delivered_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint agrimarket_orders_delivery_lat_chk check (delivery_lat between -90 and 90),
  constraint agrimarket_orders_delivery_lng_chk check (delivery_lng between -180 and 180),
  constraint agrimarket_orders_status_chk check (status in ('awaiting_producer','awaiting_harvest','producer_accepted','preparing','ready_for_dispatch','dispatching','driver_assigned','picked_up','delivering','delivered','completed','producer_rejected','producer_timeout','cancelled','exception')),
  constraint agrimarket_orders_prep_chk check (preparation_minutes is null or preparation_minutes between 0 and 1440),
  constraint agrimarket_orders_preferred_vehicle_chk check (preferred_vehicle_type in ('motorcycle','tricycle')),
  constraint agrimarket_orders_required_vehicle_chk check (required_vehicle_type in ('either','motorcycle','tricycle')),
  constraint agrimarket_orders_selected_vehicle_chk check (selected_vehicle_type is null or selected_vehicle_type in ('motorcycle','tricycle')),
  constraint agrimarket_orders_route_distance_chk check (route_distance_km is null or route_distance_km >= 0),
  constraint agrimarket_orders_route_duration_chk check (route_duration_seconds is null or route_duration_seconds >= 0),
  constraint agrimarket_orders_money_chk check (product_subtotal >= 0 and delivery_fee >= 0 and marketplace_fee >= 0),
  constraint agrimarket_orders_handling_fee_chk check (handling_fee in (0,10,20,30,40,50)),
  constraint agrimarket_orders_handling_reason_chk check (
    handling_reason is null or handling_reason in ('carry_load_sack','multiple_sacks','heavy_crate','livestock_loading','unloading_assistance','other_approved')
  ),
  constraint agrimarket_orders_handling_reason_required_chk check (handling_fee = 0 or handling_reason is not null)
);

create table public.agrimarket_order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  product_id uuid references public.agrimarket_products(id) on delete set null,
  product_name text not null,
  product_group text not null,
  species text,
  breed text,
  meat_cut text,
  processing_form text,
  condition_required text not null default 'normal',
  cargo_class text not null,
  selling_unit text not null,
  unit_price numeric(12,2) not null,
  quantity numeric(12,3) not null,
  line_total numeric(12,2) generated always as (unit_price * quantity) stored,
  handling_eligible boolean not null default false,
  created_at timestamptz not null default now(),
  constraint agrimarket_order_items_group_chk check (product_group in ('produce','grain','aquatic','poultry','livestock','meat','eggs','other_agri')),
  constraint agrimarket_order_items_processing_form_chk check (processing_form is null or processing_form in ('whole','chopped','sliced','ground','other')),
  constraint agrimarket_order_items_condition_chk check (condition_required in ('normal','fresh','chilled','frozen','live_at_pickup')),
  constraint agrimarket_order_items_cargo_class_chk check (cargo_class in ('standard_produce','fragile_produce','bulk_sack','crate','live_fish','live_poultry','live_livestock','fresh_meat','chilled_meat','frozen_meat','other_agri')),
  constraint agrimarket_order_items_price_chk check (unit_price >= 0),
  constraint agrimarket_order_items_quantity_chk check (quantity > 0)
);

create table public.agrimarket_inventory_reservations (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  order_item_id uuid not null unique references public.agrimarket_order_items(id) on delete cascade,
  product_id uuid not null references public.agrimarket_products(id) on delete restrict,
  quantity numeric(12,3) not null,
  status text not null default 'active',
  expires_at timestamptz not null,
  released_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint agrimarket_inventory_reservations_quantity_chk check (quantity > 0),
  constraint agrimarket_inventory_reservations_status_chk check (status in ('active','released','consumed','expired'))
);

create table public.agrimarket_pickup_checks (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  order_item_id uuid not null references public.agrimarket_order_items(id) on delete cascade,
  driver_id uuid not null,
  check_type text not null default 'condition',
  expected_condition text not null,
  result text not null,
  observed_condition text,
  notes text,
  checked_at timestamptz not null default now(),
  constraint agrimarket_pickup_checks_type_chk check (check_type in ('condition','quantity','cargo')),
  constraint agrimarket_pickup_checks_expected_chk check (expected_condition in ('normal','fresh','chilled','frozen','live_at_pickup')),
  constraint agrimarket_pickup_checks_result_chk check (result in ('pass','mismatch'))
);

create table public.agrimarket_handling_fee_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  driver_id uuid not null,
  amount numeric(12,2) not null,
  reason text,
  action text not null default 'selected',
  created_at timestamptz not null default now(),
  constraint agrimarket_handling_fee_events_amount_chk check (amount in (0,10,20,30,40,50)),
  constraint agrimarket_handling_fee_events_reason_chk check (reason is null or reason in ('carry_load_sack','multiple_sacks','heavy_crate','livestock_loading','unloading_assistance','other_approved')),
  constraint agrimarket_handling_fee_events_reason_required_chk check (amount = 0 or reason is not null),
  constraint agrimarket_handling_fee_events_action_chk check (action in ('selected','changed','locked','waived'))
);

create table public.agrimarket_order_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  from_status text,
  to_status text not null,
  actor_type text not null,
  actor_id uuid,
  reason_code text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint agrimarket_order_events_actor_type_chk check (actor_type in ('customer','producer','driver','system','admin','support'))
);

create index agrimarket_products_producer_active_idx on public.agrimarket_products (producer_id, is_active);
create index agrimarket_products_catalog_idx on public.agrimarket_products (product_group, is_active, availability_mode);
create index agrimarket_products_harvest_idx on public.agrimarket_products (harvest_start_at) where availability_mode = 'scheduled_harvest' and is_active;
create index agrimarket_orders_customer_idx on public.agrimarket_orders (customer_user_id, created_at desc);
create index agrimarket_orders_producer_status_idx on public.agrimarket_orders (producer_id, status, created_at desc);
create index agrimarket_orders_confirmation_deadline_idx on public.agrimarket_orders (producer_confirm_expires_at) where status = 'awaiting_producer';
create index agrimarket_orders_ready_idx on public.agrimarket_orders (ready_at) where status in ('producer_accepted','preparing','ready_for_dispatch');
create index agrimarket_orders_dispatch_idx on public.agrimarket_orders (status, selected_vehicle_type, dispatch_started_at);
create index agrimarket_inventory_product_active_idx on public.agrimarket_inventory_reservations (product_id, expires_at) where status = 'active';
create index agrimarket_pickup_checks_order_idx on public.agrimarket_pickup_checks (order_id, checked_at);
create index agrimarket_handling_fee_events_order_idx on public.agrimarket_handling_fee_events (order_id, created_at);
create index agrimarket_order_events_order_idx on public.agrimarket_order_events (order_id, created_at);

alter table public.agrimarket_producers enable row level security;
alter table public.agrimarket_products enable row level security;
alter table public.agrimarket_orders enable row level security;
alter table public.agrimarket_order_items enable row level security;
alter table public.agrimarket_inventory_reservations enable row level security;
alter table public.agrimarket_pickup_checks enable row level security;
alter table public.agrimarket_handling_fee_events enable row level security;
alter table public.agrimarket_order_events enable row level security;

revoke all on table public.agrimarket_producers from anon, authenticated;
revoke all on table public.agrimarket_products from anon, authenticated;
revoke all on table public.agrimarket_orders from anon, authenticated;
revoke all on table public.agrimarket_order_items from anon, authenticated;
revoke all on table public.agrimarket_inventory_reservations from anon, authenticated;
revoke all on table public.agrimarket_pickup_checks from anon, authenticated;
revoke all on table public.agrimarket_handling_fee_events from anon, authenticated;
revoke all on table public.agrimarket_order_events from anon, authenticated;

grant all privileges on table public.agrimarket_producers to service_role;
grant all privileges on table public.agrimarket_products to service_role;
grant all privileges on table public.agrimarket_orders to service_role;
grant all privileges on table public.agrimarket_order_items to service_role;
grant all privileges on table public.agrimarket_inventory_reservations to service_role;
grant all privileges on table public.agrimarket_pickup_checks to service_role;
grant all privileges on table public.agrimarket_handling_fee_events to service_role;
grant all privileges on table public.agrimarket_order_events to service_role;
