-- JFleet core marketplace schema.
-- Passenger inquiries remain separate from confirmed bookings.
-- Owner pricing is authoritative; JRide does not auto-price JFleet trips.

create table public.jfleet_partners (
  id uuid primary key default gen_random_uuid(),
  partner_code text not null unique,
  legal_name text not null,
  display_name text not null,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','active','suspended','closed')),
  is_priority_pilot boolean not null default false,
  pilot_start_at timestamptz,
  pilot_end_at timestamptz,
  quote_tat_minutes integer not null default 180
    check (quote_tat_minutes between 15 and 1440),
  reservation_percent numeric(5,2) not null default 20.00
    check (reservation_percent between 0 and 100),
  free_cancel_hours integer not null default 48
    check (free_cancel_hours between 0 and 720),
  late_cancel_percent numeric(5,2) not null default 10.00
    check (late_cancel_percent between 0 and 100),
  commission_percent numeric(5,2) not null default 10.00
    check (commission_percent between 0 and 100),
  minimum_commission numeric(12,2) not null default 1500.00
    check (minimum_commission >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    pilot_end_at is null or pilot_start_at is null or pilot_end_at > pilot_start_at
  )
);

create table public.jfleet_partner_documents (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.jfleet_partners(id) on delete cascade,
  document_type text not null,
  document_number text,
  issued_at date,
  expires_at date,
  file_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','expired')),
  verified_at timestamptz,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

create table public.jfleet_vehicles (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.jfleet_partners(id) on delete cascade,
  unit_code text not null,
  vehicle_type text not null
    check (vehicle_type in ('van','pickup','truck','other')),
  make text,
  model text,
  model_year integer check (model_year is null or model_year between 1950 and 2100),
  plate_number text not null,
  passenger_capacity integer check (passenger_capacity is null or passenger_capacity >= 0),
  cargo_capacity_kg numeric(12,3) check (cargo_capacity_kg is null or cargo_capacity_kg > 0),
  status text not null default 'inactive'
    check (status in ('active','inactive','maintenance','suspended')),
  documents_verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, unit_code),
  unique (plate_number)
);

create table public.jfleet_vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.jfleet_vehicles(id) on delete cascade,
  document_type text not null,
  document_number text,
  issued_at date,
  expires_at date,
  file_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','expired')),
  verified_at timestamptz,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

create table public.jfleet_drivers (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.jfleet_partners(id) on delete cascade,
  driver_code text not null,
  auth_user_id uuid references auth.users(id) on delete set null,
  full_name text not null,
  phone text,
  photo_url text,
  status text not null default 'inactive'
    check (status in ('active','inactive','on_leave','suspended')),
  documents_verified boolean not null default false,
  rating_average numeric(3,2) not null default 0
    check (rating_average between 0 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),
  completed_trips integer not null default 0 check (completed_trips >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, driver_code),
  unique (auth_user_id)
);

create table public.jfleet_driver_documents (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.jfleet_drivers(id) on delete cascade,
  document_type text not null,
  document_number text,
  issued_at date,
  expires_at date,
  file_url text,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','expired')),
  verified_at timestamptz,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expires_at is null or issued_at is null or expires_at >= issued_at)
);

create table public.jfleet_inquiries (
  id uuid primary key default gen_random_uuid(),
  inquiry_code text not null unique,
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  partner_id uuid not null references public.jfleet_partners(id) on delete restrict,
  purpose text not null
    check (purpose in ('tour_leisure','family','business','event','cargo_delivery','moving_hauling','other')),
  requested_vehicle_type text not null
    check (requested_vehicle_type in ('van','pickup','truck','recommend')),
  trip_mode text not null
    check (trip_mode in ('one_way','round_trip','multi_day')),
  pickup_label text not null,
  pickup_lat double precision,
  pickup_lng double precision,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz,
  passenger_count integer check (passenger_count is null or passenger_count >= 1),
  cargo_description text,
  cargo_weight_kg numeric(12,3) check (cargo_weight_kg is null or cargo_weight_kg > 0),
  luggage_notes text,
  special_notes text,
  status text not null default 'quote_requested'
    check (status in (
      'quote_requested','under_review','quote_ready','revision_requested',
      'quote_accepted','declined','expired','cancelled','converted'
    )),
  current_itinerary_version integer not null default 1
    check (current_itinerary_version >= 1),
  submitted_at timestamptz not null default now(),
  quote_due_at timestamptz not null,
  owner_opened_at timestamptz,
  accepted_quote_id uuid,
  converted_booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pickup_lat is null or pickup_lat between -90 and 90),
  check (pickup_lng is null or pickup_lng between -180 and 180),
  check (scheduled_end_at is null or scheduled_end_at >= scheduled_start_at)
);

create table public.jfleet_itineraries (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.jfleet_inquiries(id) on delete cascade,
  version_no integer not null check (version_no >= 1),
  source text not null default 'customer'
    check (source in ('customer','owner_revision','approved_side_trip')),
  status text not null default 'current'
    check (status in ('current','superseded')),
  change_reason text,
  created_at timestamptz not null default now(),
  unique (inquiry_id, version_no)
);

create table public.jfleet_itinerary_stops (
  id uuid primary key default gen_random_uuid(),
  itinerary_id uuid not null references public.jfleet_itineraries(id) on delete cascade,
  sequence_no integer not null check (sequence_no >= 0),
  stop_type text not null
    check (stop_type in ('pickup','stop','destination','return')),
  location_label text not null,
  lat double precision,
  lng double precision,
  notes text,
  created_at timestamptz not null default now(),
  unique (itinerary_id, sequence_no),
  check (lat is null or lat between -90 and 90),
  check (lng is null or lng between -180 and 180)
);

create table public.jfleet_quotes (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.jfleet_inquiries(id) on delete cascade,
  partner_id uuid not null references public.jfleet_partners(id) on delete restrict,
  itinerary_id uuid not null references public.jfleet_itineraries(id) on delete restrict,
  version_no integer not null check (version_no >= 1),
  status text not null default 'sent'
    check (status in ('sent','superseded','accepted','declined','expired','withdrawn')),
  total_amount numeric(12,2) not null check (total_amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  valid_until timestamptz not null,
  inclusions text,
  exclusions text,
  pricing_notes text,
  fuel_basis_note text,
  sent_at timestamptz not null default now(),
  accepted_at timestamptz,
  declined_at timestamptz,
  created_by_owner_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inquiry_id, version_no)
);

create table public.jfleet_quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.jfleet_quotes(id) on delete cascade,
  sequence_no integer not null default 0 check (sequence_no >= 0),
  item_type text not null
    check (item_type in ('vehicle_hire','fuel','driver','toll_parking','accommodation','other')),
  label text not null,
  amount numeric(12,2) not null default 0 check (amount >= 0),
  included boolean not null default true,
  notes text,
  unique (quote_id, sequence_no)
);

create table public.jfleet_bookings (
  id uuid primary key default gen_random_uuid(),
  booking_code text not null unique,
  inquiry_id uuid not null unique references public.jfleet_inquiries(id) on delete restrict,
  accepted_quote_id uuid not null unique references public.jfleet_quotes(id) on delete restrict,
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  partner_id uuid not null references public.jfleet_partners(id) on delete restrict,
  current_itinerary_id uuid not null references public.jfleet_itineraries(id) on delete restrict,
  scheduled_start_at timestamptz not null,
  scheduled_end_at timestamptz,
  original_quote_amount numeric(12,2) not null check (original_quote_amount > 0),
  addon_total numeric(12,2) not null default 0 check (addon_total >= 0),
  reservation_percent numeric(5,2) not null default 20.00
    check (reservation_percent between 0 and 100),
  free_cancel_hours integer not null default 48
    check (free_cancel_hours between 0 and 720),
  late_cancel_percent numeric(5,2) not null default 10.00
    check (late_cancel_percent between 0 and 100),
  commission_percent numeric(5,2) not null default 10.00
    check (commission_percent between 0 and 100),
  minimum_commission numeric(12,2) not null default 1500.00
    check (minimum_commission >= 0),
  reservation_required_amount numeric(12,2)
    generated always as (round(original_quote_amount * reservation_percent / 100.0, 2)) stored,
  cancellation_free_until timestamptz not null,
  final_trip_value numeric(12,2)
    generated always as (original_quote_amount + addon_total) stored,
  jride_commission_amount numeric(12,2)
    generated always as (
      least(
        original_quote_amount + addon_total,
        greatest(
          round((original_quote_amount + addon_total) * commission_percent / 100.0, 2),
          minimum_commission
        )
      )
    ) stored,
  partner_net_amount numeric(12,2)
    generated always as (
      (original_quote_amount + addon_total) -
      least(
        original_quote_amount + addon_total,
        greatest(
          round((original_quote_amount + addon_total) * commission_percent / 100.0, 2),
          minimum_commission
        )
      )
    ) stored,
  status text not null default 'reservation_pending'
    check (status in (
      'reservation_pending','confirmed','assignment_pending','assigned',
      'upcoming','driver_en_route','driver_arrived','ready_for_trip',
      'on_trip','completed','cancelled_customer','cancelled_operator'
    )),
  payment_status text not null default 'reservation_pending'
    check (payment_status in ('reservation_pending','reservation_paid','fully_paid','refund_pending','refunded')),
  reservation_paid_at timestamptz,
  fully_paid_at timestamptz,
  assigned_vehicle_id uuid references public.jfleet_vehicles(id) on delete restrict,
  assigned_driver_id uuid references public.jfleet_drivers(id) on delete restrict,
  assigned_at timestamptz,
  trip_started_at timestamptz,
  trip_completed_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by text check (cancelled_by is null or cancelled_by in ('customer','operator','jride','system')),
  cancellation_reason text,
  cancellation_penalty_amount numeric(12,2) not null default 0 check (cancellation_penalty_amount >= 0),
  refund_amount numeric(12,2) not null default 0 check (refund_amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (scheduled_end_at is null or scheduled_end_at >= scheduled_start_at)
);

alter table public.jfleet_inquiries
  add constraint jfleet_inquiries_accepted_quote_fk
  foreign key (accepted_quote_id) references public.jfleet_quotes(id) on delete set null;

alter table public.jfleet_inquiries
  add constraint jfleet_inquiries_converted_booking_fk
  foreign key (converted_booking_id) references public.jfleet_bookings(id) on delete set null;

create table public.jfleet_payments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.jfleet_bookings(id) on delete cascade,
  payment_kind text not null
    check (payment_kind in ('reservation','balance','full_payment','addon','refund')),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending','confirmed','failed','refunded','void')),
  payment_channel text,
  payment_reference text,
  idempotency_key text unique,
  received_by text,
  confirmed_by_owner_user_id uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  confirmed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jfleet_addons (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.jfleet_bookings(id) on delete cascade,
  requested_by text not null
    check (requested_by in ('customer','driver','owner')),
  description text not null,
  additional_route jsonb not null default '{}'::jsonb,
  fuel_vehicle_fee numeric(12,2) not null default 0 check (fuel_vehicle_fee >= 0),
  driver_fee numeric(12,2) not null default 0 check (driver_fee >= 0),
  other_fee numeric(12,2) not null default 0 check (other_fee >= 0),
  total_amount numeric(12,2)
    generated always as (fuel_vehicle_fee + driver_fee + other_fee) stored,
  status text not null default 'proposed'
    check (status in ('proposed','accepted','declined','paid','void')),
  proposed_at timestamptz not null default now(),
  accepted_at timestamptz,
  payment_confirmed_at timestamptz,
  itinerary_id_after uuid references public.jfleet_itineraries(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jfleet_driver_locations (
  driver_id uuid primary key references public.jfleet_drivers(id) on delete cascade,
  booking_id uuid references public.jfleet_bookings(id) on delete set null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  device_id text,
  captured_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.jfleet_route_points (
  id bigint generated always as identity primary key,
  booking_id uuid not null references public.jfleet_bookings(id) on delete cascade,
  driver_id uuid not null references public.jfleet_drivers(id) on delete restrict,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  device_id text,
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);

create table public.jfleet_route_deviation_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.jfleet_bookings(id) on delete cascade,
  driver_id uuid not null references public.jfleet_drivers(id) on delete restrict,
  event_status text not null default 'open'
    check (event_status in ('open','acknowledged','approved_detour','resolved')),
  deviation_distance_m numeric(12,2),
  detected_at timestamptz not null default now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  resolution_reason text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.jfleet_events (
  id bigint generated always as identity primary key,
  inquiry_id uuid references public.jfleet_inquiries(id) on delete cascade,
  booking_id uuid references public.jfleet_bookings(id) on delete cascade,
  actor_type text not null
    check (actor_type in ('customer','owner','driver','jride','system')),
  actor_id text,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (inquiry_id is not null or booking_id is not null)
);

create or replace function public.jfleet_touch_updated_at_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger jfleet_partners_touch_updated_at
before update on public.jfleet_partners
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_partner_documents_touch_updated_at
before update on public.jfleet_partner_documents
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_vehicles_touch_updated_at
before update on public.jfleet_vehicles
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_vehicle_documents_touch_updated_at
before update on public.jfleet_vehicle_documents
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_drivers_touch_updated_at
before update on public.jfleet_drivers
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_driver_documents_touch_updated_at
before update on public.jfleet_driver_documents
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_inquiries_touch_updated_at
before update on public.jfleet_inquiries
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_quotes_touch_updated_at
before update on public.jfleet_quotes
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_bookings_touch_updated_at
before update on public.jfleet_bookings
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_payments_touch_updated_at
before update on public.jfleet_payments
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_addons_touch_updated_at
before update on public.jfleet_addons
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_route_deviation_events_touch_updated_at
before update on public.jfleet_route_deviation_events
for each row execute function public.jfleet_touch_updated_at_v1();

create or replace function public.jfleet_set_booking_policy_snapshots_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.cancellation_free_until :=
    new.scheduled_start_at - (new.free_cancel_hours * interval '1 hour');
  return new;
end;
$$;

create trigger jfleet_set_booking_policy_snapshots_trg
before insert or update of scheduled_start_at, free_cancel_hours
on public.jfleet_bookings
for each row execute function public.jfleet_set_booking_policy_snapshots_v1();

create or replace function public.jfleet_guard_assignment_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_vehicle_partner uuid;
  v_vehicle_status text;
  v_vehicle_verified boolean;
  v_driver_partner uuid;
  v_driver_status text;
  v_driver_verified boolean;
begin
  if new.assigned_vehicle_id is not null then
    select partner_id, status, documents_verified
      into v_vehicle_partner, v_vehicle_status, v_vehicle_verified
    from public.jfleet_vehicles
    where id = new.assigned_vehicle_id;

    if v_vehicle_partner is distinct from new.partner_id
       or v_vehicle_status is distinct from 'active'
       or v_vehicle_verified is distinct from true then
      raise exception 'JFLEET_VEHICLE_NOT_ELIGIBLE';
    end if;
  end if;

  if new.assigned_driver_id is not null then
    select partner_id, status, documents_verified
      into v_driver_partner, v_driver_status, v_driver_verified
    from public.jfleet_drivers
    where id = new.assigned_driver_id;

    if v_driver_partner is distinct from new.partner_id
       or v_driver_status is distinct from 'active'
       or v_driver_verified is distinct from true then
      raise exception 'JFLEET_DRIVER_NOT_ELIGIBLE';
    end if;
  end if;

  if (new.assigned_vehicle_id is null) <> (new.assigned_driver_id is null) then
    raise exception 'JFLEET_DRIVER_AND_VEHICLE_REQUIRED_TOGETHER';
  end if;

  if new.assigned_vehicle_id is not null and new.assigned_at is null then
    new.assigned_at := clock_timestamp();
  end if;

  return new;
end;
$$;

create trigger jfleet_guard_assignment_trg
before insert or update of assigned_vehicle_id, assigned_driver_id
on public.jfleet_bookings
for each row execute function public.jfleet_guard_assignment_v1();

create or replace function public.jfleet_guard_trip_start_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_paid numeric(12,2);
begin
  if new.status = 'on_trip' and old.status is distinct from 'on_trip' then
    if new.assigned_vehicle_id is null or new.assigned_driver_id is null then
      raise exception 'JFLEET_ASSIGNMENT_REQUIRED_BEFORE_START';
    end if;

    select coalesce(sum(p.amount), 0)
      into v_paid
    from public.jfleet_payments p
    where p.booking_id = new.id
      and p.status = 'confirmed'
      and p.payment_kind in ('reservation','balance','full_payment');

    if v_paid < new.original_quote_amount then
      raise exception 'JFLEET_ORIGINAL_QUOTE_NOT_FULLY_PAID';
    end if;

    new.payment_status := 'fully_paid';
    new.fully_paid_at := coalesce(new.fully_paid_at, clock_timestamp());
    new.trip_started_at := coalesce(new.trip_started_at, clock_timestamp());
  end if;

  if new.status = 'completed' and old.status is distinct from 'completed' then
    if old.status <> 'on_trip' then
      raise exception 'JFLEET_TRIP_NOT_ACTIVE';
    end if;
    new.trip_completed_at := coalesce(new.trip_completed_at, clock_timestamp());
  end if;

  return new;
end;
$$;

create trigger jfleet_guard_trip_start_trg
before update of status on public.jfleet_bookings
for each row execute function public.jfleet_guard_trip_start_v1();

create or replace function public.jfleet_create_inquiry_v1(
  p_inquiry_code text,
  p_passenger_user_id uuid,
  p_partner_id uuid,
  p_purpose text,
  p_requested_vehicle_type text,
  p_trip_mode text,
  p_pickup_label text,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_scheduled_start_at timestamptz,
  p_scheduled_end_at timestamptz,
  p_passenger_count integer,
  p_cargo_description text,
  p_cargo_weight_kg numeric,
  p_luggage_notes text,
  p_special_notes text,
  p_stops jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_partner public.jfleet_partners%rowtype;
  v_inquiry_id uuid;
  v_itinerary_id uuid;
  v_due_at timestamptz;
  v_stop jsonb;
  v_sequence integer := 1;
  v_stop_type text;
  v_label text;
begin
  select *
    into v_partner
  from public.jfleet_partners
  where id = p_partner_id
    and status = 'active'
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_PARTNER_NOT_ACTIVE';
  end if;

  if p_scheduled_start_at is null or p_scheduled_start_at <= clock_timestamp() then
    raise exception 'JFLEET_TRIP_MUST_BE_IN_FUTURE';
  end if;

  if jsonb_typeof(coalesce(p_stops, '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_stops, '[]'::jsonb)) < 1 then
    raise exception 'JFLEET_ITINERARY_DESTINATION_REQUIRED';
  end if;

  v_due_at := clock_timestamp() + make_interval(mins => v_partner.quote_tat_minutes);

  insert into public.jfleet_inquiries(
    inquiry_code, passenger_user_id, partner_id, purpose,
    requested_vehicle_type, trip_mode, pickup_label, pickup_lat, pickup_lng,
    scheduled_start_at, scheduled_end_at, passenger_count,
    cargo_description, cargo_weight_kg, luggage_notes, special_notes,
    status, current_itinerary_version, quote_due_at
  ) values (
    upper(trim(p_inquiry_code)), p_passenger_user_id, p_partner_id, p_purpose,
    p_requested_vehicle_type, p_trip_mode, trim(p_pickup_label), p_pickup_lat, p_pickup_lng,
    p_scheduled_start_at, p_scheduled_end_at, p_passenger_count,
    nullif(trim(coalesce(p_cargo_description,'')),''), p_cargo_weight_kg,
    nullif(trim(coalesce(p_luggage_notes,'')),''), nullif(trim(coalesce(p_special_notes,'')),''),
    'quote_requested', 1, v_due_at
  )
  returning id into v_inquiry_id;

  insert into public.jfleet_itineraries(
    inquiry_id, version_no, source, status
  ) values (
    v_inquiry_id, 1, 'customer', 'current'
  )
  returning id into v_itinerary_id;

  insert into public.jfleet_itinerary_stops(
    itinerary_id, sequence_no, stop_type, location_label, lat, lng
  ) values (
    v_itinerary_id, 0, 'pickup', trim(p_pickup_label), p_pickup_lat, p_pickup_lng
  );

  for v_stop in
    select value from jsonb_array_elements(p_stops)
  loop
    v_label := trim(coalesce(v_stop->>'label',''));
    v_stop_type := lower(trim(coalesce(v_stop->>'stop_type','stop')));

    if v_label = '' then
      raise exception 'JFLEET_ITINERARY_STOP_LABEL_REQUIRED';
    end if;

    if v_stop_type not in ('stop','destination','return') then
      raise exception 'JFLEET_ITINERARY_STOP_TYPE_INVALID';
    end if;

    insert into public.jfleet_itinerary_stops(
      itinerary_id, sequence_no, stop_type, location_label, lat, lng, notes
    ) values (
      v_itinerary_id,
      v_sequence,
      v_stop_type,
      v_label,
      case when nullif(v_stop->>'lat','') is null then null else (v_stop->>'lat')::double precision end,
      case when nullif(v_stop->>'lng','') is null then null else (v_stop->>'lng')::double precision end,
      nullif(trim(coalesce(v_stop->>'notes','')),'')
    );

    v_sequence := v_sequence + 1;
  end loop;

  insert into public.jfleet_events(
    inquiry_id, actor_type, actor_id, event_type, details
  ) values (
    v_inquiry_id,
    'customer',
    p_passenger_user_id::text,
    'inquiry_submitted',
    jsonb_build_object(
      'inquiry_code', upper(trim(p_inquiry_code)),
      'quote_due_at', v_due_at,
      'quote_tat_minutes', v_partner.quote_tat_minutes,
      'itinerary_version', 1
    )
  );

  return jsonb_build_object(
    'ok', true,
    'inquiry_id', v_inquiry_id,
    'inquiry_code', upper(trim(p_inquiry_code)),
    'status', 'quote_requested',
    'quote_due_at', v_due_at,
    'partner_id', p_partner_id
  );
end;
$$;

create or replace function public.jfleet_accept_quote_v1(
  p_inquiry_id uuid,
  p_quote_id uuid,
  p_passenger_user_id uuid,
  p_booking_code text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_inquiry public.jfleet_inquiries%rowtype;
  v_quote public.jfleet_quotes%rowtype;
  v_partner public.jfleet_partners%rowtype;
  v_booking public.jfleet_bookings%rowtype;
begin
  select *
    into v_inquiry
  from public.jfleet_inquiries
  where id = p_inquiry_id
  for update;

  if v_inquiry.id is null or v_inquiry.passenger_user_id is distinct from p_passenger_user_id then
    raise exception 'JFLEET_INQUIRY_NOT_FOUND';
  end if;

  if v_inquiry.converted_booking_id is not null then
    select *
      into v_booking
    from public.jfleet_bookings
    where id = v_inquiry.converted_booking_id;

    return jsonb_build_object(
      'ok', true,
      'already_converted', true,
      'booking_id', v_booking.id,
      'booking_code', v_booking.booking_code,
      'status', v_booking.status,
      'payment_status', v_booking.payment_status,
      'reservation_required_amount', v_booking.reservation_required_amount,
      'cancellation_free_until', v_booking.cancellation_free_until
    );
  end if;

  select *
    into v_quote
  from public.jfleet_quotes
  where id = p_quote_id
    and inquiry_id = p_inquiry_id
  for update;

  if v_quote.id is null then
    raise exception 'JFLEET_QUOTE_NOT_FOUND';
  end if;

  if v_quote.status <> 'sent' then
    raise exception 'JFLEET_QUOTE_NOT_ACCEPTABLE';
  end if;

  if v_quote.valid_until <= p_now then
    update public.jfleet_quotes
    set status = 'expired'
    where id = v_quote.id;

    update public.jfleet_inquiries
    set status = 'expired'
    where id = v_inquiry.id;

    raise exception 'JFLEET_QUOTE_EXPIRED';
  end if;

  if v_quote.itinerary_id is distinct from (
    select i.id
    from public.jfleet_itineraries i
    where i.inquiry_id = v_inquiry.id
      and i.status = 'current'
    order by i.version_no desc
    limit 1
  ) then
    raise exception 'JFLEET_QUOTE_ITINERARY_NOT_CURRENT';
  end if;

  select *
    into v_partner
  from public.jfleet_partners
  where id = v_inquiry.partner_id
    and status = 'active'
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_PARTNER_NOT_ACTIVE';
  end if;

  insert into public.jfleet_bookings(
    booking_code,
    inquiry_id,
    accepted_quote_id,
    passenger_user_id,
    partner_id,
    current_itinerary_id,
    scheduled_start_at,
    scheduled_end_at,
    original_quote_amount,
    reservation_percent,
    free_cancel_hours,
    late_cancel_percent,
    commission_percent,
    minimum_commission,
    status,
    payment_status
  ) values (
    upper(trim(p_booking_code)),
    v_inquiry.id,
    v_quote.id,
    v_inquiry.passenger_user_id,
    v_inquiry.partner_id,
    v_quote.itinerary_id,
    v_inquiry.scheduled_start_at,
    v_inquiry.scheduled_end_at,
    v_quote.total_amount,
    greatest(v_partner.reservation_percent, 20.00),
    v_partner.free_cancel_hours,
    v_partner.late_cancel_percent,
    v_partner.commission_percent,
    v_partner.minimum_commission,
    'reservation_pending',
    'reservation_pending'
  )
  returning * into v_booking;

  update public.jfleet_quotes
  set status = case when id = v_quote.id then 'accepted' else 'superseded' end,
      accepted_at = case when id = v_quote.id then p_now else accepted_at end
  where inquiry_id = v_inquiry.id
    and status = 'sent';

  update public.jfleet_inquiries
  set status = 'converted',
      accepted_quote_id = v_quote.id,
      converted_booking_id = v_booking.id
  where id = v_inquiry.id;

  insert into public.jfleet_events(
    inquiry_id, booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_inquiry.id,
    v_booking.id,
    'customer',
    p_passenger_user_id::text,
    'quote_accepted_booking_created',
    jsonb_build_object(
      'quote_id', v_quote.id,
      'quote_version', v_quote.version_no,
      'original_quote_amount', v_quote.total_amount,
      'reservation_percent', v_booking.reservation_percent,
      'reservation_required_amount', v_booking.reservation_required_amount,
      'cancellation_free_until', v_booking.cancellation_free_until
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'already_converted', false,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'status', v_booking.status,
    'payment_status', v_booking.payment_status,
    'original_quote_amount', v_booking.original_quote_amount,
    'reservation_percent', v_booking.reservation_percent,
    'reservation_required_amount', v_booking.reservation_required_amount,
    'cancellation_free_until', v_booking.cancellation_free_until
  );
end;
$;

create or replace function public.jfleet_owner_confirm_payment_v1(
  p_booking_id uuid,
  p_owner_user_id uuid,
  p_payment_kind text,
  p_amount numeric,
  p_payment_channel text,
  p_payment_reference text,
  p_idempotency_key text,
  p_notes text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_booking public.jfleet_bookings%rowtype;
  v_partner public.jfleet_partners%rowtype;
  v_existing public.jfleet_payments%rowtype;
  v_payment_id uuid;
  v_paid numeric(12,2);
  v_status text;
  v_payment_status text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'JFLEET_PAYMENT_AMOUNT_INVALID';
  end if;

  if lower(trim(coalesce(p_payment_kind,''))) not in ('reservation','balance','full_payment') then
    raise exception 'JFLEET_PAYMENT_KIND_INVALID';
  end if;

  if length(trim(coalesce(p_idempotency_key,''))) < 8 then
    raise exception 'JFLEET_PAYMENT_IDEMPOTENCY_REQUIRED';
  end if;

  select *
    into v_booking
  from public.jfleet_bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  select *
    into v_partner
  from public.jfleet_partners
  where id = v_booking.partner_id
    and owner_user_id = p_owner_user_id
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_OWNER_NOT_AUTHORIZED';
  end if;

  if v_booking.status in ('completed','cancelled_customer','cancelled_operator') then
    raise exception 'JFLEET_BOOKING_PAYMENT_CLOSED';
  end if;

  select *
    into v_existing
  from public.jfleet_payments
  where idempotency_key = trim(p_idempotency_key);

  if v_existing.id is not null then
    if v_existing.booking_id is distinct from v_booking.id
       or v_existing.amount is distinct from p_amount
       or v_existing.payment_kind is distinct from lower(trim(p_payment_kind)) then
      raise exception 'JFLEET_PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
  else
    insert into public.jfleet_payments(
      booking_id,
      payment_kind,
      amount,
      status,
      payment_channel,
      payment_reference,
      idempotency_key,
      received_by,
      confirmed_by_owner_user_id,
      paid_at,
      confirmed_at,
      notes,
      created_at,
      updated_at
    ) values (
      v_booking.id,
      lower(trim(p_payment_kind)),
      round(p_amount, 2),
      'confirmed',
      nullif(trim(coalesce(p_payment_channel,'')),''),
      nullif(trim(coalesce(p_payment_reference,'')),''),
      trim(p_idempotency_key),
      'transport_partner_owner',
      p_owner_user_id,
      p_now,
      p_now,
      nullif(trim(coalesce(p_notes,'')),''),
      p_now,
      p_now
    )
    returning id into v_payment_id;
  end if;

  select coalesce(sum(p.amount),0)
    into v_paid
  from public.jfleet_payments p
  where p.booking_id = v_booking.id
    and p.status = 'confirmed'
    and p.payment_kind in ('reservation','balance','full_payment');

  if v_paid >= v_booking.original_quote_amount then
    v_payment_status := 'fully_paid';
    v_status := case
      when v_booking.assigned_driver_id is not null
       and v_booking.assigned_vehicle_id is not null then 'assigned'
      else greatest(v_booking.status, 'confirmed')
    end;
  elsif v_paid >= v_booking.reservation_required_amount then
    v_payment_status := 'reservation_paid';
    v_status := case
      when v_booking.status = 'reservation_pending' then 'confirmed'
      else v_booking.status
    end;
  else
    v_payment_status := 'reservation_pending';
    v_status := v_booking.status;
  end if;

  update public.jfleet_bookings
  set payment_status = v_payment_status,
      status = v_status,
      reservation_paid_at = case
        when v_paid >= reservation_required_amount
        then coalesce(reservation_paid_at, p_now)
        else reservation_paid_at
      end,
      fully_paid_at = case
        when v_paid >= original_quote_amount
        then coalesce(fully_paid_at, p_now)
        else fully_paid_at
      end
  where id = v_booking.id
  returning * into v_booking;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'owner',
    p_owner_user_id::text,
    'payment_confirmed',
    jsonb_build_object(
      'payment_kind', lower(trim(p_payment_kind)),
      'amount', round(p_amount,2),
      'confirmed_original_payments', v_paid,
      'payment_status', v_booking.payment_status,
      'booking_status', v_booking.status,
      'idempotency_key', trim(p_idempotency_key)
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'confirmed_original_payments', v_paid,
    'reservation_required_amount', v_booking.reservation_required_amount,
    'original_quote_amount', v_booking.original_quote_amount,
    'payment_status', v_booking.payment_status,
    'booking_status', v_booking.status,
    'fully_paid', v_paid >= v_booking.original_quote_amount
  );
end;
$;

create or replace function public.jfleet_cancel_customer_v1(
  p_booking_id uuid,
  p_passenger_user_id uuid,
  p_reason text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_booking public.jfleet_bookings%rowtype;
  v_paid numeric(12,2);
  v_penalty numeric(12,2);
  v_refund numeric(12,2);
  v_late boolean;
begin
  select *
    into v_booking
  from public.jfleet_bookings
  where id = p_booking_id
    and passenger_user_id = p_passenger_user_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  if v_booking.status in ('on_trip','completed','cancelled_customer','cancelled_operator') then
    raise exception 'JFLEET_BOOKING_NOT_CANCELLABLE';
  end if;

  if p_now >= v_booking.scheduled_start_at then
    raise exception 'JFLEET_BOOKING_ALREADY_DUE';
  end if;

  select coalesce(sum(p.amount),0)
    into v_paid
  from public.jfleet_payments p
  where p.booking_id = v_booking.id
    and p.status = 'confirmed'
    and p.payment_kind in ('reservation','balance','full_payment');

  v_late := p_now > v_booking.cancellation_free_until;
  v_penalty := case
    when v_late
      then round(v_booking.original_quote_amount * v_booking.late_cancel_percent / 100.0, 2)
    else 0
  end;
  v_penalty := least(v_penalty, v_paid);
  v_refund := greatest(v_paid - v_penalty, 0);

  update public.jfleet_bookings
  set status = 'cancelled_customer',
      payment_status = case
        when v_refund > 0 then 'refund_pending'
        else 'refunded'
      end,
      cancelled_at = p_now,
      cancelled_by = 'customer',
      cancellation_reason = nullif(trim(coalesce(p_reason,'')),''),
      cancellation_penalty_amount = v_penalty,
      refund_amount = v_refund
  where id = v_booking.id
  returning * into v_booking;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'customer',
    p_passenger_user_id::text,
    'booking_cancelled_customer',
    jsonb_build_object(
      'late_cancellation', v_late,
      'cancellation_free_until', v_booking.cancellation_free_until,
      'late_cancel_percent', v_booking.late_cancel_percent,
      'original_quote_amount', v_booking.original_quote_amount,
      'confirmed_original_payments', v_paid,
      'penalty_amount', v_penalty,
      'refund_amount', v_refund
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'status', v_booking.status,
    'late_cancellation', v_late,
    'cancellation_free_until', v_booking.cancellation_free_until,
    'penalty_amount', v_penalty,
    'refund_amount', v_refund,
    'payment_status', v_booking.payment_status
  );
end;
$;

create or replace function public.jfleet_cancel_operator_v1(
  p_booking_id uuid,
  p_owner_user_id uuid,
  p_reason text,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $
declare
  v_booking public.jfleet_bookings%rowtype;
  v_partner public.jfleet_partners%rowtype;
  v_paid numeric(12,2);
begin
  select *
    into v_booking
  from public.jfleet_bookings
  where id = p_booking_id
  for update;

  if v_booking.id is null then
    raise exception 'JFLEET_BOOKING_NOT_FOUND';
  end if;

  select *
    into v_partner
  from public.jfleet_partners
  where id = v_booking.partner_id
    and owner_user_id = p_owner_user_id
  for share;

  if v_partner.id is null then
    raise exception 'JFLEET_OWNER_NOT_AUTHORIZED';
  end if;

  if v_booking.status in ('on_trip','completed','cancelled_customer','cancelled_operator') then
    raise exception 'JFLEET_BOOKING_NOT_CANCELLABLE';
  end if;

  select coalesce(sum(p.amount),0)
    into v_paid
  from public.jfleet_payments p
  where p.booking_id = v_booking.id
    and p.status = 'confirmed'
    and p.payment_kind in ('reservation','balance','full_payment');

  update public.jfleet_bookings
  set status = 'cancelled_operator',
      payment_status = case when v_paid > 0 then 'refund_pending' else 'refunded' end,
      cancelled_at = p_now,
      cancelled_by = 'operator',
      cancellation_reason = nullif(trim(coalesce(p_reason,'')),''),
      cancellation_penalty_amount = 0,
      refund_amount = v_paid
  where id = v_booking.id
  returning * into v_booking;

  insert into public.jfleet_events(
    booking_id, actor_type, actor_id, event_type, details, created_at
  ) values (
    v_booking.id,
    'owner',
    p_owner_user_id::text,
    'booking_cancelled_operator',
    jsonb_build_object(
      'confirmed_original_payments', v_paid,
      'penalty_amount', 0,
      'refund_amount', v_paid
    ),
    p_now
  );

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'status', v_booking.status,
    'penalty_amount', 0,
    'refund_amount', v_paid,
    'payment_status', v_booking.payment_status
  );
end;
$;

create index jfleet_inquiries_passenger_created_idx
  on public.jfleet_inquiries(passenger_user_id, created_at desc);
create index jfleet_inquiries_partner_status_due_idx
  on public.jfleet_inquiries(partner_id, status, quote_due_at);
create index jfleet_quotes_inquiry_status_idx
  on public.jfleet_quotes(inquiry_id, status, version_no desc);
create index jfleet_bookings_partner_schedule_idx
  on public.jfleet_bookings(partner_id, scheduled_start_at, status);
create index jfleet_bookings_passenger_schedule_idx
  on public.jfleet_bookings(passenger_user_id, scheduled_start_at desc);
create index jfleet_payments_booking_status_idx
  on public.jfleet_payments(booking_id, status);
create index jfleet_addons_booking_status_idx
  on public.jfleet_addons(booking_id, status);
create index jfleet_route_points_booking_time_idx
  on public.jfleet_route_points(booking_id, captured_at);
create index jfleet_route_deviation_booking_status_idx
  on public.jfleet_route_deviation_events(booking_id, event_status, detected_at desc);
create index jfleet_events_inquiry_time_idx
  on public.jfleet_events(inquiry_id, created_at);
create index jfleet_events_booking_time_idx
  on public.jfleet_events(booking_id, created_at);

alter table public.jfleet_partners enable row level security;
alter table public.jfleet_partner_documents enable row level security;
alter table public.jfleet_vehicles enable row level security;
alter table public.jfleet_vehicle_documents enable row level security;
alter table public.jfleet_drivers enable row level security;
alter table public.jfleet_driver_documents enable row level security;
alter table public.jfleet_inquiries enable row level security;
alter table public.jfleet_itineraries enable row level security;
alter table public.jfleet_itinerary_stops enable row level security;
alter table public.jfleet_quotes enable row level security;
alter table public.jfleet_quote_items enable row level security;
alter table public.jfleet_bookings enable row level security;
alter table public.jfleet_payments enable row level security;
alter table public.jfleet_addons enable row level security;
alter table public.jfleet_driver_locations enable row level security;
alter table public.jfleet_route_points enable row level security;
alter table public.jfleet_route_deviation_events enable row level security;
alter table public.jfleet_events enable row level security;

revoke all on table public.jfleet_partners from anon, authenticated;
revoke all on table public.jfleet_partner_documents from anon, authenticated;
revoke all on table public.jfleet_vehicles from anon, authenticated;
revoke all on table public.jfleet_vehicle_documents from anon, authenticated;
revoke all on table public.jfleet_drivers from anon, authenticated;
revoke all on table public.jfleet_driver_documents from anon, authenticated;
revoke all on table public.jfleet_inquiries from anon, authenticated;
revoke all on table public.jfleet_itineraries from anon, authenticated;
revoke all on table public.jfleet_itinerary_stops from anon, authenticated;
revoke all on table public.jfleet_quotes from anon, authenticated;
revoke all on table public.jfleet_quote_items from anon, authenticated;
revoke all on table public.jfleet_bookings from anon, authenticated;
revoke all on table public.jfleet_payments from anon, authenticated;
revoke all on table public.jfleet_addons from anon, authenticated;
revoke all on table public.jfleet_driver_locations from anon, authenticated;
revoke all on table public.jfleet_route_points from anon, authenticated;
revoke all on table public.jfleet_route_deviation_events from anon, authenticated;
revoke all on table public.jfleet_events from anon, authenticated;

revoke all on function public.jfleet_touch_updated_at_v1() from public, anon, authenticated;
revoke all on function public.jfleet_set_booking_policy_snapshots_v1() from public, anon, authenticated;
revoke all on function public.jfleet_guard_assignment_v1() from public, anon, authenticated;
revoke all on function public.jfleet_guard_trip_start_v1() from public, anon, authenticated;
revoke all on function public.jfleet_create_inquiry_v1(
  text, uuid, uuid, text, text, text, text, double precision, double precision,
  timestamptz, timestamptz, integer, text, numeric, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.jfleet_accept_quote_v1(
  uuid, uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.jfleet_owner_confirm_payment_v1(
  uuid, uuid, text, numeric, text, text, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.jfleet_cancel_customer_v1(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.jfleet_cancel_operator_v1(
  uuid, uuid, text, timestamptz
) from public, anon, authenticated;

comment on table public.jfleet_inquiries is
  'JFleet canvassing/request-for-quotation records. Not counted as confirmed bookings.';
comment on table public.jfleet_quotes is
  'Versioned owner quotations. Superseded quotes remain for audit.';
comment on table public.jfleet_bookings is
  'Confirmed JFleet hires created only after quote acceptance. Original quotation must be fully paid before On Trip.';
comment on table public.jfleet_addons is
  'Approved in-trip side trips/additional charges. Paid add-ons increase final trip value and JRide commission base.';
