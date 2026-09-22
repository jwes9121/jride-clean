-- Additive route-planning preparation. Does not enable JFleet or verify documents.
create table public.jfleet_route_plans (
  id uuid primary key default gen_random_uuid(),
  passenger_user_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'building' check (status in ('building','ready','failed','submitted')),
  points jsonb not null check (jsonb_typeof(points) = 'array' and jsonb_array_length(points) between 2 and 21),
  route jsonb,
  error_code text,
  inquiry_id uuid unique references public.jfleet_inquiries(id) on delete restrict,
  submission_details jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '30 minutes'),
  check (status not in ('ready','submitted') or (route is not null and jsonb_typeof(route) = 'object')),
  check ((status = 'submitted') = (inquiry_id is not null))
);
create index jfleet_route_plans_passenger_time_idx on public.jfleet_route_plans(passenger_user_id,created_at desc);
alter table public.jfleet_route_plans enable row level security;
revoke all on public.jfleet_route_plans from public,anon,authenticated;
grant select,insert,update on public.jfleet_route_plans to service_role;
alter table public.jfleet_itineraries add column route_plan_id uuid unique references public.jfleet_route_plans(id) on delete restrict;

create or replace function public.jfleet_begin_route_plan_v1(p_user_id uuid,p_points jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $jfleet$
declare v_plan public.jfleet_route_plans%rowtype; v_point jsonb; v_count integer;
begin
  if p_user_id is null or p_points is null or jsonb_typeof(p_points) <> 'array' then
    raise exception 'JFLEET_ROUTE_INPUT_INVALID';
  end if;
  if jsonb_array_length(p_points) not between 2 and 21 then raise exception 'JFLEET_ROUTE_INPUT_INVALID'; end if;
  for v_point in select value from jsonb_array_elements(p_points) loop
    if jsonb_typeof(v_point->'lat') is distinct from 'number'
       or jsonb_typeof(v_point->'lng') is distinct from 'number'
       or jsonb_typeof(v_point->'label') is distinct from 'string'
       or length(trim(v_point->>'label')) not between 2 and 180 then
      raise exception 'JFLEET_ROUTE_INPUT_INVALID';
    end if;
    if (v_point->>'lat')::numeric not between -90 and 90
       or (v_point->>'lng')::numeric not between -180 and 180 then raise exception 'JFLEET_ROUTE_INPUT_INVALID'; end if;
  end loop;
  -- Technical anti-abuse budget, not a limit on legitimate open inquiries.
  perform pg_advisory_xact_lock(hashtextextended('jfleet_route:' || p_user_id::text,0));
  select count(*) into v_count from public.jfleet_route_plans
    where passenger_user_id=p_user_id and created_at > clock_timestamp()-interval '1 hour';
  if v_count >= 20 then raise exception 'JFLEET_ROUTE_RATE_LIMIT'; end if;
  insert into public.jfleet_route_plans(passenger_user_id,points) values(p_user_id,p_points) returning * into v_plan;
  return jsonb_build_object('id',v_plan.id,'expires_at',v_plan.expires_at);
end;
$jfleet$;

create or replace function public.jfleet_submit_route_plan_v1(
  p_plan_id uuid,p_user_id uuid,p_points jsonb,p_details jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $jfleet$
declare
  v_plan public.jfleet_route_plans%rowtype;
  v_partner uuid;
  v_start timestamptz; v_end timestamptz; v_mode text;
  v_stops jsonb; v_result jsonb; v_inquiry uuid; v_code text;
  v_count integer; v_passengers integer; v_weight numeric;
begin
  select * into v_plan from public.jfleet_route_plans
    where id=p_plan_id and passenger_user_id=p_user_id for update;
  if v_plan.id is null then raise exception 'JFLEET_ROUTE_PLAN_NOT_FOUND'; end if;
  if p_points is distinct from v_plan.points then raise exception 'JFLEET_ROUTE_PLAN_CHANGED'; end if;
  if v_plan.status='submitted' then
    if v_plan.submission_details is distinct from p_details then raise exception 'JFLEET_ROUTE_RETRY_CONFLICT'; end if;
    select jsonb_build_object('ok',true,'inquiry_id',id,'inquiry_code',inquiry_code,'status',status,'quote_due_at',quote_due_at)
      into v_result from public.jfleet_inquiries where id=v_plan.inquiry_id;
    return v_result || jsonb_build_object('already_submitted',true);
  end if;
  if v_plan.status <> 'ready' then raise exception 'JFLEET_ROUTE_NOT_READY'; end if;
  if v_plan.expires_at <= clock_timestamp() then raise exception 'JFLEET_ROUTE_PLAN_EXPIRED'; end if;
  if p_details is null or jsonb_typeof(p_details) <> 'object' then raise exception 'JFLEET_INQUIRY_DETAILS_INVALID'; end if;
  v_mode := p_details->>'trip_mode';
  if v_mode is null or v_mode not in ('one_way','round_trip','multi_day') then raise exception 'JFLEET_INQUIRY_DETAILS_INVALID'; end if;
  v_start := (p_details->>'scheduled_start_at')::timestamptz;
  v_end := (p_details->>'scheduled_end_at')::timestamptz;
  if v_start is null or v_end is null or v_start <= clock_timestamp() or v_end <= v_start then
    raise exception 'JFLEET_TRIP_SCHEDULE_INVALID';
  end if;
  v_count := jsonb_array_length(v_plan.points);
  if v_mode='round_trip' and (
    v_count < 3 or
    (v_plan.points->0->'lat') is distinct from (v_plan.points->(v_count-1)->'lat') or
    (v_plan.points->0->'lng') is distinct from (v_plan.points->(v_count-1)->'lng')
  ) then raise exception 'JFLEET_RETURN_PIN_REQUIRED'; end if;
  v_passengers := (p_details->>'passenger_count')::integer;
  v_weight := (p_details->>'cargo_weight_kg')::numeric;
  if v_passengers is not null and v_passengers <= 0 then raise exception 'JFLEET_PASSENGER_COUNT_INVALID'; end if;
  if v_weight is not null and v_weight <= 0 then raise exception 'JFLEET_CARGO_WEIGHT_INVALID'; end if;
  select id into v_partner from public.jfleet_partners where status='active'
    order by is_priority_pilot desc,created_at,id limit 1 for share;
  if v_partner is null then raise exception 'JFLEET_PARTNER_NOT_ACTIVE'; end if;
  select jsonb_agg(jsonb_build_object(
    'label',value->>'label','lat',value->'lat','lng',value->'lng','notes',value->>'notes',
    'stop_type',case when ord=v_count then case when v_mode='round_trip' then 'return' else 'destination' end else 'stop' end
  ) order by ord) into v_stops from jsonb_array_elements(v_plan.points) with ordinality as s(value,ord) where ord>1;
  v_code := 'JFQ-' || upper(replace(gen_random_uuid()::text,'-',''));
  v_result := public.jfleet_create_inquiry_v1(
    v_code,p_user_id,v_partner,p_details->>'purpose',p_details->>'requested_vehicle_type',v_mode,
    v_plan.points->0->>'label',(v_plan.points->0->>'lat')::double precision,(v_plan.points->0->>'lng')::double precision,
    v_start,v_end,v_passengers,p_details->>'cargo_description',v_weight,
    p_details->>'luggage_notes',p_details->>'special_notes',v_stops
  );
  v_inquiry := (v_result->>'inquiry_id')::uuid;
  update public.jfleet_itineraries set route_plan_id=v_plan.id where inquiry_id=v_inquiry and version_no=1;
  update public.jfleet_route_plans set status='submitted',inquiry_id=v_inquiry,submission_details=p_details where id=v_plan.id;
  return v_result || jsonb_build_object('already_submitted',false,'route_plan_id',v_plan.id);
end;
$jfleet$;
revoke all on function public.jfleet_begin_route_plan_v1(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.jfleet_submit_route_plan_v1(uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.jfleet_begin_route_plan_v1(uuid,jsonb) to service_role;
grant execute on function public.jfleet_submit_route_plan_v1(uuid,uuid,jsonb,jsonb) to service_role;
comment on table public.jfleet_route_plans is 'Server-generated road-route drafts bound to the requesting passenger. Not safety-approved routes. Submitted plans are retained with their inquiry for audit.';
