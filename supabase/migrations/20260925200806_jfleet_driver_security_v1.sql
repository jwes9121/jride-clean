-- JFleet driver security monitoring v1.
-- No partner policy is enabled by this migration.

create table public.jfleet_security_policies (
  partner_id uuid primary key references public.jfleet_partners(id) on delete cascade,
  enabled boolean not null default false,
  max_accuracy_m numeric(8,2),
  route_warning_m numeric(10,2),
  route_critical_m numeric(10,2),
  route_bad_points_required integer,
  route_bad_seconds_required integer,
  route_recovery_points_required integer,
  gap_warning_seconds integer,
  gap_critical_seconds integer,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check (
    not enabled or (
      max_accuracy_m between 10 and 500
      and route_warning_m between 50 and 5000
      and route_critical_m between route_warning_m and 20000
      and route_bad_points_required between 1 and 20
      and route_bad_seconds_required between 0 and 3600
      and route_recovery_points_required between 1 and 20
      and gap_warning_seconds between 30 and 3600
      and gap_critical_seconds between gap_warning_seconds and 7200
    )
  )
);

create table public.jfleet_security_state (
  booking_id uuid primary key references public.jfleet_bookings(id) on delete cascade,
  driver_id uuid not null references public.jfleet_drivers(id) on delete restrict,
  route_review_id uuid references public.jfleet_route_reviews(id) on delete restrict,
  route_plan_id uuid references public.jfleet_route_plans(id) on delete restrict,
  last_location_captured_at timestamptz,
  last_location_received_at timestamptz,
  last_distance_m numeric(12,2),
  last_accuracy_m numeric(12,2),
  deviation_started_at timestamptz,
  deviation_bad_points integer not null default 0 check (deviation_bad_points >= 0),
  recovery_good_points integer not null default 0 check (recovery_good_points >= 0),
  monitoring_paused_reason text,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.jfleet_bookings
  add column tracking_required_from timestamptz,
  add column tracking_ended_at timestamptz;

alter table public.jfleet_route_deviation_events
  add column event_type text not null default 'route_deviation'
    check (event_type in ('route_deviation','tracking_gap','route_monitoring_paused')),
  add column severity text not null default 'warning'
    check (severity in ('warning','critical')),
  add column first_observed_at timestamptz not null default clock_timestamp(),
  add column last_observed_at timestamptz not null default clock_timestamp(),
  add column occurrence_count integer not null default 1 check (occurrence_count >= 1);

create unique index jfleet_security_one_active_event_idx
  on public.jfleet_route_deviation_events(booking_id,event_type)
  where event_status in ('open','acknowledged');

create index jfleet_security_events_type_status_idx
  on public.jfleet_route_deviation_events(event_type,event_status,last_observed_at desc);

create index jfleet_security_state_driver_idx
  on public.jfleet_security_state(driver_id);

alter table public.jfleet_security_policies enable row level security;
alter table public.jfleet_security_state enable row level security;
revoke all on public.jfleet_security_policies from public,anon,authenticated;
revoke all on public.jfleet_security_state from public,anon,authenticated;
grant select,insert,update,delete on public.jfleet_security_policies to service_role;
grant select,insert,update,delete on public.jfleet_security_state to service_role;

create trigger jfleet_security_policies_touch_updated_at
before update on public.jfleet_security_policies
for each row execute function public.jfleet_touch_updated_at_v1();

create trigger jfleet_security_state_touch_updated_at
before update on public.jfleet_security_state
for each row execute function public.jfleet_touch_updated_at_v1();

create or replace function public.jfleet_tracking_window_v1()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_tracking boolean := old.status in ('driver_en_route','driver_arrived','ready_for_trip','on_trip');
  new_tracking boolean := new.status in ('driver_en_route','driver_arrived','ready_for_trip','on_trip');
  new_terminal boolean := new.status in ('completed','cancelled_customer','cancelled_operator');
begin
  if new_tracking and not old_tracking then
    new.tracking_required_from := coalesce(new.tracking_required_from,clock_timestamp());
    new.tracking_ended_at := null;
  elsif new_terminal and not (old.status in ('completed','cancelled_customer','cancelled_operator')) then
    new.tracking_ended_at := coalesce(new.tracking_ended_at,clock_timestamp());
  end if;
  return new;
end;
$$;

create trigger jfleet_tracking_window_trg
before update of status on public.jfleet_bookings
for each row execute function public.jfleet_tracking_window_v1();

create or replace function public.jfleet_point_route_distance_m_v1(
  p_route jsonb,
  p_lat double precision,
  p_lng double precision
)
returns double precision
language plpgsql
immutable
set search_path = ''
as $$
declare
  coords jsonb;
  n integer;
  i integer;
  a jsonb;
  b jsonb;
  a_lng double precision;
  a_lat double precision;
  b_lng double precision;
  b_lat double precision;
  lat_rad double precision;
  meters_lat double precision;
  meters_lng double precision;
  ax double precision;
  ay double precision;
  bx double precision;
  b_y double precision;
  dx double precision;
  dy double precision;
  denom double precision;
  t double precision;
  px double precision;
  py double precision;
  d double precision;
  best double precision := null;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'JFLEET_SECURITY_POINT_INVALID';
  end if;
  if p_route->>'provider' is distinct from 'mapbox'
     or p_route->>'profile' is distinct from 'driving'
     or p_route#>>'{geometry,type}' is distinct from 'LineString'
     or jsonb_typeof(p_route#>'{geometry,coordinates}') is distinct from 'array' then
    raise exception 'JFLEET_SECURITY_ROUTE_INVALID';
  end if;

  coords := p_route#>'{geometry,coordinates}';
  n := jsonb_array_length(coords);
  if n < 2 then raise exception 'JFLEET_SECURITY_ROUTE_INVALID'; end if;

  lat_rad := radians(p_lat);
  meters_lat := 111132.92 - 559.82*cos(2*lat_rad) + 1.175*cos(4*lat_rad);
  meters_lng := 111412.84*cos(lat_rad) - 93.5*cos(3*lat_rad);

  for i in 0..n-2 loop
    a := coords->i;
    b := coords->(i+1);
    if jsonb_typeof(a) is distinct from 'array'
       or jsonb_typeof(b) is distinct from 'array'
       or jsonb_array_length(a) < 2
       or jsonb_array_length(b) < 2 then
      raise exception 'JFLEET_SECURITY_ROUTE_INVALID';
    end if;

    begin
      a_lng := (a->>0)::double precision;
      a_lat := (a->>1)::double precision;
      b_lng := (b->>0)::double precision;
      b_lat := (b->>1)::double precision;
    exception when others then
      raise exception 'JFLEET_SECURITY_ROUTE_INVALID';
    end;

    if a_lat not between -90 and 90 or b_lat not between -90 and 90
       or a_lng not between -180 and 180 or b_lng not between -180 and 180 then
      raise exception 'JFLEET_SECURITY_ROUTE_INVALID';
    end if;

    ax := (a_lng-p_lng)*meters_lng;
    ay := (a_lat-p_lat)*meters_lat;
    bx := (b_lng-p_lng)*meters_lng;
    b_y := (b_lat-p_lat)*meters_lat;
    dx := bx-ax;
    dy := b_y-ay;
    denom := dx*dx + dy*dy;

    if denom <= 0 then
      t := 0;
    else
      t := greatest(0.0,least(1.0,-(ax*dx+ay*dy)/denom));
    end if;
    px := ax+t*dx;
    py := ay+t*dy;
    d := sqrt(px*px+py*py);
    if best is null or d < best then best := d; end if;
  end loop;

  return best;
end;
$$;

create or replace function public.jfleet_authorized_route_v1(p_booking_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  b public.jfleet_bookings%rowtype;
  review public.jfleet_route_reviews%rowtype;
  addon public.jfleet_addons%rowtype;
  itinerary public.jfleet_itineraries%rowtype;
  plan public.jfleet_route_plans%rowtype;
begin
  select * into b from public.jfleet_bookings where id=p_booking_id;
  if b.id is null then raise exception 'JFLEET_BOOKING_NOT_FOUND'; end if;
  if b.route_review_id is null or b.quoted_route_plan_id is null then
    raise exception 'JFLEET_SECURITY_ROUTE_NOT_BOUND';
  end if;

  select * into review from public.jfleet_route_reviews where id=b.route_review_id;
  if review.id is null or review.decision<>'approved'
     or review.route_plan_id is distinct from b.quoted_route_plan_id then
    raise exception 'JFLEET_SECURITY_ROUTE_NOT_BOUND';
  end if;

  select * into addon
  from public.jfleet_addons
  where booking_id=b.id and status='paid'
  order by payment_confirmed_at desc nulls last,created_at desc
  limit 1;

  if addon.id is not null and addon.itinerary_id_after is null then
    return jsonb_build_object(
      'ok',true,
      'paused_reason','paid_addon_without_routed_itinerary',
      'route',review.snapshot->'route',
      'route_plan_id',review.route_plan_id,
      'source','quoted_route'
    );
  end if;

  if addon.id is not null and addon.itinerary_id_after is not null then
    select * into itinerary from public.jfleet_itineraries where id=addon.itinerary_id_after;
    if itinerary.id is null or itinerary.route_plan_id is null then
      return jsonb_build_object(
        'ok',true,'paused_reason','paid_addon_route_missing',
        'route',review.snapshot->'route','route_plan_id',review.route_plan_id,'source','quoted_route'
      );
    end if;
    select * into plan from public.jfleet_route_plans where id=itinerary.route_plan_id;
    if plan.id is null or plan.status<>'submitted' then
      return jsonb_build_object(
        'ok',true,'paused_reason','paid_addon_route_not_submitted',
        'route',review.snapshot->'route','route_plan_id',review.route_plan_id,'source','quoted_route'
      );
    end if;
    return jsonb_build_object(
      'ok',true,'paused_reason',null,
      'route',plan.route,'route_plan_id',plan.id,'source','paid_addon_route'
    );
  end if;

  return jsonb_build_object(
    'ok',true,'paused_reason',null,
    'route',review.snapshot->'route','route_plan_id',review.route_plan_id,'source','quoted_route'
  );
end;
$$;

create or replace function public.jfleet_upsert_security_event_v1(
  p_booking_id uuid,
  p_driver_id uuid,
  p_event_type text,
  p_severity text,
  p_distance_m numeric,
  p_details jsonb,
  p_now timestamptz default clock_timestamp()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e public.jfleet_route_deviation_events%rowtype;
begin
  if p_event_type not in ('route_deviation','tracking_gap','route_monitoring_paused')
     or p_severity not in ('warning','critical') then
    raise exception 'JFLEET_SECURITY_EVENT_INVALID';
  end if;

  select * into e
  from public.jfleet_route_deviation_events
  where booking_id=p_booking_id and event_type=p_event_type
    and event_status in ('open','acknowledged')
  order by detected_at desc
  limit 1
  for update;

  if e.id is null then
    insert into public.jfleet_route_deviation_events(
      booking_id,driver_id,event_type,event_status,severity,deviation_distance_m,
      detected_at,first_observed_at,last_observed_at,occurrence_count,details
    ) values (
      p_booking_id,p_driver_id,p_event_type,'open',p_severity,p_distance_m,
      p_now,p_now,p_now,1,coalesce(p_details,'{}'::jsonb)
    ) returning * into e;

    insert into public.jfleet_events(
      booking_id,actor_type,actor_id,event_type,details,created_at
    ) values (
      p_booking_id,'system',null,'security_'||p_event_type||'_opened',
      jsonb_build_object('security_event_id',e.id,'severity',p_severity)||
        coalesce(p_details,'{}'::jsonb),
      p_now
    );
  else
    update public.jfleet_route_deviation_events
    set severity=case when severity='critical' or p_severity='critical' then 'critical' else 'warning' end,
        deviation_distance_m=p_distance_m,
        last_observed_at=p_now,
        occurrence_count=occurrence_count+1,
        details=details||coalesce(p_details,'{}'::jsonb),
        updated_at=p_now
    where id=e.id
    returning * into e;
  end if;
  return e.id;
end;
$$;

create or replace function public.jfleet_resolve_security_event_v1(
  p_booking_id uuid,
  p_event_type text,
  p_reason text,
  p_now timestamptz default clock_timestamp()
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  update public.jfleet_route_deviation_events
  set event_status='resolved',
      resolved_at=p_now,
      resolution_reason=coalesce(nullif(trim(p_reason),''),'resolved'),
      updated_at=p_now
  where booking_id=p_booking_id and event_type=p_event_type
    and event_status in ('open','acknowledged');
  get diagnostics n = row_count;

  if n>0 then
    insert into public.jfleet_events(booking_id,actor_type,event_type,details,created_at)
    values(p_booking_id,'system','security_'||p_event_type||'_resolved',
      jsonb_build_object('reason',coalesce(nullif(trim(p_reason),''),'resolved')),p_now);
  end if;
  return n;
end;
$$;

create or replace function public.jfleet_driver_location_security_v1(
  p_driver_id uuid,
  p_booking_id uuid,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_heading_deg double precision,
  p_speed_mps double precision,
  p_device_id text,
  p_captured_at timestamptz,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  base jsonb;
  b public.jfleet_bookings%rowtype;
  policy public.jfleet_security_policies%rowtype;
  state public.jfleet_security_state%rowtype;
  auth_route jsonb;
  distance_m double precision;
  elapsed_bad numeric;
  severity text;
  event_id uuid;
  captured timestamptz := coalesce(p_captured_at,p_now);
begin
  base := public.jfleet_driver_location_v1(
    p_driver_id,p_booking_id,p_lat,p_lng,p_accuracy_m,p_heading_deg,p_speed_mps,
    p_device_id,p_captured_at,p_now
  );

  select * into b from public.jfleet_bookings
  where id=p_booking_id and assigned_driver_id=p_driver_id;

  if b.id is null then raise exception 'JFLEET_ACTIVE_DRIVER_BOOKING_NOT_FOUND'; end if;

  select * into policy from public.jfleet_security_policies where partner_id=b.partner_id;
  if policy.partner_id is null or policy.enabled is distinct from true then
    return base||jsonb_build_object('security_monitoring',false,'route_evaluation','policy_not_enabled');
  end if;

  insert into public.jfleet_security_state(
    booking_id,driver_id,route_review_id,route_plan_id
  ) values (
    b.id,p_driver_id,b.route_review_id,b.quoted_route_plan_id
  ) on conflict(booking_id) do nothing;

  select * into state from public.jfleet_security_state where booking_id=b.id for update;

  if state.driver_id is distinct from p_driver_id then
    update public.jfleet_security_state
    set driver_id=p_driver_id,
        deviation_started_at=null,
        deviation_bad_points=0,
        recovery_good_points=0,
        last_location_captured_at=null,
        last_location_received_at=null,
        updated_at=p_now
    where booking_id=b.id
    returning * into state;
  end if;

  if state.last_location_captured_at is not null and captured<=state.last_location_captured_at then
    return base||jsonb_build_object(
      'security_monitoring',true,'route_evaluation','ignored_out_of_order'
    );
  end if;

  update public.jfleet_security_state
  set last_location_captured_at=captured,
      last_location_received_at=p_now,
      last_accuracy_m=p_accuracy_m,
      updated_at=p_now
  where booking_id=b.id;

  perform public.jfleet_resolve_security_event_v1(b.id,'tracking_gap','fresh_location_received',p_now);

  if b.status<>'on_trip' then
    return base||jsonb_build_object(
      'security_monitoring',true,'route_evaluation','tracking_only'
    );
  end if;

  if p_accuracy_m is null or p_accuracy_m<=0 or p_accuracy_m>policy.max_accuracy_m then
    return base||jsonb_build_object(
      'security_monitoring',true,'route_evaluation','ignored_accuracy',
      'max_accuracy_m',policy.max_accuracy_m
    );
  end if;

  auth_route := public.jfleet_authorized_route_v1(b.id);

  if nullif(auth_route->>'paused_reason','') is not null then
    update public.jfleet_security_state
    set monitoring_paused_reason=auth_route->>'paused_reason',
        deviation_started_at=null,deviation_bad_points=0,recovery_good_points=0,
        updated_at=p_now
    where booking_id=b.id;

    event_id := public.jfleet_upsert_security_event_v1(
      b.id,p_driver_id,'route_monitoring_paused','warning',null,
      jsonb_build_object(
        'reason',auth_route->>'paused_reason',
        'route_source',auth_route->>'source'
      ),p_now
    );

    perform public.jfleet_resolve_security_event_v1(b.id,'route_deviation','monitoring_paused',p_now);

    return base||jsonb_build_object(
      'security_monitoring',true,'route_evaluation','paused',
      'paused_reason',auth_route->>'paused_reason','security_event_id',event_id
    );
  end if;

  update public.jfleet_security_state
  set monitoring_paused_reason=null,route_plan_id=(auth_route->>'route_plan_id')::uuid,updated_at=p_now
  where booking_id=b.id;

  perform public.jfleet_resolve_security_event_v1(b.id,'route_monitoring_paused','route_geometry_available',p_now);

  distance_m := public.jfleet_point_route_distance_m_v1(
    auth_route->'route',p_lat,p_lng
  );

  if distance_m>policy.route_warning_m then
    if state.deviation_started_at is null then
      state.deviation_started_at := captured;
      state.deviation_bad_points := 1;
    else
      state.deviation_bad_points := state.deviation_bad_points+1;
    end if;
    state.recovery_good_points := 0;
    elapsed_bad := greatest(0,extract(epoch from (captured-state.deviation_started_at)));
    severity := case when distance_m>=policy.route_critical_m then 'critical' else 'warning' end;

    update public.jfleet_security_state
    set last_distance_m=round(distance_m::numeric,2),
        deviation_started_at=state.deviation_started_at,
        deviation_bad_points=state.deviation_bad_points,
        recovery_good_points=0,
        updated_at=p_now
    where booking_id=b.id;

    if state.deviation_bad_points>=policy.route_bad_points_required
       and elapsed_bad>=policy.route_bad_seconds_required then
      event_id := public.jfleet_upsert_security_event_v1(
        b.id,p_driver_id,'route_deviation',severity,round(distance_m::numeric,2),
        jsonb_build_object(
          'lat',p_lat,'lng',p_lng,'accuracy_m',p_accuracy_m,
          'route_source',auth_route->>'source',
          'route_plan_id',auth_route->>'route_plan_id',
          'bad_points',state.deviation_bad_points,
          'bad_seconds',elapsed_bad
        ),p_now
      );
    end if;

    return base||jsonb_build_object(
      'security_monitoring',true,'route_evaluation','outside_corridor',
      'distance_m',round(distance_m::numeric,2),
      'severity',severity,'bad_points',state.deviation_bad_points,
      'bad_seconds',elapsed_bad,'security_event_id',event_id
    );
  end if;

  state.recovery_good_points := state.recovery_good_points+1;
  update public.jfleet_security_state
  set last_distance_m=round(distance_m::numeric,2),
      deviation_started_at=null,
      deviation_bad_points=0,
      recovery_good_points=state.recovery_good_points,
      updated_at=p_now
  where booking_id=b.id;

  if state.recovery_good_points>=policy.route_recovery_points_required then
    perform public.jfleet_resolve_security_event_v1(b.id,'route_deviation','route_recovered',p_now);
  end if;

  return base||jsonb_build_object(
    'security_monitoring',true,'route_evaluation','inside_corridor',
    'distance_m',round(distance_m::numeric,2),
    'recovery_points',state.recovery_good_points
  );
end;
$$;

create or replace function public.jfleet_scan_tracking_gaps_v1(
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  row record;
  last_fix timestamptz;
  anchor timestamptz;
  gap_seconds numeric;
  severity text;
  opened integer := 0;
  resolved integer := 0;
  checked integer := 0;
begin
  for row in
    select b.id as booking_id,b.assigned_driver_id as driver_id,b.tracking_required_from,
           p.gap_warning_seconds,p.gap_critical_seconds
    from public.jfleet_bookings b
    join public.jfleet_security_policies p on p.partner_id=b.partner_id and p.enabled=true
    where b.assigned_driver_id is not null
      and b.tracking_required_from is not null
      and b.tracking_ended_at is null
      and b.status in ('driver_en_route','driver_arrived','ready_for_trip','on_trip')
  loop
    checked := checked+1;
    select captured_at into last_fix
    from public.jfleet_driver_locations
    where driver_id=row.driver_id and booking_id=row.booking_id;

    anchor := coalesce(last_fix,row.tracking_required_from);
    gap_seconds := greatest(0,extract(epoch from (p_now-anchor)));

    if gap_seconds>=row.gap_warning_seconds then
      severity := case when gap_seconds>=row.gap_critical_seconds then 'critical' else 'warning' end;
      perform public.jfleet_upsert_security_event_v1(
        row.booking_id,row.driver_id,'tracking_gap',severity,null,
        jsonb_build_object('gap_seconds',gap_seconds,'last_location_at',last_fix),p_now
      );
      opened := opened+1;
    else
      resolved := resolved+public.jfleet_resolve_security_event_v1(
        row.booking_id,'tracking_gap','location_fresh',p_now
      );
    end if;
  end loop;

  return jsonb_build_object('ok',true,'checked',checked,'gap_events_touched',opened,'events_resolved',resolved);
end;
$$;

create or replace function public.jfleet_owner_security_event_action_v1(
  p_event_id uuid,
  p_owner_user_id uuid,
  p_action text,
  p_reason text default null,
  p_now timestamptz default clock_timestamp()
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  e public.jfleet_route_deviation_events%rowtype;
  b public.jfleet_bookings%rowtype;
  p public.jfleet_partners%rowtype;
  action text := lower(trim(coalesce(p_action,'')));
  reason text := nullif(trim(coalesce(p_reason,'')),'');
begin
  select * into e from public.jfleet_route_deviation_events where id=p_event_id for update;
  if e.id is null then raise exception 'JFLEET_SECURITY_EVENT_NOT_FOUND'; end if;

  select * into b from public.jfleet_bookings where id=e.booking_id;
  select * into p from public.jfleet_partners
  where id=b.partner_id and owner_user_id=p_owner_user_id and status='active';

  if p.id is null then raise exception 'JFLEET_OWNER_NOT_AUTHORIZED'; end if;

  if action='acknowledge' then
    if e.event_status='resolved' then raise exception 'JFLEET_SECURITY_EVENT_CLOSED'; end if;
    update public.jfleet_route_deviation_events
    set event_status='acknowledged',acknowledged_at=coalesce(acknowledged_at,p_now),updated_at=p_now
    where id=e.id returning * into e;
  elsif action='approve_detour' then
    if e.event_type<>'route_deviation' or e.event_status not in ('open','acknowledged') then
      raise exception 'JFLEET_SECURITY_DETOUR_NOT_AVAILABLE';
    end if;
    if reason is null then raise exception 'JFLEET_SECURITY_REASON_REQUIRED'; end if;
    update public.jfleet_route_deviation_events
    set event_status='approved_detour',acknowledged_at=coalesce(acknowledged_at,p_now),
        resolved_at=p_now,resolution_reason=reason,updated_at=p_now
    where id=e.id returning * into e;
  elsif action='resolve' then
    if e.event_status='resolved' then
      return jsonb_build_object('ok',true,'event_id',e.id,'status',e.event_status,'already_resolved',true);
    end if;
    if reason is null then raise exception 'JFLEET_SECURITY_REASON_REQUIRED'; end if;
    update public.jfleet_route_deviation_events
    set event_status='resolved',resolved_at=p_now,resolution_reason=reason,updated_at=p_now
    where id=e.id returning * into e;
  else
    raise exception 'JFLEET_SECURITY_ACTION_INVALID';
  end if;

  insert into public.jfleet_events(booking_id,actor_type,actor_id,event_type,details,created_at)
  values(
    e.booking_id,'owner',p_owner_user_id::text,'security_event_'||action,
    jsonb_build_object('security_event_id',e.id,'event_type',e.event_type,'reason',reason),p_now
  );

  return jsonb_build_object(
    'ok',true,'event_id',e.id,'event_type',e.event_type,
    'status',e.event_status,'severity',e.severity
  );
end;
$$;

revoke all on function public.jfleet_tracking_window_v1() from public,anon,authenticated;
revoke all on function public.jfleet_point_route_distance_m_v1(jsonb,double precision,double precision) from public,anon,authenticated;
revoke all on function public.jfleet_authorized_route_v1(uuid) from public,anon,authenticated;
revoke all on function public.jfleet_upsert_security_event_v1(uuid,uuid,text,text,numeric,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.jfleet_resolve_security_event_v1(uuid,text,text,timestamptz) from public,anon,authenticated;
revoke all on function public.jfleet_driver_location_security_v1(uuid,uuid,double precision,double precision,double precision,double precision,double precision,text,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.jfleet_scan_tracking_gaps_v1(timestamptz) from public,anon,authenticated;
revoke all on function public.jfleet_owner_security_event_action_v1(uuid,uuid,text,text,timestamptz) from public,anon,authenticated;

grant execute on function public.jfleet_driver_location_security_v1(uuid,uuid,double precision,double precision,double precision,double precision,double precision,text,timestamptz,timestamptz) to service_role;
grant execute on function public.jfleet_scan_tracking_gaps_v1(timestamptz) to service_role;
grant execute on function public.jfleet_owner_security_event_action_v1(uuid,uuid,text,text,timestamptz) to service_role;

do $$
declare existing_job bigint;
begin
  select jobid into existing_job from cron.job where jobname='jfleet_tracking_gap_scan_v1';
  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
  perform cron.schedule(
    'jfleet_tracking_gap_scan_v1',
    '* * * * *',
    'select public.jfleet_scan_tracking_gaps_v1();'
  );
end;
$$;

comment on table public.jfleet_security_policies is
  'JRide-configured JFleet security thresholds. No policy is enabled by default.';
comment on table public.jfleet_security_state is
  'Per-booking route and tracking monitor state. Paid side trips without routed geometry pause route-deviation evaluation rather than create false alarms.';
