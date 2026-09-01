-- Observation-only GPS evidence accepted by the primary driver ping.
-- This migration does not alter incentive eligibility, payouts, fares, or
-- qualification views. The first accepted fresh GPS fix in each driver minute
-- is immutable; copied coordinates and gps_pending rows are never recorded.

create table public.driver_location_observation_minutes_v1 (
  driver_id uuid not null
    references public.drivers(id) on delete restrict,
  observed_minute_at timestamptz not null,
  observed_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  latitude double precision not null,
  longitude double precision not null,
  client_reported_accuracy_meters double precision,
  client_reported_mock_location boolean,
  driver_status text not null,
  auth_mode text not null,
  device_id text,
  client_reported_town text,
  registered_town text,
  server_resolved_town text,
  server_town_resolution_state text not null,
  server_town_resolved_at timestamptz,
  server_town_source text,
  server_town_cache_distance_meters double precision,
  registered_town_comparison text not null,
  trip_context text not null,
  trip_candidate_count integer not null,
  trip_reference text,
  trip_service_type text,
  trip_status text,
  trip_pickup_town text,
  trip_context_observed_at timestamptz,
  ingest_source text not null default 'primary_driver_location_ping_v1',
  created_at timestamptz not null default clock_timestamp(),
  primary key (driver_id, observed_minute_at),
  constraint driver_loc_obs_minute_aligned_chk
    check (observed_minute_at = date_trunc('minute', observed_minute_at)),
  constraint driver_loc_obs_sample_in_minute_chk
    check (
      observed_at >= observed_minute_at
      and observed_at < observed_minute_at + interval '1 minute'
    ),
  constraint driver_loc_obs_clock_skew_chk
    check (
      observed_at >= received_at - interval '15 minutes'
      and observed_at <= received_at + interval '5 minutes'
    ),
  constraint driver_loc_obs_lat_chk
    check (latitude between -90 and 90),
  constraint driver_loc_obs_lng_chk
    check (longitude between -180 and 180),
  constraint driver_loc_obs_not_zero_zero_chk
    check (not (latitude = 0 and longitude = 0)),
  constraint driver_loc_obs_accuracy_chk
    check (
      client_reported_accuracy_meters is null
      or client_reported_accuracy_meters between 0 and 1000000
    ),
  constraint driver_loc_obs_status_chk
    check (driver_status in ('online', 'available', 'idle', 'waiting')),
  constraint driver_loc_obs_auth_mode_chk
    check (auth_mode in ('bearer', 'driver_secret')),
  constraint driver_loc_obs_resolution_state_chk
    check (
      server_town_resolution_state in (
        'mapbox_cache_aligned',
        'cache_missing',
        'cache_town_missing',
        'cache_source_untrusted',
        'cache_coordinate_mismatch'
      )
    ),
  constraint driver_loc_obs_registered_comparison_chk
    check (
      registered_town_comparison in (
        'same_registered_town',
        'different_registered_town',
        'not_evaluable'
      )
    ),
  constraint driver_loc_obs_trip_context_chk
    check (
      trip_context in (
        'none',
        'pre_pickup',
        'post_pickup',
        'ambiguous',
        'not_evaluable'
      )
    ),
  constraint driver_loc_obs_trip_candidate_count_chk
    check (trip_candidate_count >= 0),
  constraint driver_loc_obs_trip_shape_chk
    check (
      (
        trip_context in ('none', 'not_evaluable')
        and trip_candidate_count = 0
        and trip_reference is null
      )
      or (
        trip_context in ('pre_pickup', 'post_pickup')
        and trip_candidate_count = 1
        and trip_reference is not null
      )
      or (
        trip_context = 'ambiguous'
        and trip_candidate_count >= 2
        and trip_reference is null
      )
    ),
  constraint driver_loc_obs_ingest_source_chk
    check (ingest_source = 'primary_driver_location_ping_v1'),
  constraint driver_loc_obs_device_len_chk
    check (device_id is null or char_length(device_id) <= 256),
  constraint driver_loc_obs_text_len_chk
    check (
      char_length(coalesce(client_reported_town, '')) <= 256
      and char_length(coalesce(registered_town, '')) <= 256
      and char_length(coalesce(server_resolved_town, '')) <= 256
      and char_length(coalesce(server_town_source, '')) <= 64
      and char_length(coalesce(trip_reference, '')) <= 256
      and char_length(coalesce(trip_service_type, '')) <= 64
      and char_length(coalesce(trip_status, '')) <= 512
      and char_length(coalesce(trip_pickup_town, '')) <= 256
    )
);

create index driver_loc_obs_minute_time_driver_idx
  on public.driver_location_observation_minutes_v1
  (observed_minute_at, driver_id);

alter table public.driver_location_observation_minutes_v1
  enable row level security;

revoke all
  on public.driver_location_observation_minutes_v1
  from public, anon, authenticated, service_role;

grant select, insert
  on public.driver_location_observation_minutes_v1
  to service_role;

comment on table public.driver_location_observation_minutes_v1 is
  'Observation-only first fresh GPS fix per online driver minute. It is not an incentive eligibility or abuse verdict.';

create or replace function public.jride_record_driver_location_observation_minute_v1(
  p_driver_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_driver_status text,
  p_auth_mode text,
  p_trip_context text,
  p_trip_candidate_count integer,
  p_observed_at timestamptz default null,
  p_accuracy_meters double precision default null,
  p_client_mock_location boolean default null,
  p_device_id text default null,
  p_client_reported_town text default null,
  p_trip_reference text default null,
  p_trip_service_type text default null,
  p_trip_status text default null,
  p_trip_pickup_town text default null,
  p_trip_context_observed_at timestamptz default null
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_received_at timestamptz := clock_timestamp();
  v_observed_at timestamptz := coalesce(p_observed_at, clock_timestamp());
  v_observed_minute_at timestamptz;
  v_driver_status text := lower(trim(coalesce(p_driver_status, '')));
  v_auth_mode text := lower(trim(coalesce(p_auth_mode, '')));
  v_trip_context text := lower(trim(coalesce(p_trip_context, '')));
  v_registered_town text;
  v_cache_town text;
  v_cache_source text;
  v_cache_lat double precision;
  v_cache_lng double precision;
  v_cache_resolved_at timestamptz;
  v_cache_distance_meters double precision;
  v_haversine_a double precision;
  v_resolution_state text;
  v_registered_comparison text := 'not_evaluable';
  v_inserted_count integer := 0;
begin
  if p_driver_id is null then
    raise exception 'p_driver_id is required' using errcode = '22004';
  end if;

  if p_latitude is null or not (p_latitude between -90 and 90) then
    raise exception 'p_latitude must be between -90 and 90' using errcode = '22023';
  end if;

  if p_longitude is null or not (p_longitude between -180 and 180) then
    raise exception 'p_longitude must be between -180 and 180' using errcode = '22023';
  end if;

  if p_latitude = 0 and p_longitude = 0 then
    raise exception '0/0 is not a usable GPS fix' using errcode = '22023';
  end if;

  if p_accuracy_meters is not null
     and not (p_accuracy_meters between 0 and 1000000) then
    raise exception 'p_accuracy_meters is outside the accepted range' using errcode = '22023';
  end if;

  if v_driver_status not in ('online', 'available', 'idle', 'waiting') then
    raise exception 'p_driver_status is not an online-like state' using errcode = '22023';
  end if;

  if v_auth_mode not in ('bearer', 'driver_secret') then
    raise exception 'p_auth_mode is invalid' using errcode = '22023';
  end if;

  if v_trip_context not in (
    'none',
    'pre_pickup',
    'post_pickup',
    'ambiguous',
    'not_evaluable'
  ) then
    raise exception 'p_trip_context is invalid' using errcode = '22023';
  end if;

  if coalesce(p_trip_candidate_count, -1) < 0 then
    raise exception 'p_trip_candidate_count is invalid' using errcode = '22023';
  end if;

  if (
    v_trip_context in ('none', 'not_evaluable')
    and (
      p_trip_candidate_count <> 0
      or nullif(trim(coalesce(p_trip_reference, '')), '') is not null
    )
  ) or (
    v_trip_context in ('pre_pickup', 'post_pickup')
    and (
      p_trip_candidate_count <> 1
      or nullif(trim(coalesce(p_trip_reference, '')), '') is null
    )
  ) or (
    v_trip_context = 'ambiguous'
    and (
      p_trip_candidate_count < 2
      or nullif(trim(coalesce(p_trip_reference, '')), '') is not null
    )
  ) then
    raise exception 'trip context shape is invalid' using errcode = '22023';
  end if;

  v_observed_minute_at := date_trunc('minute', v_observed_at);

  select nullif(trim(dp.municipality), '')
    into v_registered_town
    from public.driver_profiles dp
   where dp.driver_id = p_driver_id
   limit 1;

  select
    nullif(trim(g.current_town), ''),
    nullif(trim(g.source), ''),
    g.source_lat,
    g.source_lng,
    g.resolved_at
    into
      v_cache_town,
      v_cache_source,
      v_cache_lat,
      v_cache_lng,
      v_cache_resolved_at
    from public.driver_gps_town_resolutions g
   where g.driver_id = p_driver_id
   limit 1;

  if not found then
    v_resolution_state := 'cache_missing';
  elsif v_cache_town is null then
    v_resolution_state := 'cache_town_missing';
  elsif v_cache_source not in ('mapbox_place', 'mapbox_context') then
    v_resolution_state := 'cache_source_untrusted';
  else
    v_haversine_a :=
      power(sin(radians(p_latitude - v_cache_lat) / 2), 2)
      + cos(radians(v_cache_lat))
        * cos(radians(p_latitude))
        * power(sin(radians(p_longitude - v_cache_lng) / 2), 2);

    v_cache_distance_meters :=
      6371000
      * 2
      * asin(sqrt(least(1::double precision, greatest(0::double precision, v_haversine_a))));

    if v_cache_distance_meters > 800 then
      v_resolution_state := 'cache_coordinate_mismatch';
    else
      v_resolution_state := 'mapbox_cache_aligned';
    end if;
  end if;

  if v_resolution_state = 'mapbox_cache_aligned'
     and v_registered_town is not null
     and v_cache_town is not null then
    v_registered_comparison := case
      when lower(v_registered_town) = lower(v_cache_town)
        then 'same_registered_town'
      else 'different_registered_town'
    end;
  end if;

  insert into public.driver_location_observation_minutes_v1 (
    driver_id,
    observed_minute_at,
    observed_at,
    received_at,
    latitude,
    longitude,
    client_reported_accuracy_meters,
    client_reported_mock_location,
    driver_status,
    auth_mode,
    device_id,
    client_reported_town,
    registered_town,
    server_resolved_town,
    server_town_resolution_state,
    server_town_resolved_at,
    server_town_source,
    server_town_cache_distance_meters,
    registered_town_comparison,
    trip_context,
    trip_candidate_count,
    trip_reference,
    trip_service_type,
    trip_status,
    trip_pickup_town,
    trip_context_observed_at,
    ingest_source,
    created_at
  )
  values (
    p_driver_id,
    v_observed_minute_at,
    v_observed_at,
    v_received_at,
    p_latitude,
    p_longitude,
    p_accuracy_meters,
    p_client_mock_location,
    v_driver_status,
    v_auth_mode,
    left(nullif(trim(coalesce(p_device_id, '')), ''), 256),
    left(nullif(trim(coalesce(p_client_reported_town, '')), ''), 256),
    left(v_registered_town, 256),
    left(v_cache_town, 256),
    v_resolution_state,
    v_cache_resolved_at,
    left(v_cache_source, 64),
    v_cache_distance_meters,
    v_registered_comparison,
    v_trip_context,
    p_trip_candidate_count,
    left(nullif(trim(coalesce(p_trip_reference, '')), ''), 256),
    left(nullif(trim(coalesce(p_trip_service_type, '')), ''), 64),
    left(nullif(trim(coalesce(p_trip_status, '')), ''), 512),
    left(nullif(trim(coalesce(p_trip_pickup_town, '')), ''), 256),
    p_trip_context_observed_at,
    'primary_driver_location_ping_v1',
    v_received_at
  )
  on conflict (driver_id, observed_minute_at) do nothing;

  get diagnostics v_inserted_count = row_count;
  return v_inserted_count = 1;
end;
$function$;

revoke all
  on function public.jride_record_driver_location_observation_minute_v1(
    uuid,
    double precision,
    double precision,
    text,
    text,
    text,
    integer,
    timestamptz,
    double precision,
    boolean,
    text,
    text,
    text,
    text,
    text,
    text,
    timestamptz
  )
  from public, anon, authenticated, service_role;

grant execute
  on function public.jride_record_driver_location_observation_minute_v1(
    uuid,
    double precision,
    double precision,
    text,
    text,
    text,
    integer,
    timestamptz,
    double precision,
    boolean,
    text,
    text,
    text,
    text,
    text,
    text,
    timestamptz
  )
  to service_role;

comment on function public.jride_record_driver_location_observation_minute_v1(
  uuid,
  double precision,
  double precision,
  text,
  text,
  text,
  integer,
  timestamptz,
  double precision,
  boolean,
  text,
  text,
  text,
  text,
  text,
  text,
  timestamptz
) is
  'Records the first accepted fresh GPS fix in a driver minute. Auth mode distinguishes bearer identity from shared-secret evidence.';

create or replace view public.driver_location_observation_current_period_v1
with (security_invoker = true)
as
with active_period as (
  select
    p.id as period_id,
    p.name as period_name,
    p.start_at as period_start_at,
    p.end_at as period_end_at
  from public.driver_incentive_periods p
  where p.is_active
  order by p.start_at desc, p.id::text desc
  limit 1
),
observation_window as (
  select
    p.period_id,
    p.period_name,
    p.period_start_at,
    p.period_end_at,
    (
      select min(o.observed_minute_at)
      from public.driver_location_observation_minutes_v1 o
      where o.observed_minute_at >= p.period_start_at
        and o.observed_minute_at < least(
          coalesce(p.period_end_at, 'infinity'::timestamptz),
          now()
        )
    ) as observation_window_start_at,
    least(
      coalesce(p.period_end_at, 'infinity'::timestamptz),
      now()
    ) as observation_window_end_at
  from active_period p
),
presence_minutes as (
  select m.driver_id, m.minute_started_at
  from public.driver_presence_minutes m
  cross join observation_window w
  where w.observation_window_start_at is not null
    and m.minute_started_at >= w.observation_window_start_at
    and m.minute_started_at < w.observation_window_end_at
),
observation_minutes as (
  select o.*
  from public.driver_location_observation_minutes_v1 o
  cross join observation_window w
  where w.observation_window_start_at is not null
    and o.observed_minute_at >= w.observation_window_start_at
    and o.observed_minute_at < w.observation_window_end_at
),
driver_ids as (
  select p.driver_id from presence_minutes p
  union
  select o.driver_id from observation_minutes o
),
presence_aggregate as (
  select p.driver_id, count(*)::bigint as online_minute_count
  from presence_minutes p
  group by p.driver_id
),
observation_aggregate as (
  select
    o.driver_id,
    count(*)::bigint as location_observed_minute_count,
    count(*) filter (where o.auth_mode = 'bearer')::bigint
      as bearer_observed_minute_count,
    count(*) filter (where o.auth_mode = 'driver_secret')::bigint
      as driver_secret_observed_minute_count,
    count(*) filter (
      where o.client_reported_accuracy_meters is not null
    )::bigint as accuracy_reported_minute_count,
    count(*) filter (
      where o.client_reported_mock_location is true
    )::bigint as client_mock_true_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'same_registered_town'
    )::bigint as same_registered_town_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
    )::bigint as different_registered_town_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'not_evaluable'
    )::bigint as town_not_evaluable_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
        and o.trip_context = 'none'
    )::bigint as different_town_no_trip_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
        and o.trip_context = 'pre_pickup'
    )::bigint as different_town_pre_pickup_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
        and o.trip_context = 'post_pickup'
    )::bigint as different_town_post_pickup_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
        and o.trip_context = 'ambiguous'
    )::bigint as different_town_ambiguous_minute_count,
    count(*) filter (
      where o.registered_town_comparison = 'different_registered_town'
        and o.trip_context = 'not_evaluable'
    )::bigint as different_town_context_not_evaluable_minute_count,
    min(o.observed_at) as first_observed_at,
    max(o.observed_at) as last_observed_at
  from observation_minutes o
  group by o.driver_id
),
online_observation_overlap as (
  select p.driver_id, count(*)::bigint as online_with_fresh_gps_minute_count
  from presence_minutes p
  join observation_minutes o
    on o.driver_id = p.driver_id
   and o.observed_minute_at = p.minute_started_at
  group by p.driver_id
),
town_minute_counts as (
  select
    o.driver_id,
    case
      when o.server_town_resolution_state = 'mapbox_cache_aligned'
        then coalesce(o.server_resolved_town, 'Unresolved')
      else 'Unresolved'
    end as observed_town,
    count(*)::bigint as minute_count
  from observation_minutes o
  group by
    o.driver_id,
    case
      when o.server_town_resolution_state = 'mapbox_cache_aligned'
        then coalesce(o.server_resolved_town, 'Unresolved')
      else 'Unresolved'
    end
),
town_aggregate as (
  select
    t.driver_id,
    jsonb_agg(
      jsonb_build_object(
        'town', t.observed_town,
        'minute_count', t.minute_count
      )
      order by lower(t.observed_town)
    ) as observed_town_minutes
  from town_minute_counts t
  group by t.driver_id
)
select
  w.period_id,
  w.period_name,
  w.period_start_at,
  w.period_end_at,
  w.observation_window_start_at,
  w.observation_window_end_at,
  ids.driver_id,
  coalesce(d.driver_name, dp.full_name, 'Unknown Driver') as driver_name,
  nullif(trim(dp.municipality), '') as current_registered_town,
  coalesce(pa.online_minute_count, 0::bigint) as online_minute_count,
  coalesce(oa.location_observed_minute_count, 0::bigint)
    as location_observed_minute_count,
  coalesce(ov.online_with_fresh_gps_minute_count, 0::bigint)
    as online_with_fresh_gps_minute_count,
  greatest(
    coalesce(pa.online_minute_count, 0::bigint)
      - coalesce(ov.online_with_fresh_gps_minute_count, 0::bigint),
    0::bigint
  ) as online_without_fresh_gps_minute_count,
  case
    when coalesce(pa.online_minute_count, 0::bigint) = 0 then null
    else round(
      100.0
      * coalesce(ov.online_with_fresh_gps_minute_count, 0::bigint)::numeric
      / pa.online_minute_count::numeric,
      2
    )
  end as location_coverage_pct,
  coalesce(oa.bearer_observed_minute_count, 0::bigint)
    as bearer_observed_minute_count,
  coalesce(oa.driver_secret_observed_minute_count, 0::bigint)
    as driver_secret_observed_minute_count,
  coalesce(oa.accuracy_reported_minute_count, 0::bigint)
    as accuracy_reported_minute_count,
  coalesce(oa.client_mock_true_minute_count, 0::bigint)
    as client_mock_true_minute_count,
  coalesce(oa.same_registered_town_minute_count, 0::bigint)
    as same_registered_town_minute_count,
  coalesce(oa.different_registered_town_minute_count, 0::bigint)
    as different_registered_town_minute_count,
  coalesce(oa.town_not_evaluable_minute_count, 0::bigint)
    as town_not_evaluable_minute_count,
  coalesce(oa.different_town_no_trip_minute_count, 0::bigint)
    as different_town_no_trip_minute_count,
  coalesce(oa.different_town_pre_pickup_minute_count, 0::bigint)
    as different_town_pre_pickup_minute_count,
  coalesce(oa.different_town_post_pickup_minute_count, 0::bigint)
    as different_town_post_pickup_minute_count,
  coalesce(oa.different_town_ambiguous_minute_count, 0::bigint)
    as different_town_ambiguous_minute_count,
  coalesce(oa.different_town_context_not_evaluable_minute_count, 0::bigint)
    as different_town_context_not_evaluable_minute_count,
  oa.first_observed_at,
  oa.last_observed_at,
  coalesce(ta.observed_town_minutes, '[]'::jsonb)
    as observed_town_minutes
from driver_ids ids
cross join observation_window w
left join public.drivers d
  on d.id = ids.driver_id
left join public.driver_profiles dp
  on dp.driver_id = ids.driver_id
left join presence_aggregate pa
  on pa.driver_id = ids.driver_id
left join observation_aggregate oa
  on oa.driver_id = ids.driver_id
left join online_observation_overlap ov
  on ov.driver_id = ids.driver_id
left join town_aggregate ta
  on ta.driver_id = ids.driver_id;

revoke all
  on public.driver_location_observation_current_period_v1
  from public, anon, authenticated, service_role;

grant select
  on public.driver_location_observation_current_period_v1
  to service_role;

comment on view public.driver_location_observation_current_period_v1 is
  'Current incentive-period raw location observations only. No score, rank, qualification result, or incentive enforcement.';
