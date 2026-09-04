create table if not exists public.errand_test_driver_controls (
  driver_id uuid primary key,
  bypass_arrival_proximity boolean not null default false,
  note text,
  updated_at timestamptz not null default now()
);

revoke all on table public.errand_test_driver_controls from public, anon, authenticated;
grant select, insert, update, delete on table public.errand_test_driver_controls to service_role, postgres;

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

  if exists (
    select 1
    from public.errand_test_driver_controls t
    where t.driver_id = v_driver_id
      and t.bypass_arrival_proximity = true
  ) then
    return new;
  end if;

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
