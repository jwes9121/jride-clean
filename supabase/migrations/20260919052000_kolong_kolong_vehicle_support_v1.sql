-- JRide Kolong-Kolong support for Errand and AgriMarket.
-- Canonical database value: kolong_kolong
-- User-facing label: Kolong-Kolong
-- Cargo ceiling: 200 kg.
-- Existing Motorcycle/Tricycle pricing is preserved. No new Kolong-Kolong fee is introduced.

alter table public.errand_pricing_settings
  add column if not exists kolong_kolong_max_kg numeric(10,3) not null default 200;

update public.errand_pricing_settings
set kolong_kolong_max_kg = 200
where singleton = true
  and kolong_kolong_max_kg is distinct from 200;

alter table public.agrimarket_pricing_settings
  add column if not exists kolong_kolong_max_kg numeric(10,3) not null default 200;

update public.agrimarket_pricing_settings
set kolong_kolong_max_kg = 200
where id = 1
  and kolong_kolong_max_kg is distinct from 200;

alter table public.errand_jobs
  drop constraint if exists errand_jobs_vehicle_requirement_chk;
alter table public.errand_jobs
  add constraint errand_jobs_vehicle_requirement_chk
  check (
    vehicle_requirement is null
    or vehicle_requirement = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text,'either'::text])
  );

alter table public.bookings
  drop constraint if exists bookings_requested_vehicle_type_chk;
alter table public.bookings
  add constraint bookings_requested_vehicle_type_chk
  check (
    requested_vehicle_type is null
    or requested_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_products
  drop constraint if exists agrimarket_products_vehicle_chk;
alter table public.agrimarket_products
  add constraint agrimarket_products_vehicle_chk
  check (
    vehicle_requirement = any (array['either'::text,'motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_preferred_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_preferred_vehicle_chk
  check (preferred_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text]));

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_required_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_required_vehicle_chk
  check (required_vehicle_type = any (array['either'::text,'motorcycle'::text,'tricycle'::text,'kolong_kolong'::text]));

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_checkout_preferred_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_checkout_preferred_vehicle_chk
  check (
    checkout_preferred_vehicle_type is null
    or checkout_preferred_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_product_required_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_product_required_vehicle_chk
  check (
    product_required_vehicle_type is null
    or product_required_vehicle_type = any (array['either'::text,'motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_customer_approved_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_customer_approved_vehicle_chk
  check (
    customer_approved_vehicle_type is null
    or customer_approved_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_customer_reapproval_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_customer_reapproval_vehicle_chk
  check (
    customer_reapproval_proposed_vehicle_type is null
    or customer_reapproval_proposed_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_selected_vehicle_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_selected_vehicle_chk
  check (
    selected_vehicle_type is null
    or selected_vehicle_type = any (array['motorcycle'::text,'tricycle'::text,'kolong_kolong'::text])
  );

alter table public.agrimarket_orders
  drop constraint if exists agrimarket_orders_confirmed_cargo_weight_band_chk;
alter table public.agrimarket_orders
  add constraint agrimarket_orders_confirmed_cargo_weight_band_chk
  check (
    confirmed_cargo_weight_band is null
    or confirmed_cargo_weight_band = any (
      array['1_15'::text,'16_25'::text,'26_50'::text,'51_100'::text,'101_200'::text,'over_100'::text,'over_200'::text]
    )
  );

create or replace function public.jride_normalize_vehicle_type_v1(p_vehicle text)
returns text
language sql
immutable
set search_path to 'public'
as $function$
  select case
    when lower(trim(coalesce(p_vehicle,''))) = '' then ''
    when lower(trim(coalesce(p_vehicle,''))) like '%kolong%'
      or lower(trim(coalesce(p_vehicle,''))) like '%kulong%'
      or lower(trim(coalesce(p_vehicle,''))) like '%sidecar%'
      then 'kolong_kolong'
    when lower(trim(coalesce(p_vehicle,''))) like '%motor%'
      or lower(trim(coalesce(p_vehicle,''))) like '%moto%'
      or lower(trim(coalesce(p_vehicle,''))) like '%bike%'
      then 'motorcycle'
    when lower(trim(coalesce(p_vehicle,''))) like '%trike%'
      or lower(trim(coalesce(p_vehicle,''))) like '%tricycle%'
      or lower(trim(coalesce(p_vehicle,''))) like '%toda%'
      then 'tricycle'
    else lower(trim(coalesce(p_vehicle,'')))
  end;
$function$;

create or replace function public.jride_vehicle_rank_v1(p_vehicle text)
returns integer
language sql
immutable
set search_path to 'public'
as $function$
  select case public.jride_normalize_vehicle_type_v1(p_vehicle)
    when 'either' then 0
    when 'motorcycle' then 1
    when 'tricycle' then 2
    when 'kolong_kolong' then 3
    else -1
  end;
$function$;

create or replace function public.create_errand_booking_v1(
  p_booking_code text,
  p_user_id uuid,
  p_passenger_name text,
  p_town text,
  p_stage0_label text,
  p_stage0_lat numeric,
  p_stage0_lng numeric,
  p_task_description text,
  p_stops jsonb,
  p_final_destination_mode text,
  p_final_label text default null::text,
  p_final_lat numeric default null::numeric,
  p_final_lng numeric default null::numeric,
  p_is_pabili boolean default false,
  p_estimated_purchase_amount numeric default null::numeric,
  p_estimated_cargo_weight_kg numeric default null::numeric,
  p_vehicle_requirement text default 'either'::text,
  p_accompanied boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_verification_status text;
  v_settings public.errand_pricing_settings%rowtype;
  v_booking_id uuid;
  v_stop jsonb;
  v_stop_count integer;
  v_sequence integer := 0;
  v_active record;
  v_vehicle text;
  v_weight numeric;
  v_cargo_class text;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'MISSING_PASSENGER_ID');
  end if;

  select pv.status into v_verification_status
  from public.passenger_verifications pv
  where pv.user_id = p_user_id
  limit 1;

  if v_verification_status is distinct from 'approved_admin' then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_REQUIRES_VERIFIED_PASSENGER');
  end if;

  if length(trim(coalesce(p_passenger_name, ''))) < 2 then
    return jsonb_build_object('ok', false, 'error', 'PASSENGER_NAME_REQUIRED');
  end if;
  if length(trim(coalesce(p_town, ''))) < 2 then
    return jsonb_build_object('ok', false, 'error', 'STAGE0_TOWN_REQUIRED');
  end if;
  if length(trim(coalesce(p_stage0_label, ''))) < 2
     or p_stage0_lat is null or p_stage0_lng is null then
    return jsonb_build_object('ok', false, 'error', 'STAGE0_LOCATION_REQUIRED');
  end if;
  if length(trim(coalesce(p_task_description, ''))) < 3 then
    return jsonb_build_object('ok', false, 'error', 'TASK_DESCRIPTION_REQUIRED');
  end if;
  if p_final_destination_mode not in ('return_to_customer', 'different_address') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_FINAL_DESTINATION_MODE');
  end if;
  if p_final_destination_mode = 'different_address'
     and (
       length(trim(coalesce(p_final_label, ''))) < 2
       or p_final_lat is null
       or p_final_lng is null
     ) then
    return jsonb_build_object('ok', false, 'error', 'FINAL_DESTINATION_REQUIRED');
  end if;
  if p_stops is null or jsonb_typeof(p_stops) <> 'array' or jsonb_array_length(p_stops) < 1 then
    return jsonb_build_object('ok', false, 'error', 'AT_LEAST_ONE_STOP_REQUIRED');
  end if;

  v_stop_count := jsonb_array_length(p_stops);

  select * into v_active
  from public.bookings b
  where b.created_by_user_id = p_user_id
    and b.status in (
      'requested','pending','searching','assigned','accepted','fare_proposed',
      'ready','on_the_way','arrived','on_trip'
    )
  order by b.created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'error', 'PASSENGER_ALREADY_HAS_ACTIVE_BOOKING',
      'booking_id', v_active.id,
      'booking_code', v_active.booking_code,
      'status', v_active.status
    );
  end if;

  select * into v_settings
  from public.errand_pricing_settings
  where singleton = true;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_PRICING_NOT_CONFIGURED');
  end if;

  v_weight := greatest(coalesce(p_estimated_cargo_weight_kg, 0), 0);
  if v_weight > v_settings.kolong_kolong_max_kg then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_CARGO_EXCEEDS_NORMAL_MAX',
      'max_kg', v_settings.kolong_kolong_max_kg
    );
  end if;

  if v_weight <= v_settings.standard_max_kg then
    v_cargo_class := 'standard';
  elsif v_weight <= v_settings.motorcycle_max_kg then
    v_cargo_class := 'heavy_16_25';
  elsif v_weight <= v_settings.tricycle_normal_max_kg then
    v_cargo_class := 'heavy_26_50';
  elsif v_weight <= v_settings.tricycle_extra_heavy_max_kg then
    v_cargo_class := 'extra_heavy_51_100';
  else
    v_cargo_class := 'extra_heavy_101_200';
  end if;

  v_vehicle := public.jride_normalize_vehicle_type_v1(coalesce(p_vehicle_requirement, 'either'));
  if v_vehicle not in ('motorcycle','tricycle','kolong_kolong','either') then
    return jsonb_build_object('ok', false, 'error', 'INVALID_VEHICLE_REQUIREMENT');
  end if;

  if v_vehicle = 'motorcycle' and v_weight > v_settings.motorcycle_max_kg then
    return jsonb_build_object(
      'ok', false, 'error', 'ERRAND_VEHICLE_CAPACITY_EXCEEDED',
      'vehicle_requirement', v_vehicle, 'max_kg', v_settings.motorcycle_max_kg
    );
  elsif v_vehicle = 'tricycle' and v_weight > v_settings.tricycle_extra_heavy_max_kg then
    return jsonb_build_object(
      'ok', false, 'error', 'ERRAND_VEHICLE_CAPACITY_EXCEEDED',
      'vehicle_requirement', v_vehicle, 'max_kg', v_settings.tricycle_extra_heavy_max_kg
    );
  elsif v_vehicle = 'kolong_kolong' and v_weight > v_settings.kolong_kolong_max_kg then
    return jsonb_build_object(
      'ok', false, 'error', 'ERRAND_VEHICLE_CAPACITY_EXCEEDED',
      'vehicle_requirement', v_vehicle, 'max_kg', v_settings.kolong_kolong_max_kg
    );
  end if;

  insert into public.bookings (
    booking_code, passenger_name, service_type, trip_type, created_by_user_id,
    status, town, from_label, to_label, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    base_fee, pickup_distance_fee, distance_fare, waiting_minutes, stop_count,
    elevation_surcharge, heavy_load_fee, company_cut
  )
  values (
    trim(p_booking_code), trim(p_passenger_name), 'errand', 'errand', p_user_id,
    'requested', trim(p_town), trim(p_stage0_label),
    case when p_final_destination_mode = 'return_to_customer'
      then trim(p_stage0_label) else trim(p_final_label) end,
    p_stage0_lat, p_stage0_lng,
    case when p_final_destination_mode = 'return_to_customer' then p_stage0_lat else p_final_lat end,
    case when p_final_destination_mode = 'return_to_customer' then p_stage0_lng else p_final_lng end,
    v_settings.base_fare, 0, 0, 0, v_stop_count, 0, 0, v_settings.company_cut
  )
  returning id into v_booking_id;

  insert into public.errand_jobs (
    booking_id, task_description, is_pabili, estimated_purchase_amount,
    declared_stop_count, final_destination_mode, final_label, final_lat, final_lng,
    vehicle_requirement, estimated_cargo_weight_kg, cargo_classification,
    accompanied, errand_stage
  )
  values (
    v_booking_id,
    trim(p_task_description),
    coalesce(p_is_pabili, false),
    case when coalesce(p_is_pabili, false)
      then greatest(coalesce(p_estimated_purchase_amount, 0), 0) else null end,
    v_stop_count,
    p_final_destination_mode,
    case when p_final_destination_mode = 'return_to_customer'
      then trim(p_stage0_label) else trim(p_final_label) end,
    case when p_final_destination_mode = 'return_to_customer' then p_stage0_lat else p_final_lat end,
    case when p_final_destination_mode = 'return_to_customer' then p_stage0_lng else p_final_lng end,
    v_vehicle,
    case when p_estimated_cargo_weight_kg is null then null else v_weight end,
    v_cargo_class,
    coalesce(p_accompanied, false),
    'matching'
  );

  for v_stop in select value from jsonb_array_elements(p_stops)
  loop
    v_sequence := v_sequence + 1;
    if length(trim(coalesce(v_stop->>'location_label', ''))) < 2 then
      raise exception 'ERRAND_STOP_LOCATION_REQUIRED_AT_SEQUENCE_%', v_sequence
        using errcode = 'P0001';
    end if;

    insert into public.errand_stops (
      booking_id, sequence, place_name, location_label, lat, lng, instructions, status
    )
    values (
      v_booking_id, v_sequence,
      nullif(trim(coalesce(v_stop->>'place_name', '')), ''),
      trim(v_stop->>'location_label'),
      nullif(v_stop->>'lat', '')::numeric,
      nullif(v_stop->>'lng', '')::numeric,
      nullif(trim(coalesce(v_stop->>'instructions', '')), ''),
      'pending'
    );
  end loop;

  return jsonb_build_object(
    'ok', true,
    'booking_id', v_booking_id,
    'booking_code', trim(p_booking_code),
    'status', 'requested',
    'errand_stage', 'matching',
    'stop_count', v_stop_count,
    'vehicle_requirement', v_vehicle,
    'cargo_classification', v_cargo_class,
    'working_base_fare', v_settings.base_fare,
    'working_route_rate_per_km', v_settings.route_rate_per_km,
    'company_cut', v_settings.company_cut
  );
end;
$function$;

create or replace function public.errand_sync_requested_vehicle_type()
returns trigger
language plpgsql
as $function$
begin
  update public.bookings
  set requested_vehicle_type = case
        when new.vehicle_requirement in ('motorcycle','tricycle','kolong_kolong')
          then new.vehicle_requirement
        else null
      end,
      updated_at = now()
  where id = new.booking_id;
  return new;
end;
$function$;

create or replace function public.errand_enforce_stage0_assignment_guard()
returns trigger
language plpgsql
as $function$
declare
  v_driver_id uuid;
  v_driver_vehicle text;
  v_lat double precision;
  v_lng double precision;
  v_required_vehicle text;
  v_weight numeric;
  v_settings public.errand_pricing_settings%rowtype;
begin
  if lower(coalesce(new.service_type,'')) <> 'errand' then return new; end if;
  v_driver_id := coalesce(new.assigned_driver_id,new.driver_id);
  if v_driver_id is null then return new; end if;

  select dl.lat, dl.lng, public.jride_normalize_vehicle_type_v1(dl.vehicle_type)
  into v_lat, v_lng, v_driver_vehicle
  from public.driver_locations dl
  where dl.driver_id=v_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if v_lat is null or v_lng is null then
    raise exception 'ERRAND_DRIVER_LOCATION_REQUIRED' using errcode='P0001';
  end if;

  select
    public.jride_normalize_vehicle_type_v1(ej.vehicle_requirement),
    greatest(coalesce(ej.confirmed_cargo_weight_kg,ej.estimated_cargo_weight_kg,0),0)
  into v_required_vehicle, v_weight
  from public.errand_jobs ej
  where ej.booking_id=new.id;

  select * into v_settings
  from public.errand_pricing_settings
  where singleton=true;

  if v_required_vehicle in ('motorcycle','tricycle','kolong_kolong')
     and v_driver_vehicle <> v_required_vehicle then
    raise exception 'ERRAND_REQUIRED_VEHICLE_MISMATCH' using errcode='P0001';
  end if;

  if v_driver_vehicle='motorcycle' and v_weight > v_settings.motorcycle_max_kg then
    raise exception 'ERRAND_DRIVER_CARGO_CAPACITY_EXCEEDED' using errcode='P0001';
  elsif v_driver_vehicle='tricycle' and v_weight > v_settings.tricycle_extra_heavy_max_kg then
    raise exception 'ERRAND_DRIVER_CARGO_CAPACITY_EXCEEDED' using errcode='P0001';
  elsif v_driver_vehicle='kolong_kolong' and v_weight > v_settings.kolong_kolong_max_kg then
    raise exception 'ERRAND_DRIVER_CARGO_CAPACITY_EXCEEDED' using errcode='P0001';
  elsif v_driver_vehicle not in ('motorcycle','tricycle','kolong_kolong') then
    raise exception 'ERRAND_DRIVER_VEHICLE_UNSUPPORTED' using errcode='P0001';
  end if;

  return new;
end;
$function$;

create or replace function public.errand_driver_save_stage0_review_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_task_description text,
  p_stops jsonb,
  p_final_destination_mode text,
  p_final_label text default null::text,
  p_final_lat numeric default null::numeric,
  p_final_lng numeric default null::numeric,
  p_is_pabili boolean default false,
  p_estimated_purchase_amount numeric default null::numeric,
  p_pabili_cash_received numeric default null::numeric,
  p_confirmed_cargo_weight_kg numeric default null::numeric,
  p_vehicle_requirement text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_job public.errand_jobs%rowtype;
  v_settings public.errand_pricing_settings%rowtype;
  v_driver_vehicle text;
  v_required_vehicle text;
  v_weight numeric;
  v_cargo_class text;
  v_vehicle_suitable boolean;
  v_capacity_ok boolean;
  v_stop jsonb;
  v_stop_count integer;
  v_sequence integer := 0;
  v_final_label text;
  v_final_lat numeric;
  v_final_lng numeric;
  v_cash numeric;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); end if;
  if lower(coalesce(v_booking.service_type,'')) <> 'errand' then
    return jsonb_build_object('ok',false,'error','NOT_ERRAND_BOOKING');
  end if;
  if coalesce(v_booking.assigned_driver_id,v_booking.driver_id) is distinct from p_driver_id then
    return jsonb_build_object('ok',false,'error','DRIVER_NOT_ASSIGNED');
  end if;
  if v_booking.status <> 'accepted' then
    return jsonb_build_object('ok',false,'error','ERRAND_STAGE0_REVIEW_NOT_EDITABLE','status',v_booking.status);
  end if;

  select * into v_job from public.errand_jobs where booking_id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_JOB_NOT_FOUND'); end if;
  if v_job.stage0_arrived_at is null then return jsonb_build_object('ok',false,'error','STAGE0_ARRIVAL_REQUIRED'); end if;
  if v_job.ready_for_customer_review_at is not null or v_job.task_locked then
    return jsonb_build_object('ok',false,'error','ERRAND_REVIEW_ALREADY_FINALIZED');
  end if;
  if length(trim(coalesce(p_task_description,''))) < 3 then
    return jsonb_build_object('ok',false,'error','TASK_DESCRIPTION_REQUIRED');
  end if;
  if p_stops is null or jsonb_typeof(p_stops)<>'array' or jsonb_array_length(p_stops)<1 then
    return jsonb_build_object('ok',false,'error','AT_LEAST_ONE_STOP_REQUIRED');
  end if;
  if p_final_destination_mode not in ('return_to_customer','different_address') then
    return jsonb_build_object('ok',false,'error','INVALID_FINAL_DESTINATION_MODE');
  end if;

  select * into v_settings from public.errand_pricing_settings where singleton=true;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_PRICING_NOT_CONFIGURED'); end if;

  v_weight := greatest(
    coalesce(p_confirmed_cargo_weight_kg,v_job.confirmed_cargo_weight_kg,v_job.estimated_cargo_weight_kg,0),0
  );
  if v_weight > v_settings.kolong_kolong_max_kg then
    return jsonb_build_object('ok',false,'error','ERRAND_CARGO_EXCEEDS_NORMAL_MAX','max_kg',v_settings.kolong_kolong_max_kg);
  end if;

  if v_weight <= v_settings.standard_max_kg then v_cargo_class := 'standard';
  elsif v_weight <= v_settings.motorcycle_max_kg then v_cargo_class := 'heavy_16_25';
  elsif v_weight <= v_settings.tricycle_normal_max_kg then v_cargo_class := 'heavy_26_50';
  elsif v_weight <= v_settings.tricycle_extra_heavy_max_kg then v_cargo_class := 'extra_heavy_51_100';
  else v_cargo_class := 'extra_heavy_101_200';
  end if;

  v_required_vehicle := public.jride_normalize_vehicle_type_v1(
    coalesce(p_vehicle_requirement,v_job.vehicle_requirement,'either')
  );
  if v_required_vehicle not in ('motorcycle','tricycle','kolong_kolong','either') then
    return jsonb_build_object('ok',false,'error','INVALID_VEHICLE_REQUIREMENT');
  end if;

  if v_required_vehicle='motorcycle' and v_weight > v_settings.motorcycle_max_kg then
    v_required_vehicle := 'either';
  elsif v_required_vehicle='tricycle' and v_weight > v_settings.tricycle_extra_heavy_max_kg then
    v_required_vehicle := 'kolong_kolong';
  end if;

  select public.jride_normalize_vehicle_type_v1(dl.vehicle_type)
  into v_driver_vehicle
  from public.driver_locations dl
  where dl.driver_id=p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  v_capacity_ok := case v_driver_vehicle
    when 'motorcycle' then v_weight <= v_settings.motorcycle_max_kg
    when 'tricycle' then v_weight <= v_settings.tricycle_extra_heavy_max_kg
    when 'kolong_kolong' then v_weight <= v_settings.kolong_kolong_max_kg
    else false
  end;

  v_vehicle_suitable := v_capacity_ok and (
    v_required_vehicle='either' or v_required_vehicle=coalesce(v_driver_vehicle,'')
  );

  if p_final_destination_mode='return_to_customer' then
    v_final_label := v_booking.from_label;
    v_final_lat := v_booking.pickup_lat;
    v_final_lng := v_booking.pickup_lng;
  else
    v_final_label := nullif(trim(coalesce(p_final_label,'')),'');
    v_final_lat := p_final_lat;
    v_final_lng := p_final_lng;
    if v_final_label is null or v_final_lat is null or v_final_lng is null then
      return jsonb_build_object('ok',false,'error','FINAL_DESTINATION_REQUIRED');
    end if;
  end if;

  if coalesce(p_is_pabili,false) then
    v_cash := coalesce(p_pabili_cash_received,v_job.pabili_cash_received);
    if not v_vehicle_suitable and coalesce(v_cash,0)>0 then
      return jsonb_build_object('ok',false,'error','PABILI_CASH_NOT_ALLOWED_BEFORE_VEHICLE_SUITABLE');
    end if;
  else
    v_cash := null;
  end if;

  v_stop_count := jsonb_array_length(p_stops);
  delete from public.errand_stops where booking_id=p_booking_id;

  for v_stop in select value from jsonb_array_elements(p_stops)
  loop
    v_sequence := v_sequence + 1;
    if length(trim(coalesce(v_stop->>'location_label',''))) < 2 then
      raise exception 'ERRAND_STOP_LOCATION_REQUIRED_AT_SEQUENCE_%',v_sequence using errcode='P0001';
    end if;
    insert into public.errand_stops(
      booking_id,sequence,place_name,location_label,lat,lng,instructions,status
    ) values(
      p_booking_id,v_sequence,
      nullif(trim(coalesce(v_stop->>'place_name','')),''),
      trim(v_stop->>'location_label'),
      nullif(v_stop->>'lat','')::numeric,
      nullif(v_stop->>'lng','')::numeric,
      nullif(trim(coalesce(v_stop->>'instructions','')),''),
      'pending'
    );
  end loop;

  update public.errand_jobs
  set task_description=trim(p_task_description),
      is_pabili=coalesce(p_is_pabili,false),
      estimated_purchase_amount=case
        when coalesce(p_is_pabili,false)
          then greatest(coalesce(p_estimated_purchase_amount,estimated_purchase_amount,0),0)
        else null end,
      pabili_cash_received=v_cash,
      pabili_cash_received_at=case when coalesce(v_cash,0)>0 then coalesce(pabili_cash_received_at,now()) else null end,
      declared_stop_count=v_stop_count,
      final_destination_mode=p_final_destination_mode,
      final_label=v_final_label,
      final_lat=v_final_lat,
      final_lng=v_final_lng,
      vehicle_requirement=v_required_vehicle,
      confirmed_cargo_weight_kg=v_weight,
      cargo_classification=v_cargo_class,
      driver_review_updated_at=now(),
      errand_stage='stage0_review',
      updated_at=now()
  where booking_id=p_booking_id;

  update public.bookings
  set stop_count=v_stop_count,to_label=v_final_label,dropoff_lat=v_final_lat,dropoff_lng=v_final_lng,updated_at=now()
  where id=p_booking_id;

  return jsonb_build_object(
    'ok',true,'booking_id',p_booking_id,'errand_stage','stage0_review',
    'stop_count',v_stop_count,'vehicle_requirement',v_required_vehicle,
    'driver_vehicle',v_driver_vehicle,'vehicle_suitable',v_vehicle_suitable,
    'confirmed_cargo_weight_kg',v_weight,'cargo_classification',v_cargo_class,
    'pabili_cash_received',v_cash
  );
end;
$function$;

create or replace function public.errand_driver_vehicle_not_suitable_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_confirmed_cargo_weight_kg numeric default null::numeric,
  p_reason_code text default 'vehicle_or_load_not_suitable'::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_job public.errand_jobs%rowtype;
  v_settings public.errand_pricing_settings%rowtype;
  v_driver_vehicle text;
  v_required_vehicle text;
  v_weight numeric;
  v_cargo_class text;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); end if;
  if lower(coalesce(v_booking.service_type,'')) <> 'errand' then
    return jsonb_build_object('ok',false,'error','NOT_ERRAND_BOOKING');
  end if;
  if coalesce(v_booking.assigned_driver_id,v_booking.driver_id) is distinct from p_driver_id then
    return jsonb_build_object('ok',false,'error','DRIVER_NOT_ASSIGNED');
  end if;
  if v_booking.status <> 'accepted' then
    return jsonb_build_object('ok',false,'error','ERRAND_VEHICLE_RELEASE_NOT_ALLOWED','status',v_booking.status);
  end if;

  select * into v_job from public.errand_jobs where booking_id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_JOB_NOT_FOUND'); end if;
  if v_job.task_locked or v_job.ready_for_customer_review_at is not null then
    return jsonb_build_object('ok',false,'error','ERRAND_TASK_ALREADY_FINALIZED');
  end if;
  if coalesce(v_job.pabili_cash_received,0)>0 then
    return jsonb_build_object('ok',false,'error','PABILI_CASH_ALREADY_RECEIVED');
  end if;

  select * into v_settings from public.errand_pricing_settings where singleton=true;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_PRICING_NOT_CONFIGURED'); end if;

  v_weight := greatest(coalesce(p_confirmed_cargo_weight_kg,v_job.confirmed_cargo_weight_kg,v_job.estimated_cargo_weight_kg,0),0);
  if v_weight > v_settings.kolong_kolong_max_kg then
    return jsonb_build_object('ok',false,'error','ERRAND_CARGO_EXCEEDS_NORMAL_MAX','max_kg',v_settings.kolong_kolong_max_kg);
  end if;

  if v_weight <= v_settings.standard_max_kg then v_cargo_class := 'standard';
  elsif v_weight <= v_settings.motorcycle_max_kg then v_cargo_class := 'heavy_16_25';
  elsif v_weight <= v_settings.tricycle_normal_max_kg then v_cargo_class := 'heavy_26_50';
  elsif v_weight <= v_settings.tricycle_extra_heavy_max_kg then v_cargo_class := 'extra_heavy_51_100';
  else v_cargo_class := 'extra_heavy_101_200';
  end if;

  select public.jride_normalize_vehicle_type_v1(dl.vehicle_type)
  into v_driver_vehicle
  from public.driver_locations dl
  where dl.driver_id=p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  v_required_vehicle := public.jride_normalize_vehicle_type_v1(coalesce(v_job.vehicle_requirement,'either'));
  if v_required_vehicle not in ('motorcycle','tricycle','kolong_kolong','either') then
    v_required_vehicle := 'either';
  end if;

  if v_required_vehicle='motorcycle' and v_weight > v_settings.motorcycle_max_kg then
    v_required_vehicle := 'either';
  elsif v_required_vehicle='tricycle' and v_weight > v_settings.tricycle_extra_heavy_max_kg then
    v_required_vehicle := 'kolong_kolong';
  end if;

  insert into public.errand_driver_offer_outcomes(
    booking_id,driver_id,outcome,reason_code,created_at
  ) values(
    p_booking_id,p_driver_id,'vehicle_not_suitable',
    nullif(lower(trim(coalesce(p_reason_code,'vehicle_or_load_not_suitable'))),''),
    now()
  )
  on conflict (booking_id,driver_id)
  do update set outcome='vehicle_not_suitable',reason_code=excluded.reason_code,created_at=excluded.created_at;

  update public.errand_jobs
  set vehicle_requirement=v_required_vehicle,
      confirmed_cargo_weight_kg=v_weight,
      cargo_classification=v_cargo_class,
      pabili_cash_received=null,
      pabili_cash_received_at=null,
      stage0_arrived_at=null,
      driver_review_updated_at=now(),
      errand_stage='matching',
      updated_at=now()
  where booking_id=p_booking_id;

  update public.bookings
  set driver_id=null,assigned_driver_id=null,status='searching',assigned_at=null,
      driver_accept_expires_at=null,driver_to_pickup_km=null,pickup_distance_fee=0,updated_at=now()
  where id=p_booking_id;

  return jsonb_build_object(
    'ok',true,'released',true,'booking_id',p_booking_id,'status','searching',
    'errand_stage','matching','driver_vehicle',v_driver_vehicle,
    'required_vehicle',v_required_vehicle,'confirmed_cargo_weight_kg',v_weight,
    'cargo_classification',v_cargo_class
  );
end;
$function$;

create or replace function public.errand_driver_ready_for_review_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_route_distance_km numeric,
  p_route_duration_seconds integer,
  p_route_legs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_booking public.bookings%rowtype;
  v_job public.errand_jobs%rowtype;
  v_settings public.errand_pricing_settings%rowtype;
  v_driver_vehicle text;
  v_weight numeric;
  v_heavy_fee numeric := 0;
  v_distance_fare numeric := 0;
  v_total numeric := 0;
  v_stop_count integer := 0;
  v_missing_coords integer := 0;
  v_capacity_ok boolean;
begin
  select * into v_booking from public.bookings where id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); end if;
  if lower(coalesce(v_booking.service_type,'')) <> 'errand' then
    return jsonb_build_object('ok',false,'error','NOT_ERRAND_BOOKING');
  end if;
  if coalesce(v_booking.assigned_driver_id,v_booking.driver_id) is distinct from p_driver_id then
    return jsonb_build_object('ok',false,'error','DRIVER_NOT_ASSIGNED');
  end if;
  if v_booking.status <> 'accepted' then
    return jsonb_build_object('ok',false,'error','ERRAND_NOT_READY_FOR_CUSTOMER_REVIEW','status',v_booking.status);
  end if;

  select * into v_job from public.errand_jobs where booking_id=p_booking_id for update;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_JOB_NOT_FOUND'); end if;
  if v_job.stage0_arrived_at is null then return jsonb_build_object('ok',false,'error','STAGE0_ARRIVAL_REQUIRED'); end if;
  if v_job.ready_for_customer_review_at is not null or v_job.task_locked then
    return jsonb_build_object('ok',false,'error','ERRAND_REVIEW_ALREADY_FINALIZED');
  end if;
  if v_job.accompanied then return jsonb_build_object('ok',false,'error','ACCOMPANIED_ERRAND_NOT_ENABLED'); end if;

  select count(*),count(*) filter(where lat is null or lng is null)
  into v_stop_count,v_missing_coords
  from public.errand_stops where booking_id=p_booking_id;

  if v_stop_count<1 or v_stop_count<>v_job.declared_stop_count then
    return jsonb_build_object('ok',false,'error','ERRAND_STOP_COUNT_MISMATCH');
  end if;
  if v_missing_coords>0 then return jsonb_build_object('ok',false,'error','ERRAND_STOP_PINS_REQUIRED'); end if;
  if v_job.final_lat is null or v_job.final_lng is null then
    return jsonb_build_object('ok',false,'error','FINAL_DESTINATION_PIN_REQUIRED');
  end if;
  if p_route_distance_km is null or p_route_distance_km<=0 then
    return jsonb_build_object('ok',false,'error','CONFIRMED_ROUTE_DISTANCE_REQUIRED');
  end if;
  if p_route_legs is null or jsonb_typeof(p_route_legs)<>'array'
     or jsonb_array_length(p_route_legs)<>v_stop_count+1 then
    return jsonb_build_object('ok',false,'error','CONFIRMED_ROUTE_LEGS_INVALID','expected_legs',v_stop_count+1);
  end if;

  select * into v_settings from public.errand_pricing_settings where singleton=true;
  if not found then return jsonb_build_object('ok',false,'error','ERRAND_PRICING_NOT_CONFIGURED'); end if;

  v_weight := greatest(coalesce(v_job.confirmed_cargo_weight_kg,v_job.estimated_cargo_weight_kg,0),0);
  if v_weight > v_settings.kolong_kolong_max_kg then
    return jsonb_build_object('ok',false,'error','ERRAND_CARGO_EXCEEDS_NORMAL_MAX','max_kg',v_settings.kolong_kolong_max_kg);
  end if;

  select public.jride_normalize_vehicle_type_v1(dl.vehicle_type)
  into v_driver_vehicle
  from public.driver_locations dl
  where dl.driver_id=p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if public.jride_normalize_vehicle_type_v1(v_job.vehicle_requirement) <> 'either'
     and public.jride_normalize_vehicle_type_v1(v_job.vehicle_requirement) is distinct from v_driver_vehicle then
    return jsonb_build_object(
      'ok',false,'error','ERRAND_VEHICLE_NOT_SUITABLE',
      'required_vehicle',v_job.vehicle_requirement,'driver_vehicle',v_driver_vehicle
    );
  end if;

  v_capacity_ok := case v_driver_vehicle
    when 'motorcycle' then v_weight <= v_settings.motorcycle_max_kg
    when 'tricycle' then v_weight <= v_settings.tricycle_extra_heavy_max_kg
    when 'kolong_kolong' then v_weight <= v_settings.kolong_kolong_max_kg
    else false
  end;

  if not v_capacity_ok then
    return jsonb_build_object(
      'ok',false,'error','ERRAND_VEHICLE_NOT_SUITABLE',
      'required_vehicle',case
        when v_weight > v_settings.tricycle_extra_heavy_max_kg then 'kolong_kolong'
        when v_weight > v_settings.motorcycle_max_kg then 'tricycle_or_kolong_kolong'
        else v_job.vehicle_requirement end,
      'driver_vehicle',v_driver_vehicle
    );
  end if;

  if v_job.is_pabili and coalesce(v_job.pabili_cash_received,0)<=0 then
    return jsonb_build_object('ok',false,'error','PABILI_CASH_REQUIRED_BEFORE_CONFIRMATION');
  end if;

  if v_weight <= v_settings.standard_max_kg then v_heavy_fee := 0;
  elsif v_weight <= v_settings.motorcycle_max_kg then v_heavy_fee := v_settings.heavy_16_25_fee_candidate;
  elsif v_weight <= v_settings.tricycle_normal_max_kg then v_heavy_fee := v_settings.heavy_26_50_fee_candidate;
  else v_heavy_fee := v_settings.heavy_51_100_fee_candidate;
  end if;

  v_distance_fare := round(p_route_distance_km*v_settings.route_rate_per_km,0);

  update public.errand_jobs
  set confirmed_route_distance_km=round(p_route_distance_km,3),
      confirmed_route_duration_seconds=p_route_duration_seconds,
      confirmed_route_legs=p_route_legs,
      waiting_started_at=coalesce(waiting_started_at,now()),
      ready_for_customer_review_at=now(),
      errand_stage='awaiting_customer_confirmation',
      updated_at=now()
  where booking_id=p_booking_id;

  update public.bookings
  set distance_fare=v_distance_fare,heavy_load_fee=v_heavy_fee,stop_count=v_stop_count,
      status='fare_proposed',driver_fee_proposal_expires_at=null,updated_at=now()
  where id=p_booking_id;

  select total_errand_fare into v_total from public.bookings where id=p_booking_id;
  update public.bookings set proposed_fare=v_total,updated_at=now() where id=p_booking_id;

  return jsonb_build_object(
    'ok',true,'booking_id',p_booking_id,'status','fare_proposed',
    'errand_stage','awaiting_customer_confirmation',
    'confirmed_route_distance_km',round(p_route_distance_km,3),
    'route_distance_fare',v_distance_fare,'heavy_load_fee',v_heavy_fee,
    'total_errand_fare',v_total,'waiting_running',true
  );
end;
$function$;

create or replace function public.agrimarket_compute_heavy_load_fee_v1(
  p_weight_basis text,
  p_weight_kg numeric,
  p_weight_band text
)
returns numeric
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_basis text := lower(trim(coalesce(p_weight_basis,'')));
  v_band text := lower(trim(coalesce(p_weight_band,'')));
  v_tier1_max numeric(10,3);
  v_tier2_max numeric(10,3);
  v_tier3_max numeric(10,3);
  v_tier4_max numeric(10,3);
  v_kolong_max numeric(10,3);
  v_fee1 numeric(12,2);
  v_fee2 numeric(12,2);
  v_fee3 numeric(12,2);
  v_fee4 numeric(12,2);
begin
  if v_basis='' then return 0; end if;

  select
    heavy_load_exact_tier1_max_kg,
    heavy_load_exact_tier2_max_kg,
    heavy_load_exact_tier3_max_kg,
    heavy_load_exact_tier4_max_kg,
    kolong_kolong_max_kg,
    heavy_load_tier1_fee,
    heavy_load_tier2_fee,
    heavy_load_tier3_fee,
    heavy_load_tier4_fee
  into
    v_tier1_max,v_tier2_max,v_tier3_max,v_tier4_max,v_kolong_max,
    v_fee1,v_fee2,v_fee3,v_fee4
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if not found then
    raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode='P0001';
  end if;

  if v_basis='exact' then
    if p_weight_kg is null or p_weight_kg<=0 then
      raise exception 'AGRIMARKET_EXACT_WEIGHT_REQUIRED' using errcode='P0001';
    end if;
    if p_weight_kg<=v_tier1_max then return round(v_fee1,2);
    elsif p_weight_kg<=v_tier2_max then return round(v_fee2,2);
    elsif p_weight_kg<=v_tier3_max then return round(v_fee3,2);
    elsif p_weight_kg<=v_tier4_max then return round(v_fee4,2);
    elsif p_weight_kg<=v_kolong_max then return round(v_fee4,2);
    end if;
    raise exception 'AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED' using errcode='P0001';
  end if;

  if v_basis='approximate' then
    case v_band
      when '1_15' then return round(v_fee1,2);
      when '16_25' then return round(v_fee2,2);
      when '26_50' then return round(v_fee3,2);
      when '51_100' then return round(v_fee4,2);
      when '101_200' then return round(v_fee4,2);
      when 'over_100' then
        raise exception 'AGRIMARKET_USE_101_200_WEIGHT_BAND' using errcode='P0001';
      when 'over_200' then
        raise exception 'AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED' using errcode='P0001';
      else
        raise exception 'AGRIMARKET_APPROXIMATE_WEIGHT_BAND_REQUIRED' using errcode='P0001';
    end case;
  end if;

  raise exception 'AGRIMARKET_INVALID_WEIGHT_BASIS' using errcode='P0001';
end;
$function$;

create or replace function public.agrimarket_confirm_order_cargo_v2(
  p_order_code text,
  p_producer_id uuid,
  p_confirmed_cargo_weight_basis text,
  p_confirmed_cargo_weight_kg numeric,
  p_confirmed_cargo_weight_band text,
  p_confirmed_handling_tier text,
  p_now timestamp with time zone default clock_timestamp()
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_order public.agrimarket_orders%rowtype;
  v_basis text := lower(trim(coalesce(p_confirmed_cargo_weight_basis,'')));
  v_band text := lower(trim(coalesce(p_confirmed_cargo_weight_band,'')));
  v_tier text := lower(trim(coalesce(p_confirmed_handling_tier,'')));
  v_min_rank integer := 0;
  v_selected_rank integer := -1;
  v_min_tier text := 'standard';
  v_kolong_max numeric(10,3);
begin
  select kolong_kolong_max_kg into v_kolong_max
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_kolong_max is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PRICING_NOT_CONFIGURED');
  end if;

  if trim(coalesce(p_order_code,''))='' or p_producer_id is null then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_PRODUCER_AUTH_REQUIRED');
  end if;
  if v_basis not in ('exact','approximate') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_WEIGHT_BASIS_REQUIRED');
  end if;

  if v_basis='exact' then
    if p_confirmed_cargo_weight_kg is null or p_confirmed_cargo_weight_kg<=0 then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CONFIRMED_CARGO_WEIGHT_REQUIRED');
    end if;
    if p_confirmed_cargo_weight_kg>v_kolong_max then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED','max_kg',v_kolong_max);
    end if;
    if v_band<>'' and v_band not in ('1_15','16_25','26_50','51_100','101_200') then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_CARGO_WEIGHT_BAND');
    end if;
  else
    if v_band not in ('1_15','16_25','26_50','51_100','101_200','over_100','over_200') then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_WEIGHT_BAND_REQUIRED');
    end if;
    if v_band='over_100' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_USE_101_200_WEIGHT_BAND');
    end if;
    if v_band='over_200' then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED','max_kg',v_kolong_max);
    end if;
    if p_confirmed_cargo_weight_kg is not null and p_confirmed_cargo_weight_kg<=0 then
      return jsonb_build_object('ok',false,'error','AGRIMARKET_CONFIRMED_CARGO_WEIGHT_INVALID');
    end if;
  end if;

  v_selected_rank := case v_tier
    when 'standard' then 0 when 'bulky' then 1 when 'live_single' then 2 when 'live_difficult' then 3 else -1
  end;
  if v_selected_rank<0 then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_HANDLING_TIER');
  end if;

  select o.* into v_order
  from public.agrimarket_orders o
  where o.order_code=trim(p_order_code)
  for update;

  if v_order.id is null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.producer_id<>p_producer_id
     or not exists(select 1 from public.agrimarket_producers p where p.id=p_producer_id and p.status='active') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_OWNED_BY_PRODUCER');
  end if;
  if v_order.status not in ('awaiting_producer','awaiting_harvest','producer_accepted','preparing') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_CARGO_CONFIRMATION_WRONG_STATUS','status',v_order.status);
  end if;

  select coalesce(max(case
    when oi.cargo_class='live_livestock' then 2
    when oi.cargo_class in ('crate','bulk_sack','live_poultry') then 1
    else 0 end),0)
  into v_min_rank
  from public.agrimarket_order_items oi
  where oi.order_id=v_order.id;

  v_min_tier := case v_min_rank when 2 then 'live_single' when 1 then 'bulky' else 'standard' end;
  if v_selected_rank<v_min_rank then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_HANDLING_TIER_BELOW_MINIMUM','minimum_handling_tier',v_min_tier);
  end if;

  update public.agrimarket_orders
  set confirmed_cargo_weight_basis=v_basis,
      confirmed_cargo_weight_kg=case when p_confirmed_cargo_weight_kg is null then null else round(p_confirmed_cargo_weight_kg,3) end,
      confirmed_cargo_weight_band=nullif(v_band,''),
      confirmed_handling_tier=v_tier,
      updated_at=p_now
  where id=v_order.id;

  insert into public.agrimarket_order_events(
    order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
  ) values(
    v_order.id,v_order.status,v_order.status,'producer',p_producer_id,'cargo_confirmation_recorded',
    jsonb_build_object(
      'estimated_cargo_weight_kg',v_order.estimated_cargo_weight_kg,
      'confirmed_cargo_weight_basis',v_basis,
      'confirmed_cargo_weight_kg',case when p_confirmed_cargo_weight_kg is null then null else round(p_confirmed_cargo_weight_kg,3) end,
      'confirmed_cargo_weight_band',nullif(v_band,''),
      'minimum_handling_tier',v_min_tier,
      'confirmed_handling_tier',v_tier
    ),p_now
  );

  return jsonb_build_object(
    'ok',true,'order_code',v_order.order_code,
    'estimated_cargo_weight_kg',v_order.estimated_cargo_weight_kg,
    'confirmed_cargo_weight_basis',v_basis,
    'confirmed_cargo_weight_kg',case when p_confirmed_cargo_weight_kg is null then null else round(p_confirmed_cargo_weight_kg,3) end,
    'confirmed_cargo_weight_band',nullif(v_band,''),
    'minimum_handling_tier',v_min_tier,
    'confirmed_handling_tier',v_tier
  );
end;
$function$;

create or replace function public.agrimarket_compute_required_vehicle_v1(
  p_product_required_vehicle_type text,
  p_confirmed_cargo_weight_basis text,
  p_confirmed_cargo_weight_kg numeric,
  p_confirmed_cargo_weight_band text,
  p_confirmed_handling_tier text,
  p_motorcycle_weight_max_kg numeric
)
returns text
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_product text := public.jride_normalize_vehicle_type_v1(p_product_required_vehicle_type);
  v_basis text := lower(trim(coalesce(p_confirmed_cargo_weight_basis,'')));
  v_band text := lower(trim(coalesce(p_confirmed_cargo_weight_band,'')));
  v_handling text := lower(trim(coalesce(p_confirmed_handling_tier,'')));
  v_required_rank integer;
  v_tricycle_max numeric(10,3);
  v_kolong_max numeric(10,3);
begin
  if v_product not in ('either','motorcycle','tricycle','kolong_kolong') then
    raise exception 'AGRIMARKET_STEP7_PRODUCT_VEHICLE_INVALID' using errcode='P0001';
  end if;
  if p_motorcycle_weight_max_kg is null or p_motorcycle_weight_max_kg<=0 then
    raise exception 'AGRIMARKET_STEP7_MOTORCYCLE_WEIGHT_LIMIT_INVALID' using errcode='P0001';
  end if;

  select heavy_load_exact_tier4_max_kg,kolong_kolong_max_kg
  into v_tricycle_max,v_kolong_max
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_tricycle_max is null or v_kolong_max is null then
    raise exception 'AGRIMARKET_STEP7_WEIGHT_SETTINGS_UNAVAILABLE' using errcode='P0001';
  end if;

  v_required_rank := greatest(public.jride_vehicle_rank_v1(v_product),0);

  if v_basis='exact' then
    if p_confirmed_cargo_weight_kg is null or p_confirmed_cargo_weight_kg<=0 then
      raise exception 'AGRIMARKET_STEP7_EXACT_WEIGHT_REQUIRED' using errcode='P0001';
    end if;
    if p_confirmed_cargo_weight_kg>v_kolong_max then
      raise exception 'AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED' using errcode='P0001';
    elsif p_confirmed_cargo_weight_kg>v_tricycle_max then
      v_required_rank := greatest(v_required_rank,3);
    elsif p_confirmed_cargo_weight_kg>p_motorcycle_weight_max_kg then
      v_required_rank := greatest(v_required_rank,2);
    end if;
  elsif v_basis='approximate' then
    if v_band not in ('1_15','16_25','26_50','51_100','101_200','over_100','over_200') then
      raise exception 'AGRIMARKET_STEP7_WEIGHT_BAND_REQUIRED' using errcode='P0001';
    end if;
    if v_band='over_100' then
      raise exception 'AGRIMARKET_USE_101_200_WEIGHT_BAND' using errcode='P0001';
    elsif v_band='over_200' then
      raise exception 'AGRIMARKET_CARGO_OVER_200KG_UNSUPPORTED' using errcode='P0001';
    elsif v_band='101_200' then
      v_required_rank := greatest(v_required_rank,3);
    elsif v_band in ('26_50','51_100') then
      v_required_rank := greatest(v_required_rank,2);
    end if;
  else
    raise exception 'AGRIMARKET_STEP7_WEIGHT_BASIS_REQUIRED' using errcode='P0001';
  end if;

  if v_handling not in ('standard','bulky','live_single','live_difficult') then
    raise exception 'AGRIMARKET_STEP7_HANDLING_TIER_REQUIRED' using errcode='P0001';
  end if;
  if v_handling in ('live_single','live_difficult') then
    v_required_rank := greatest(v_required_rank,2);
  end if;

  return case v_required_rank
    when 3 then 'kolong_kolong'
    when 2 then 'tricycle'
    when 1 then 'motorcycle'
    else 'either'
  end;
end;
$function$;

create or replace function public.agrimarket_initialize_customer_approval_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  new.customer_approved_total := round(
    coalesce(new.product_subtotal,0)
    + coalesce(new.delivery_fee,0)
    + coalesce(new.pickup_distance_fee,0)
    + coalesce(new.heavy_load_fee,0)
    + coalesce(new.handling_fee,0),2
  );
  new.customer_approved_vehicle_type := new.preferred_vehicle_type;
  new.customer_reapproval_required_at := null;
  new.customer_reapproval_responded_at := null;
  new.customer_reapproval_response := null;
  new.customer_reapproval_proposed_total := null;
  new.customer_reapproval_proposed_vehicle_type := null;
  new.customer_reapproval_resume_status := null;
  return new;
end;
$function$;

create or replace function public.agrimarket_initialize_step7_vehicle_baselines_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.required_vehicle_type not in ('either','motorcycle','tricycle','kolong_kolong') then
    raise exception 'AGRIMARKET_STEP7_PRODUCT_VEHICLE_INVALID' using errcode='P0001';
  end if;
  if new.preferred_vehicle_type not in ('motorcycle','tricycle','kolong_kolong') then
    raise exception 'AGRIMARKET_STEP7_PREFERRED_VEHICLE_INVALID' using errcode='P0001';
  end if;
  new.product_required_vehicle_type := new.required_vehicle_type;
  new.checkout_preferred_vehicle_type := new.preferred_vehicle_type;
  return new;
end;
$function$;

create or replace function public.agrimarket_apply_weight_aware_vehicle_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_motorcycle_weight_max_kg numeric(10,3);
  v_checkout text;
  v_approved text;
  v_required_rank integer;
  v_checkout_rank integer;
  v_approved_rank integer;
begin
  if new.confirmed_cargo_weight_basis is null then
    new.required_vehicle_type := new.product_required_vehicle_type;
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
    new.customer_approved_vehicle_type := new.checkout_preferred_vehicle_type;
    return new;
  end if;

  select heavy_load_exact_tier2_max_kg
  into v_motorcycle_weight_max_kg
  from public.agrimarket_pricing_settings
  where id=1 and is_active=true;

  if v_motorcycle_weight_max_kg is null then
    raise exception 'AGRIMARKET_STEP7_WEIGHT_SETTINGS_UNAVAILABLE' using errcode='P0001';
  end if;

  new.required_vehicle_type := public.agrimarket_compute_required_vehicle_v1(
    new.product_required_vehicle_type,
    new.confirmed_cargo_weight_basis,
    new.confirmed_cargo_weight_kg,
    new.confirmed_cargo_weight_band,
    new.confirmed_handling_tier,
    v_motorcycle_weight_max_kg
  );

  v_checkout := coalesce(new.checkout_preferred_vehicle_type,new.preferred_vehicle_type,'motorcycle');
  v_approved := coalesce(new.customer_approved_vehicle_type,v_checkout);
  v_required_rank := public.jride_vehicle_rank_v1(new.required_vehicle_type);
  v_checkout_rank := public.jride_vehicle_rank_v1(v_checkout);
  v_approved_rank := public.jride_vehicle_rank_v1(v_approved);

  if v_required_rank <= v_checkout_rank then
    new.preferred_vehicle_type := v_checkout;
    new.customer_approved_vehicle_type := v_checkout;
  elsif v_approved_rank >= v_required_rank then
    new.preferred_vehicle_type := v_approved;
  else
    new.preferred_vehicle_type := v_checkout;
  end if;

  return new;
end;
$function$;

create or replace function public.agrimarket_apply_approved_vehicle_choice_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_approved text := coalesce(new.customer_approved_vehicle_type,new.checkout_preferred_vehicle_type,new.preferred_vehicle_type);
begin
  if public.jride_vehicle_rank_v1(v_approved) >= public.jride_vehicle_rank_v1(new.required_vehicle_type) then
    new.preferred_vehicle_type := v_approved;
  else
    new.preferred_vehicle_type := new.checkout_preferred_vehicle_type;
  end if;
  return new;
end;
$function$;

create or replace function public.agrimarket_evaluate_customer_reapproval_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
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
  v_approved_vehicle := coalesce(new.customer_approved_vehicle_type,new.checkout_preferred_vehicle_type,new.preferred_vehicle_type,'motorcycle');

  v_revised_vehicle := case
    when public.jride_vehicle_rank_v1(v_approved_vehicle) < public.jride_vehicle_rank_v1(new.required_vehicle_type)
      then new.required_vehicle_type
    else v_approved_vehicle
  end;

  v_price_increased := v_current_total > v_approved_total;
  v_vehicle_escalated :=
    public.jride_vehicle_rank_v1(v_revised_vehicle) > public.jride_vehicle_rank_v1(v_approved_vehicle);

  v_was_pending :=
    new.status='awaiting_customer_reapproval'
    and new.customer_reapproval_response is null;

  if v_price_increased or v_vehicle_escalated then
    if new.assigned_driver_id is not null
       or new.status in ('dispatching','driver_assigned','picked_up','delivering','delivered','completed') then
      raise exception 'AGRIMARKET_CUSTOMER_REAPPROVAL_REQUIRED_AFTER_DISPATCH' using errcode='P0001';
    end if;

    if new.status not in ('producer_accepted','preparing','ready_for_dispatch','awaiting_customer_reapproval') then
      raise exception 'AGRIMARKET_CUSTOMER_REAPPROVAL_WRONG_STATUS' using errcode='P0001';
    end if;

    v_resume_status := case
      when new.status='awaiting_customer_reapproval'
        then coalesce(new.customer_reapproval_resume_status,'preparing')
      else new.status end;

    v_proposal_changed :=
      not v_was_pending
      or new.customer_reapproval_proposed_total is distinct from v_current_total
      or new.customer_reapproval_proposed_vehicle_type is distinct from v_revised_vehicle;

    update public.agrimarket_orders
    set status='awaiting_customer_reapproval',
        customer_reapproval_required_at=case
          when v_was_pending then coalesce(customer_reapproval_required_at,v_now)
          else v_now end,
        customer_reapproval_responded_at=null,
        customer_reapproval_response=null,
        customer_reapproval_proposed_total=v_current_total,
        customer_reapproval_proposed_vehicle_type=v_revised_vehicle,
        customer_reapproval_resume_status=v_resume_status,
        updated_at=v_now
    where id=new.id;

    if v_proposal_changed then
      insert into public.agrimarket_order_events(
        order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
      ) values(
        new.id,new.status,'awaiting_customer_reapproval','system',null,'customer_reapproval_required',
        jsonb_build_object(
          'approved_total',v_approved_total,
          'revised_total',v_current_total,
          'price_increased',v_price_increased,
          'approved_vehicle_type',v_approved_vehicle,
          'revised_vehicle_type',v_revised_vehicle,
          'vehicle_escalated',v_vehicle_escalated,
          'resume_status',v_resume_status
        ),v_now
      );
    end if;
    return null;
  end if;

  if v_was_pending then
    v_resume_status := coalesce(new.customer_reapproval_resume_status,'preparing');
    update public.agrimarket_orders
    set status=v_resume_status,
        customer_reapproval_responded_at=v_now,
        customer_reapproval_response='not_required',
        customer_reapproval_proposed_total=v_current_total,
        customer_reapproval_proposed_vehicle_type=v_revised_vehicle,
        updated_at=v_now
    where id=new.id;

    insert into public.agrimarket_order_events(
      order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
    ) values(
      new.id,'awaiting_customer_reapproval',v_resume_status,'system',null,
      'customer_reapproval_no_longer_required',
      jsonb_build_object(
        'approved_total',v_approved_total,
        'current_total',v_current_total,
        'approved_vehicle_type',v_approved_vehicle,
        'current_vehicle_type',v_revised_vehicle
      ),v_now
    );
  end if;

  return null;
end;
$function$;

create or replace function public.agrimarket_customer_respond_reapproval_v1(
  p_order_code text,
  p_customer_user_id uuid,
  p_response text,
  p_now timestamp with time zone default clock_timestamp()
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
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

create or replace function public.agrimarket_guard_pickup_access_v1()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  p public.agrimarket_producers%rowtype;
  v_vehicle text;
begin
  if tg_op='INSERT' and (new.delivery_lat is null or new.delivery_lng is null) then
    raise exception 'AGRIMARKET_DELIVERY_PIN_REQUIRED';
  end if;

  if tg_op='INSERT' or new.status in ('dispatching','driver_assigned') then
    select * into p from public.agrimarket_producers where id=new.producer_id for share;
    if p.status is distinct from 'active' or p.accepting_orders is distinct from true then
      raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE';
    end if;
    if p.pickup_lat is null or p.pickup_lng is null
       or p.pickup_motorcycle_accessible is null
       or p.pickup_tricycle_accessible is null
       or p.pickup_roadside_handoff_required is null
       or nullif(trim(p.pickup_driver_directions),'') is null then
      raise exception 'AGRIMARKET_PICKUP_ACCESS_UNVERIFIED';
    end if;

    v_vehicle := public.jride_normalize_vehicle_type_v1(new.preferred_vehicle_type);
    if (v_vehicle='tricycle' and not p.pickup_tricycle_accessible)
       or (v_vehicle='kolong_kolong' and not p.pickup_tricycle_accessible)
       or (v_vehicle='motorcycle' and not p.pickup_motorcycle_accessible) then
      raise exception 'AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE';
    end if;
  end if;

  if tg_op='UPDATE' and old.pickup_issue->>'status'='open'
     and new.status in ('picked_up','delivering','delivered','completed') then
    raise exception 'AGRIMARKET_PICKUP_ISSUE_OPEN';
  end if;
  return new;
end;
$function$;

create or replace function public.agrimarket_driver_decide_offer_v1(
  p_offer_id uuid,
  p_driver_id uuid,
  p_decision text,
  p_reason text default null::text,
  p_now timestamp with time zone default clock_timestamp()
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_offer public.agrimarket_driver_offers%rowtype;
  v_order public.agrimarket_orders%rowtype;
  v_driver public.drivers%rowtype;
  v_location public.driver_locations%rowtype;
  v_decision text := lower(trim(coalesce(p_decision,'')));
  v_vehicle text;
  v_min_wallet numeric;
  v_block_reason text;
begin
  if v_decision not in ('accept','decline') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_INVALID_DRIVER_DECISION');
  end if;

  select * into v_offer
  from public.agrimarket_driver_offers
  where id=p_offer_id and driver_id=p_driver_id
  for update;

  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_DRIVER_OFFER_NOT_FOUND'); end if;
  if v_offer.status<>'offered' then
    return jsonb_build_object('ok',true,'already_resolved',true,'status',v_offer.status,'order_id',v_offer.order_id);
  end if;

  if v_offer.expires_at<=p_now then
    update public.agrimarket_driver_offers
    set status='expired',responded_at=p_now,reason_code='offer_timeout',updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',false,'error','AGRIMARKET_DRIVER_OFFER_EXPIRED','order_id',v_offer.order_id);
  end if;

  if v_decision='decline' then
    update public.agrimarket_driver_offers
    set status='declined',responded_at=p_now,
        reason_code=nullif(trim(coalesce(p_reason,'')),''),updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',true,'accepted',false,'order_id',v_offer.order_id);
  end if;

  select * into v_order from public.agrimarket_orders where id=v_offer.order_id for update;
  if not found then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_FOUND'); end if;
  if v_order.assigned_driver_id is not null then return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_ALREADY_ASSIGNED'); end if;
  if v_order.status not in ('dispatching','preparing','ready_for_dispatch') then
    return jsonb_build_object('ok',false,'error','AGRIMARKET_ORDER_NOT_DRIVER_ASSIGNABLE','status',v_order.status);
  end if;

  select * into v_driver from public.drivers where id=p_driver_id for update;
  if not found then v_block_reason := 'AGRIMARKET_DRIVER_NOT_FOUND';
  else
    v_min_wallet := greatest(coalesce(v_driver.min_wallet_required,250),250);
    if coalesce(v_driver.wallet_locked,false) then v_block_reason := 'AGRIMARKET_DRIVER_WALLET_LOCKED';
    elsif coalesce(v_driver.wallet_balance,0)<v_min_wallet then v_block_reason := 'AGRIMARKET_DRIVER_WALLET_BELOW_MINIMUM';
    elsif lower(trim(coalesce(v_driver.roster_status,''))) not in ('','active') then v_block_reason := 'AGRIMARKET_DRIVER_ROSTER_INELIGIBLE';
    end if;
  end if;

  if v_block_reason is null then
    select * into v_location
    from public.driver_locations
    where driver_id=p_driver_id
    order by updated_at desc
    limit 1;

    if not found then v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_MISSING';
    elsif v_location.updated_at < p_now-interval '5 minutes' then v_block_reason := 'AGRIMARKET_DRIVER_LOCATION_STALE';
    elsif lower(trim(coalesce(v_location.status,''))) not in ('online','available','idle','waiting') then
      v_block_reason := 'AGRIMARKET_DRIVER_NOT_AVAILABLE';
    else
      v_vehicle := public.jride_normalize_vehicle_type_v1(v_location.vehicle_type);
      if v_vehicle is distinct from public.jride_normalize_vehicle_type_v1(v_order.preferred_vehicle_type) then
        v_block_reason := 'AGRIMARKET_DRIVER_VEHICLE_CHANGED';
      elsif public.jride_vehicle_rank_v1(v_vehicle) < public.jride_vehicle_rank_v1(v_order.required_vehicle_type) then
        v_block_reason := 'AGRIMARKET_REQUIRED_VEHICLE_MISMATCH';
      end if;
    end if;
  end if;

  if v_block_reason is null and exists(
    select 1 from public.bookings b
    where b.status in ('assigned','accepted','fare_proposed','ready','on_the_way','arrived','on_trip')
      and (b.driver_id=p_driver_id or b.assigned_driver_id=p_driver_id)
  ) then v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY'; end if;

  if v_block_reason is null and exists(
    select 1 from public.agrimarket_orders o
    where o.id<>v_order.id and o.assigned_driver_id=p_driver_id
      and o.status in ('driver_assigned','picked_up','delivering')
  ) then v_block_reason := 'AGRIMARKET_DRIVER_BECAME_BUSY'; end if;

  if v_block_reason is not null then
    update public.agrimarket_driver_offers
    set status='cancelled',responded_at=p_now,reason_code=lower(v_block_reason),updated_at=p_now
    where id=v_offer.id;
    return jsonb_build_object('ok',false,'error',v_block_reason,'order_id',v_offer.order_id,'released',true);
  end if;

  update public.agrimarket_driver_offers
  set status='accepted',responded_at=p_now,updated_at=p_now
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
    'ok',true,'accepted',true,'order_id',v_order.id,'order_code',v_order.order_code,
    'driver_id',p_driver_id,'selected_vehicle_type',v_vehicle,
    'pickup_road_distance_km',v_offer.pickup_road_distance_km,
    'pickup_distance_fee',v_offer.pickup_distance_fee,
    'route_plan',v_order.route_plan,
    'cash_collection_required',v_order.cash_collection_required,
    'cash_collection_amount',v_order.cash_collection_amount
  );
end;
$function$;

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
  p_route_provider text default 'mapbox_driving'::text
)
returns table(
  order_id uuid,order_code text,status text,fulfillment_mode text,
  harvest_expected_start_at timestamp with time zone,harvest_expected_end_at timestamp with time zone,
  producer_confirm_expires_at timestamp with time zone,product_subtotal numeric,
  cash_collection_required boolean,cash_collection_amount numeric,route_plan text,assignment_anchor text,
  delivery_fee numeric,total_payable numeric,preferred_vehicle_type text,required_vehicle_type text,pricing_version integer
)
language plpgsql
set search_path to 'public'
as $function$
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
  v_preferred_vehicle text := public.jride_normalize_vehicle_type_v1(p_preferred_vehicle_type);
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
  if p_delivery_address_id is null then raise exception 'AGRIMARKET_DELIVERY_ADDRESS_REQUIRED' using errcode='P0001'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then
    raise exception 'AGRIMARKET_ITEMS_REQUIRED' using errcode='P0001';
  end if;
  if v_preferred_vehicle not in ('motorcycle','tricycle','kolong_kolong') then
    raise exception 'AGRIMARKET_INVALID_PREFERRED_VEHICLE' using errcode='P0001';
  end if;
  if p_route_provider<>'mapbox_driving' then raise exception 'AGRIMARKET_ROUTE_PROVIDER_INVALID' using errcode='P0001'; end if;
  if p_farmer_to_customer_distance_km is null or p_farmer_to_customer_distance_km<0
     or p_farmer_to_customer_duration_seconds is null or p_farmer_to_customer_duration_seconds<0 then
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
  where a.id=p_delivery_address_id and a.created_by_user_id=p_customer_user_id and a.is_active=true
  limit 1;
  if v_address.id is null then raise exception 'AGRIMARKET_DELIVERY_ADDRESS_NOT_OWNED' using errcode='P0001'; end if;
  if v_address.lat is null or v_address.lng is null then raise exception 'AGRIMARKET_DELIVERY_PIN_REQUIRED' using errcode='P0001'; end if;

  select count(*),count(distinct x.product_id)
  into v_input_count,v_distinct_input_count
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric);
  if v_input_count<>jsonb_array_length(p_items) or v_input_count<>v_distinct_input_count then
    raise exception 'AGRIMARKET_DUPLICATE_OR_INVALID_ITEMS' using errcode='P0001';
  end if;

  for v_row in
    select p.id
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
    join public.agrimarket_products p on p.id=x.product_id
    order by p.id for update of p
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
         case
           when bool_or(p.vehicle_requirement='kolong_kolong') then 'kolong_kolong'
           when bool_or(p.vehicle_requirement='tricycle') then 'tricycle'
           else 'either'
         end,
         min(p.harvest_start_at),min(p.harvest_end_at),
         count(distinct p.harvest_start_at),count(distinct coalesce(p.harvest_end_at,p.harvest_start_at)),
         min(p.harvest_order_cutoff_at),bool_and(p.harvest_order_cutoff_at is not null)
  into v_product_count,v_producer_count,v_producer_id,
       v_mode_count,v_mode,v_subtotal,v_required_vehicle,
       v_harvest_start,v_harvest_end,v_harvest_start_count,v_harvest_end_count,
       v_cutoff,v_all_cutoffs_present
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  join public.agrimarket_products p on p.id=x.product_id;

  if v_product_count<>v_input_count then raise exception 'AGRIMARKET_PRODUCT_NOT_FOUND' using errcode='P0001'; end if;
  if v_producer_count<>1 then raise exception 'AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED' using errcode='P0001'; end if;
  if v_mode_count<>1 then raise exception 'AGRIMARKET_MIXED_AVAILABILITY_CART_NOT_ALLOWED' using errcode='P0001'; end if;

  select p.* into v_producer from public.agrimarket_producers p where p.id=v_producer_id for update;
  if v_producer.id is null or v_producer.status<>'active' or v_producer.accepting_orders is distinct from true then
    raise exception 'AGRIMARKET_PRODUCER_UNAVAILABLE' using errcode='P0001';
  end if;

  select string_agg(p.name,', ' order by p.name) into v_bad
  from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  join public.agrimarket_products p on p.id=x.product_id
  where p.is_active is distinct from true or x.quantity is null or x.quantity<=0 or p.remaining_quantity<x.quantity;
  if v_bad is not null then raise exception 'AGRIMARKET_ITEM_UNAVAILABLE: %',v_bad using errcode='P0001'; end if;

  if v_mode='scheduled_harvest' then
    if v_harvest_start_count<>1 or v_harvest_end_count<>1 then
      raise exception 'AGRIMARKET_SCHEDULED_ITEMS_REQUIRE_SAME_HARVEST_WINDOW' using errcode='P0001';
    end if;
    if not coalesce(v_all_cutoffs_present,false) or v_cutoff<v_now then
      raise exception 'AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED' using errcode='P0001';
    end if;
  end if;

  if public.jride_vehicle_rank_v1(v_preferred_vehicle) < public.jride_vehicle_rank_v1(v_required_vehicle) then
    raise exception 'AGRIMARKET_VEHICLE_REQUIREMENT_MISMATCH' using errcode='P0001';
  end if;

  select s.cash_first_threshold into v_threshold
  from public.agrimarket_pricing_settings s
  where s.id=1 and s.is_active=true;
  if v_threshold is null then raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode='P0001'; end if;

  v_cash_first := v_subtotal>v_threshold;
  if v_cash_first then
    if p_customer_to_farmer_distance_km is null or p_customer_to_farmer_distance_km<0
       or p_customer_to_farmer_duration_seconds is null or p_customer_to_farmer_duration_seconds<0 then
      raise exception 'AGRIMARKET_CUSTOMER_FARMER_ROUTE_REQUIRED' using errcode='P0001';
    end if;
    v_service_distance := round(p_customer_to_farmer_distance_km+p_farmer_to_customer_distance_km,3);
    v_service_duration := p_customer_to_farmer_duration_seconds+p_farmer_to_customer_duration_seconds;
  else
    v_service_distance := round(p_farmer_to_customer_distance_km,3);
    v_service_duration := p_farmer_to_customer_duration_seconds;
  end if;

  select * into v_quote from public.agrimarket_quote_delivery_v1(v_service_distance);

  v_order_code := 'AG-' || to_char(v_now at time zone 'Asia/Manila','YYYYMMDD') || '-'
                  || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8));

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
  ) values(
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
      'pricing_version',v_quote.pricing_version,'cash_first_threshold',v_threshold,
      'fulfillment_mode',v_mode,
      'harvest_expected_start_at',case when v_mode='scheduled_harvest' then v_harvest_start else null end,
      'harvest_expected_end_at',case when v_mode='scheduled_harvest' then v_harvest_end else null end,
      'route_plan',case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
      'route_distance_km',v_service_distance,'delivery_fee',v_quote.delivery_fee,'marketplace_fee_percent',0
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

  insert into public.agrimarket_inventory_reservations(
    order_id,order_item_id,product_id,quantity,status,expires_at,created_at
  )
  select v_order_id,oi.id,oi.product_id,oi.quantity,'active',v_now+interval '5 minutes',v_now
  from public.agrimarket_order_items oi where oi.order_id=v_order_id;

  with r as (
    select x.product_id,x.quantity
    from jsonb_to_recordset(p_items) as x(product_id uuid,quantity numeric)
  )
  update public.agrimarket_products p
  set reserved_quantity=p.reserved_quantity+r.quantity,updated_at=v_now
  from r where p.id=r.product_id;

  insert into public.agrimarket_order_events(
    order_id,from_status,to_status,actor_type,actor_id,reason_code,details,created_at
  )
  values(
    v_order_id,null,'awaiting_producer','system',null,'inventory_reserved',
    jsonb_build_object(
      'fulfillment_mode',v_mode,'producer_confirmation_seconds',300,
      'harvest_expected_start_at',case when v_mode='scheduled_harvest' then v_harvest_start else null end,
      'harvest_expected_end_at',case when v_mode='scheduled_harvest' then v_harvest_end else null end
    ),v_now
  );

  return query
  select o.id,o.order_code,o.status,o.fulfillment_mode,o.harvest_expected_start_at,o.harvest_expected_end_at,
         o.producer_confirm_expires_at,o.product_subtotal,o.cash_collection_required,o.cash_collection_amount,
         o.route_plan,o.assignment_anchor,o.delivery_fee,o.total_payable,o.preferred_vehicle_type,o.required_vehicle_type,o.pricing_version
  from public.agrimarket_orders o where o.id=v_order_id;
end;
$function$;

create or replace function public.agrimarket_reprice_after_harvest_adjustment_v1(
  p_order_id uuid,
  p_now timestamp with time zone default clock_timestamp()
)
returns void
language plpgsql
set search_path to 'public'
as $function$
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
  select o.* into v_order from public.agrimarket_orders o where o.id=p_order_id for update;
  if v_order.id is null then raise exception 'AGRIMARKET_ORDER_NOT_FOUND' using errcode='P0001'; end if;

  select round(coalesce(sum(oi.line_total),0),2),
         case
           when bool_or(p.vehicle_requirement='kolong_kolong') then 'kolong_kolong'
           when bool_or(p.vehicle_requirement='tricycle') then 'tricycle'
           else 'either'
         end
  into v_subtotal,v_required_vehicle
  from public.agrimarket_order_items oi
  left join public.agrimarket_products p on p.id=oi.product_id
  where oi.order_id=p_order_id;

  if v_subtotal<=0 then raise exception 'AGRIMARKET_ORDER_HAS_NO_ACTIVE_ITEMS' using errcode='P0001'; end if;

  select s.cash_first_threshold into v_threshold
  from public.agrimarket_pricing_settings s where s.id=1 and s.is_active=true;
  if v_threshold is null then raise exception 'AGRIMARKET_PRICING_NOT_CONFIGURED' using errcode='P0001'; end if;

  v_cash_first := v_subtotal>v_threshold;
  if v_order.farmer_to_customer_distance_km is null or v_order.farmer_to_customer_duration_seconds is null then
    raise exception 'AGRIMARKET_FARMER_CUSTOMER_ROUTE_REQUIRED' using errcode='P0001';
  end if;

  if v_cash_first then
    if v_order.customer_to_farmer_distance_km is null or v_order.customer_to_farmer_duration_seconds is null then
      raise exception 'AGRIMARKET_CUSTOMER_FARMER_ROUTE_REQUIRED' using errcode='P0001';
    end if;
    v_service_distance := round(v_order.customer_to_farmer_distance_km+v_order.farmer_to_customer_distance_km,3);
    v_service_duration := v_order.customer_to_farmer_duration_seconds+v_order.farmer_to_customer_duration_seconds;
  else
    v_service_distance := round(v_order.farmer_to_customer_distance_km,3);
    v_service_duration := v_order.farmer_to_customer_duration_seconds;
  end if;

  select * into v_quote from public.agrimarket_quote_delivery_v1(v_service_distance);

  update public.agrimarket_orders o
  set product_subtotal=v_subtotal,
      marketplace_fee=0,
      cash_collection_required=v_cash_first,
      cash_collection_amount=case when v_cash_first then v_subtotal else 0 end,
      route_plan=case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
      assignment_anchor=case when v_cash_first then 'customer' else 'farmer' end,
      route_distance_km=v_service_distance,
      route_duration_seconds=v_service_duration,
      delivery_base_fee=v_quote.base_delivery_fee,
      delivery_distance_fee=v_quote.route_distance_fee,
      delivery_rate_per_km=v_quote.route_fee_per_km,
      delivery_fee=v_quote.delivery_fee,
      delivery_company_cut=v_quote.delivery_company_cut,
      required_vehicle_type=coalesce(v_required_vehicle,'either'),
      pricing_snapshot=o.pricing_snapshot || jsonb_build_object(
        'harvest_adjustment_repriced_at',p_now,'product_subtotal',v_subtotal,
        'cash_collection_required',v_cash_first,
        'route_plan',case when v_cash_first then 'customer_cash_first' else 'farmer_first' end,
        'route_distance_km',v_service_distance,'delivery_fee',v_quote.delivery_fee
      ),
      updated_at=p_now
  where o.id=p_order_id;
end;
$function$;

create or replace function public.agrimarket_create_butchering_batch_v1(
  p_producer_id uuid,
  p_request_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  saved agrimarket_butchering_batches%rowtype;
  cut jsonb;
  cut_name text;
  names text[] := '{}';
  ids uuid[] := '{}';
  product_id uuid;
  starts timestamptz;
  ends timestamptz;
  cutoff timestamptz;
  price numeric;
  quantity numeric;
  prep integer;
begin
  if p_producer_id is null or p_request_id is null
     or coalesce(jsonb_typeof(p_payload),'')<>'object'
     or octet_length(p_payload::text)>65536 then
    raise exception 'BUTCHERING_INPUT_INVALID';
  end if;
  if not exists(select 1 from agrimarket_producers where id=p_producer_id and status='active') then
    raise exception 'BUTCHERING_PRODUCER_UNAVAILABLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('agrimarket_butchering:'||p_request_id::text,0));
  select * into saved from agrimarket_butchering_batches where request_id=p_request_id;
  if found then
    if saved.producer_id<>p_producer_id or saved.request_payload<>p_payload then
      raise exception 'BUTCHERING_REQUEST_CONFLICT';
    end if;
    return jsonb_build_object('request_id',p_request_id,'product_ids',saved.product_ids,'replayed',true);
  end if;

  if coalesce(length(btrim(p_payload->>'species')),0) not between 2 and 60
    or length(coalesce(p_payload->>'breed',''))>80
    or length(coalesce(p_payload->>'description',''))>2000
    or coalesce(p_payload->>'condition','') not in ('fresh','chilled')
    or coalesce(p_payload->>'vehicle_requirement','') not in ('either','motorcycle','tricycle','kolong_kolong')
    or coalesce(jsonb_typeof(p_payload->'is_active'),'')<>'boolean'
    or coalesce(jsonb_typeof(p_payload->'cuts'),'')<>'array' then
    raise exception 'BUTCHERING_INPUT_INVALID';
  end if;

  if jsonb_array_length(p_payload->'cuts') not between 1 and 30 then
    raise exception 'BUTCHERING_INPUT_INVALID';
  end if;

  begin
    starts := (p_payload->>'butcher_start_at')::timestamptz;
    ends := (p_payload->>'butcher_end_at')::timestamptz;
    cutoff := (p_payload->>'order_cutoff_at')::timestamptz;
    prep := (p_payload->>'default_prep_minutes')::integer;
  exception when others then
    raise exception 'BUTCHERING_INPUT_INVALID';
  end;

  if starts is null or cutoff is null or not isfinite(starts) or not isfinite(cutoff)
    or (ends is not null and (not isfinite(ends) or ends<starts))
    or cutoff<=clock_timestamp() or cutoff>=starts then
    raise exception 'BUTCHERING_SCHEDULE_INVALID';
  end if;
  if prep is null or prep not between 0 and 1440 then raise exception 'BUTCHERING_INPUT_INVALID'; end if;

  for cut in select value from jsonb_array_elements(p_payload->'cuts')
  loop
    cut_name := btrim(cut->>'name');
    if coalesce(length(cut_name),0) not between 2 and 80
      or lower(cut_name)=any(names)
      or coalesce(cut->>'price_per_kg','') !~ '^[0-9]+([.][0-9]{1,2})?$'
      or coalesce(cut->>'available_kg','') !~ '^[0-9]+([.][0-9]{1,2})?$' then
      raise exception 'BUTCHERING_INPUT_INVALID';
    end if;

    price := (cut->>'price_per_kg')::numeric;
    quantity := (cut->>'available_kg')::numeric;
    if price<=0 or price>999999.99 or quantity<=0 or quantity>100000 then
      raise exception 'BUTCHERING_INPUT_INVALID';
    end if;

    names := array_append(names,lower(cut_name));
    insert into agrimarket_products(
      producer_id,name,description,product_group,species,breed,meat_cut,condition,cargo_class,
      selling_unit,unit_weight_kg,unit_price,listed_quantity,availability_mode,
      harvest_start_at,harvest_end_at,harvest_order_cutoff_at,default_prep_minutes,
      vehicle_requirement,is_active
    )
    values(
      p_producer_id,(p_payload->>'species')||' - '||cut_name,p_payload->>'description','meat',
      p_payload->>'species',p_payload->>'breed',cut_name,p_payload->>'condition',
      case p_payload->>'condition' when 'chilled' then 'chilled_meat' else 'fresh_meat' end,
      'kg',1,price,quantity,'scheduled_harvest',starts,ends,cutoff,prep,
      p_payload->>'vehicle_requirement',(p_payload->>'is_active')::boolean
    )
    returning id into product_id;
    ids := array_append(ids,product_id);
  end loop;

  insert into agrimarket_butchering_batches(request_id,producer_id,request_payload,product_ids)
  values(p_request_id,p_producer_id,p_payload,ids);

  return jsonb_build_object('request_id',p_request_id,'product_ids',ids,'replayed',false);
end;
$function$;

do $postcondition$
declare
  v_errand_max numeric;
  v_agri_max numeric;
begin
  select kolong_kolong_max_kg into v_errand_max
  from public.errand_pricing_settings where singleton=true;
  select kolong_kolong_max_kg into v_agri_max
  from public.agrimarket_pricing_settings where id=1 and is_active=true;

  if v_errand_max <> 200 or v_agri_max <> 200 then
    raise exception 'KOLONG_KOLONG_MAX_NOT_200';
  end if;
  if public.jride_normalize_vehicle_type_v1('Kolong-Kolong') <> 'kolong_kolong' then
    raise exception 'KOLONG_KOLONG_NORMALIZATION_FAILED';
  end if;
  if public.jride_vehicle_rank_v1('motorcycle') <> 1
     or public.jride_vehicle_rank_v1('tricycle') <> 2
     or public.jride_vehicle_rank_v1('kolong_kolong') <> 3 then
    raise exception 'KOLONG_KOLONG_RANK_FAILED';
  end if;
  if public.agrimarket_compute_required_vehicle_v1(
       'either','exact',150,null,'standard',25
     ) <> 'kolong_kolong' then
    raise exception 'AGRIMARKET_150KG_NOT_KOLONG_KOLONG';
  end if;
  if public.agrimarket_compute_required_vehicle_v1(
       'either','exact',75,null,'standard',25
     ) <> 'tricycle' then
    raise exception 'AGRIMARKET_75KG_NOT_TRICYCLE_MINIMUM';
  end if;
end;
$postcondition$;
