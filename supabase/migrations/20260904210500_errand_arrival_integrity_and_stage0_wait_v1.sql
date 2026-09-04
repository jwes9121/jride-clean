create or replace function public.errand_arrival_proximity_result_v1(
  p_driver_id uuid,
  p_target_lat double precision,
  p_target_lng double precision,
  p_at timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_lat double precision;
  v_lng double precision;
  v_updated_at timestamptz;
  v_distance_m double precision;
begin
  if p_driver_id is null or p_target_lat is null or p_target_lng is null then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_ARRIVAL_TARGET_OR_DRIVER_MISSING');
  end if;

  select dl.lat, dl.lng, dl.updated_at
    into v_lat, v_lng, v_updated_at
  from public.driver_locations dl
  where dl.driver_id = p_driver_id
  order by dl.updated_at desc nulls last
  limit 1;

  if v_lat is null or v_lng is null or v_updated_at is null then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_DRIVER_LOCATION_MISSING');
  end if;

  if v_updated_at < p_at - interval '2 minutes' then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_DRIVER_LOCATION_STALE',
      'location_updated_at', v_updated_at,
      'max_age_seconds', 120
    );
  end if;

  v_distance_m := public.jride_haversine_km(v_lat, v_lng, p_target_lat, p_target_lng) * 1000.0;

  if v_distance_m is null then
    return jsonb_build_object('ok', false, 'error', 'ERRAND_ARRIVAL_DISTANCE_UNAVAILABLE');
  end if;

  if v_distance_m > 200.0 then
    return jsonb_build_object(
      'ok', false,
      'error', 'ERRAND_ARRIVAL_TOO_FAR',
      'distance_meters', round(v_distance_m::numeric, 1),
      'max_distance_meters', 200,
      'location_updated_at', v_updated_at
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'distance_meters', round(v_distance_m::numeric, 1),
    'max_distance_meters', 200,
    'location_updated_at', v_updated_at
  );
end;
$function$;

revoke all on function public.errand_arrival_proximity_result_v1(uuid,double precision,double precision,timestamptz) from public, anon, authenticated;
grant execute on function public.errand_arrival_proximity_result_v1(uuid,double precision,double precision,timestamptz) to service_role, postgres;

create or replace function public.errand_enforce_arrival_proximity_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_driver_id uuid;
  v_target_lat double precision;
  v_target_lng double precision;
  v_target_kind text;
  v_result jsonb;
  v_sequence integer;
begin
  if coalesce(new.errand_stage, '') = coalesce(old.errand_stage, '') then
    return new;
  end if;

  if new.errand_stage not in ('stage0_review', 'waiting_at_stop', 'waiting_at_final_handoff') then
    return new;
  end if;

  select coalesce(b.assigned_driver_id, b.driver_id)
    into v_driver_id
  from public.bookings b
  where b.id = new.booking_id;

  if new.errand_stage = 'stage0_review' then
    v_target_kind := 'stage0';
    select b.pickup_lat, b.pickup_lng
      into v_target_lat, v_target_lng
    from public.bookings b
    where b.id = new.booking_id;
  elsif new.errand_stage = 'waiting_at_stop' then
    v_sequence := new.current_stop_sequence;
    v_target_kind := 'stop_' || coalesce(v_sequence::text, 'unknown');
    select s.lat::double precision, s.lng::double precision
      into v_target_lat, v_target_lng
    from public.errand_stops s
    where s.booking_id = new.booking_id
      and s.sequence = v_sequence;
  else
    v_target_kind := 'final';
    v_target_lat := new.final_lat::double precision;
    v_target_lng := new.final_lng::double precision;
  end if;

  v_result := public.errand_arrival_proximity_result_v1(
    v_driver_id,
    v_target_lat,
    v_target_lng,
    now()
  );

  if coalesce((v_result->>'ok')::boolean, false) is not true then
    raise exception 'ERRAND_ARRIVAL_PROXIMITY_BLOCKED target=% error=% distance_m=% max_m=%',
      v_target_kind,
      coalesce(v_result->>'error', 'UNKNOWN'),
      coalesce(v_result->>'distance_meters', 'n/a'),
      coalesce(v_result->>'max_distance_meters', '200')
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;

revoke all on function public.errand_enforce_arrival_proximity_v1() from public, anon, authenticated;
grant execute on function public.errand_enforce_arrival_proximity_v1() to service_role, postgres;

drop trigger if exists trg_errand_enforce_arrival_proximity_v1 on public.errand_jobs;
create trigger trg_errand_enforce_arrival_proximity_v1
before update of errand_stage on public.errand_jobs
for each row
execute function public.errand_enforce_arrival_proximity_v1();

create or replace function public.errand_pause_stage0_wait_for_passenger_review_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_elapsed integer := 0;
  v_total_wait integer := 0;
  v_wait_minutes integer := 0;
begin
  if new.errand_stage <> 'awaiting_customer_confirmation'
     or coalesce(old.errand_stage, '') = 'awaiting_customer_confirmation' then
    return new;
  end if;

  if new.waiting_started_at is not null then
    v_elapsed := greatest(
      floor(extract(epoch from (now() - new.waiting_started_at)))::integer,
      0
    );
  end if;

  v_total_wait := greatest(coalesce(new.waiting_accumulated_seconds, 0), 0) + v_elapsed;
  v_wait_minutes := case
    when v_total_wait <= 0 then 0
    else ceil(v_total_wait::numeric / 60)::integer
  end;

  new.waiting_accumulated_seconds := v_total_wait;
  new.waiting_started_at := null;

  update public.bookings
  set waiting_minutes = v_wait_minutes,
      updated_at = now()
  where id = new.booking_id;

  return new;
end;
$function$;

revoke all on function public.errand_pause_stage0_wait_for_passenger_review_v1() from public, anon, authenticated;
grant execute on function public.errand_pause_stage0_wait_for_passenger_review_v1() to service_role, postgres;

drop trigger if exists trg_errand_pause_stage0_wait_for_passenger_review_v1 on public.errand_jobs;
create trigger trg_errand_pause_stage0_wait_for_passenger_review_v1
before update of errand_stage on public.errand_jobs
for each row
execute function public.errand_pause_stage0_wait_for_passenger_review_v1();
