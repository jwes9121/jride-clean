-- JRide Duty Check lifecycle v2 incentive timer views
-- Date: 2026-08-11
-- Execution-safe revision: single PostgreSQL statement
--
-- Scope:
--   * Make lifecycle-v2 timer_frozen_at -> timer_resumed_at the only Duty
--     Check interval that removes incentive-eligible online time.
--   * Treat all lifecycle-v1 Duty Checks as observation-only for incentives.
--   * Prevent logout/login or a later unrelated acknowledgement from ending a
--     frozen interval.
--   * Count only presented, lifecycle-v2, unwaived expired checks as misses.
--   * Preserve raw presence and dispatch metrics.
--   * Do not activate lifecycle-v2 creation in the admin route yet.
--
-- This file is intentionally one DO statement. It uses transaction-local
-- JSONB variables instead of TEMP or persistent scratch relations, so the
-- Supabase SQL Editor cannot lose the invariant snapshot between statements.

do $phase1c$
declare
  v_daily_before jsonb;
  v_daily_after jsonb;
  v_summary_before jsonb;
  v_summary_after jsonb;
begin
  -- Rollout guards.
  if to_regprocedure(
    'public.jride_create_driver_availability_ping_v2(uuid,uuid,text,text,integer,integer)'
  ) is null then
    raise exception 'Duty Check lifecycle-v2 create RPC is missing.';
  end if;

  if to_regprocedure(
    'public.jride_present_driver_availability_ping(uuid,uuid,text)'
  ) is null then
    raise exception 'Duty Check lifecycle-v2 present RPC is missing.';
  end if;

  if to_regprocedure(
    'public.jride_respond_driver_availability_ping(uuid,uuid,text)'
  ) is null then
    raise exception 'Duty Check response RPC is missing.';
  end if;

  if to_regclass('public.driver_daily_qualification_v1') is null then
    raise exception 'driver_daily_qualification_v1 is missing.';
  end if;

  if to_regclass('public.driver_incentive_summary_v1') is null then
    raise exception 'driver_incentive_summary_v1 is missing.';
  end if;

  if exists (
    select 1
    from public.driver_availability_pings
    where lifecycle_version = 2
  ) then
    raise exception 'Lifecycle-v2 rows already exist. Stop and review before replacing incentive views.';
  end if;

  -- Remove any persistent scratch relations left by the two abandoned
  -- multi-statement migration attempts. No later statement depends on them.
  execute 'drop table if exists public._jride_daily_before_20260811';
  execute 'drop table if exists public._jride_summary_before_20260811';

  -- Snapshot only the raw facts that this migration is forbidden to change.
  -- now() is transaction-stable for this entire DO statement.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'driver_id', q.driver_id,
        'manila_date', q.manila_date,
        'raw_online_seconds', q.raw_online_seconds,
        'progressed_booking_count', q.progressed_booking_count,
        'qualifying_trip_count', q.qualifying_trip_count
      )
      order by q.driver_id, q.manila_date
    ),
    '[]'::jsonb
  )
  into v_daily_before
  from public.driver_daily_qualification_v1 q;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'driver_id', q.driver_id,
        'session_count', q.session_count,
        'online_seconds', q.online_seconds,
        'raw_online_seconds', q.raw_online_seconds,
        'unique_assigned_bookings', q.unique_assigned_bookings,
        'raw_assignment_events', q.raw_assignment_events,
        'repeated_assignment_pairs', q.repeated_assignment_pairs,
        'progressed_assignments', q.progressed_assignments,
        'completed_assignments', q.completed_assignments
      )
      order by q.driver_id
    ),
    '[]'::jsonb
  )
  into v_summary_before
  from public.driver_incentive_summary_v1 q;

  execute $view_1$
create or replace view public.driver_duty_check_v2_exclusion_intervals_v1 as
select
  p.id as ping_id,
  p.driver_id,
  p.timer_frozen_at as ineligible_start,
  coalesce(p.timer_resumed_at, now()) as ineligible_end,
  p.timer_resumed_at is null as is_unresolved,
  p.response_result,
  p.resolution_kind,
  exists (
    select 1
    from public.driver_availability_ping_events w
    where w.ping_id = p.id
      and w.event_type = 'violation_waived'
  ) as is_waived
from public.driver_availability_pings p
where p.lifecycle_version = 2
  and p.status = 'expired'
  and p.presented_at is not null
  and p.timer_frozen_at is not null
  and coalesce(p.timer_resumed_at, now()) > p.timer_frozen_at;
$view_1$;

  execute 'comment on view public.driver_duty_check_v2_exclusion_intervals_v1 is ''Canonical lifecycle-v2 incentive exclusion intervals. Start is timer_frozen_at; end is timer_resumed_at or now while unresolved.''';

  execute $view_2$
create or replace view public.driver_duty_check_v2_misses_v1 as
select
  p.id as ping_id,
  p.driver_id,
  p.timer_frozen_at as missed_at,
  p.late_acknowledged_at,
  p.timer_resumed_at,
  p.response_result,
  p.resolution_kind,
  not exists (
    select 1
    from public.driver_availability_ping_events w
    where w.ping_id = p.id
      and w.event_type = 'violation_waived'
  ) as counts_for_ladder
from public.driver_availability_pings p
where p.lifecycle_version = 2
  and p.status = 'expired'
  and p.presented_at is not null
  and p.timer_frozen_at is not null;
$view_2$;

  execute 'comment on view public.driver_duty_check_v2_misses_v1 is ''Presented lifecycle-v2 expired checks. Late acknowledgement remains a miss; violation waiver removes it from the ladder.''';

  execute $view_3$
create or replace view public.driver_daily_qualification_v1 as
with period as (
  select
    dip.id as period_id,
    dip.name as period_name,
    dip.start_at as period_start,
    dip.end_at as period_end
  from public.driver_incentive_periods dip
  where dip.is_active
  limit 1
),
presence_sessions_effective as (
  select
    s.id,
    s.driver_id,
    s.driver_name,
    s.town,
    s.status,
    s.login_at,
    s.logout_at,
    s.last_seen_at,
    s.source,
    s.device_id,
    s.created_at,
    s.updated_at,
    s.close_reason,
    case
      when s.logout_at is not null then s.logout_at
      when d.driver_status = 'offline' then coalesce(s.last_seen_at, s.login_at)
      else now()
    end as effective_end
  from public.driver_presence_sessions s
  left join public.drivers d
    on d.id = s.driver_id
),
presence_intervals as (
  select
    s.driver_id,
    greatest(s.login_at, p.period_start) as interval_start,
    least(
      s.effective_end,
      coalesce(p.period_end, 'infinity'::timestamptz)
    ) as interval_end
  from presence_sessions_effective s
  cross join period p
  where s.effective_end > p.period_start
    and s.login_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
presence_ordered as (
  select
    pi.driver_id,
    pi.interval_start,
    pi.interval_end,
    max(pi.interval_end) over (
      partition by pi.driver_id
      order by pi.interval_start
      rows between unbounded preceding and 1 preceding
    ) as previous_max_end
  from presence_intervals pi
),
presence_flagged as (
  select
    po.driver_id,
    po.interval_start,
    po.interval_end,
    case
      when po.previous_max_end is null
        or po.interval_start > po.previous_max_end
      then 1
      else 0
    end as new_island
  from presence_ordered po
),
presence_islands as (
  select
    pf.driver_id,
    pf.interval_start,
    pf.interval_end,
    sum(pf.new_island) over (
      partition by pf.driver_id
      order by pf.interval_start
    ) as island_id
  from presence_flagged pf
),
presence_merged as (
  select
    pi.driver_id,
    pi.island_id,
    min(pi.interval_start) as interval_start,
    max(pi.interval_end) as interval_end
  from presence_islands pi
  group by pi.driver_id, pi.island_id
),
presence_daily_segments as (
  select
    pm.driver_id,
    gs.gs::date as manila_date,
    greatest(
      pm.interval_start,
      (gs.gs::date::timestamp without time zone at time zone 'Asia/Manila')
    ) as segment_start,
    least(
      pm.interval_end,
      ((gs.gs::date + 1)::timestamp without time zone at time zone 'Asia/Manila')
    ) as segment_end
  from presence_merged pm
  cross join lateral generate_series(
    (pm.interval_start at time zone 'Asia/Manila')::date::timestamptz,
    ((pm.interval_end - interval '1 microsecond') at time zone 'Asia/Manila')::date::timestamptz,
    interval '1 day'
  ) gs(gs)
  where pm.interval_end > pm.interval_start
),
exclusion_intervals_raw as (
  select
    e.driver_id,
    greatest(e.ineligible_start, p.period_start) as ineligible_start,
    least(
      e.ineligible_end,
      coalesce(p.period_end, 'infinity'::timestamptz)
    ) as ineligible_end
  from public.driver_duty_check_v2_exclusion_intervals_v1 e
  cross join period p
  where e.ineligible_end > p.period_start
    and e.ineligible_start < coalesce(p.period_end, 'infinity'::timestamptz)
),
exclusion_intervals_ordered as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    max(e.ineligible_end) over (
      partition by e.driver_id
      order by e.ineligible_start
      rows between unbounded preceding and 1 preceding
    ) as previous_max_end
  from exclusion_intervals_raw e
  where e.ineligible_end > e.ineligible_start
),
exclusion_intervals_flagged as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    case
      when e.previous_max_end is null
        or e.ineligible_start > e.previous_max_end
      then 1
      else 0
    end as new_island
  from exclusion_intervals_ordered e
),
exclusion_intervals_islands as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    sum(e.new_island) over (
      partition by e.driver_id
      order by e.ineligible_start
    ) as island_id
  from exclusion_intervals_flagged e
),
eligibility_windows as (
  select
    e.driver_id,
    e.island_id,
    min(e.ineligible_start) as ineligible_start,
    max(e.ineligible_end) as ineligible_end
  from exclusion_intervals_islands e
  group by e.driver_id, e.island_id
),
daily_calculation as (
  select
    pds.driver_id,
    pds.manila_date,
    extract(epoch from pds.segment_end - pds.segment_start) as raw_seconds,
    greatest(
      0::numeric,
      extract(epoch from pds.segment_end - pds.segment_start)
      - coalesce(
          (
            select sum(
              extract(
                epoch from
                  least(pds.segment_end, ew.ineligible_end)
                  - greatest(pds.segment_start, ew.ineligible_start)
              )
            )
            from eligibility_windows ew
            where ew.driver_id = pds.driver_id
              and ew.ineligible_start < pds.segment_end
              and ew.ineligible_end > pds.segment_start
          ),
          0::numeric
        )
    ) as eligible_seconds
  from presence_daily_segments pds
),
daily_summary as (
  select
    dc.driver_id,
    dc.manila_date,
    sum(dc.raw_seconds) as raw_online_seconds,
    sum(dc.eligible_seconds) as eligible_online_seconds
  from daily_calculation dc
  group by dc.driver_id, dc.manila_date
),
dispatch_progression_by_day as (
  select
    da.driver_id,
    (da.created_at at time zone 'Asia/Manila')::date as manila_date,
    count(distinct da.trip_id) as progressed_booking_count,
    array_agg(distinct da.trip_id order by da.trip_id) as qualifying_trip_ids
  from public.dispatch_actions da
  cross join period p
  where da.action_type = 'status_change'
    and da.driver_id is not null
    and (da.meta ->> 'to') = any (
      array[
        'accepted'::text,
        'fare_proposed'::text,
        'ready'::text,
        'on_the_way'::text,
        'arrived'::text,
        'on_trip'::text,
        'completed'::text
      ]
    )
    and da.created_at >= p.period_start
    and da.created_at < coalesce(p.period_end, 'infinity'::timestamptz)
  group by
    da.driver_id,
    (da.created_at at time zone 'Asia/Manila')::date
),
duty_check_misses as (
  select
    m.driver_id,
    m.missed_at
  from public.driver_duty_check_v2_misses_v1 m
  cross join period p
  where m.counts_for_ladder
    and m.missed_at >= p.period_start
    and m.missed_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
daily_unwaived_missed_checks as (
  select
    m.driver_id,
    (m.missed_at at time zone 'Asia/Manila')::date as manila_date,
    count(*) as unwaived_missed_ping_count
  from duty_check_misses m
  group by
    m.driver_id,
    (m.missed_at at time zone 'Asia/Manila')::date
)
select
  ds.driver_id,
  coalesce(d.driver_name, 'Unknown Driver') as driver_name,
  ds.manila_date,
  ds.raw_online_seconds,
  round(ds.raw_online_seconds / 3600.0, 2) as raw_online_hours,
  ds.eligible_online_seconds,
  round(ds.eligible_online_seconds / 3600.0, 2) as eligible_online_hours,
  ds.raw_online_seconds - ds.eligible_online_seconds as excluded_seconds,
  round(
    (ds.raw_online_seconds - ds.eligible_online_seconds) / 3600.0,
    2
  ) as excluded_hours,
  coalesce(dp.progressed_booking_count, 0::bigint) as progressed_booking_count,
  coalesce(dp.qualifying_trip_ids, array[]::uuid[]) as qualifying_trip_ids,
  coalesce(array_length(dp.qualifying_trip_ids, 1), 0) as qualifying_trip_count,
  coalesce(duw.unwaived_missed_ping_count, 0::bigint) as unwaived_missed_ping_count,
  ds.manila_date = (now() at time zone 'Asia/Manila')::date as is_today
from daily_summary ds
left join public.drivers d
  on d.id = ds.driver_id
left join dispatch_progression_by_day dp
  on dp.driver_id = ds.driver_id
 and dp.manila_date = ds.manila_date
left join daily_unwaived_missed_checks duw
  on duw.driver_id = ds.driver_id
 and duw.manila_date = ds.manila_date;
$view_3$;

  execute $view_4$
create or replace view public.driver_incentive_summary_v1 as
with period as (
  select
    dip.id as period_id,
    dip.name as period_name,
    dip.start_at as period_start,
    dip.end_at as period_end
  from public.driver_incentive_periods dip
  where dip.is_active
  limit 1
),
presence_intervals as (
  select
    s.driver_id,
    greatest(s.login_at, p.period_start) as login_at,
    least(
      coalesce(s.logout_at, now()),
      coalesce(p.period_end, 'infinity'::timestamptz)
    ) as effective_end
  from public.driver_presence_sessions s
  cross join period p
  where coalesce(s.logout_at, now()) > p.period_start
    and s.login_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
presence_ordered as (
  select
    pi.driver_id,
    pi.login_at,
    pi.effective_end,
    max(pi.effective_end) over (
      partition by pi.driver_id
      order by pi.login_at
      rows between unbounded preceding and 1 preceding
    ) as prev_max_end
  from presence_intervals pi
),
presence_flagged as (
  select
    po.driver_id,
    po.login_at,
    po.effective_end,
    case
      when po.prev_max_end is null
        or po.login_at > po.prev_max_end
      then 1
      else 0
    end as new_island
  from presence_ordered po
),
presence_islands as (
  select
    pf.driver_id,
    pf.login_at,
    pf.effective_end,
    sum(pf.new_island) over (
      partition by pf.driver_id
      order by pf.login_at
    ) as island_id
  from presence_flagged pf
),
presence_merged as (
  select
    pi.driver_id,
    pi.island_id,
    min(pi.login_at) as interval_start,
    max(pi.effective_end) as interval_end
  from presence_islands pi
  group by pi.driver_id, pi.island_id
),
presence_summary as (
  select
    pm.driver_id,
    sum(extract(epoch from pm.interval_end - pm.interval_start)) as online_seconds
  from presence_merged pm
  group by pm.driver_id
),
exclusion_intervals_raw as (
  select
    e.driver_id,
    greatest(e.ineligible_start, p.period_start) as ineligible_start,
    least(
      e.ineligible_end,
      coalesce(p.period_end, 'infinity'::timestamptz)
    ) as ineligible_end
  from public.driver_duty_check_v2_exclusion_intervals_v1 e
  cross join period p
  where e.ineligible_end > p.period_start
    and e.ineligible_start < coalesce(p.period_end, 'infinity'::timestamptz)
),
exclusion_intervals_ordered as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    max(e.ineligible_end) over (
      partition by e.driver_id
      order by e.ineligible_start
      rows between unbounded preceding and 1 preceding
    ) as prev_max_end
  from exclusion_intervals_raw e
  where e.ineligible_end > e.ineligible_start
),
exclusion_intervals_flagged as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    case
      when e.prev_max_end is null
        or e.ineligible_start > e.prev_max_end
      then 1
      else 0
    end as new_island
  from exclusion_intervals_ordered e
),
exclusion_intervals_islands as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    sum(e.new_island) over (
      partition by e.driver_id
      order by e.ineligible_start
    ) as island_id
  from exclusion_intervals_flagged e
),
eligibility_windows as (
  select
    e.driver_id,
    min(e.ineligible_start) as ineligible_start,
    max(e.ineligible_end) as ineligible_end
  from exclusion_intervals_islands e
  group by e.driver_id, e.island_id
),
eligible_presence as (
  select
    pm.driver_id,
    greatest(
      0::numeric,
      extract(epoch from pm.interval_end - pm.interval_start)
      - coalesce(
          (
            select sum(
              extract(
                epoch from
                  least(pm.interval_end, ew.ineligible_end)
                  - greatest(pm.interval_start, ew.ineligible_start)
              )
            )
            from eligibility_windows ew
            where ew.driver_id = pm.driver_id
              and ew.ineligible_start < pm.interval_end
              and ew.ineligible_end > pm.interval_start
          ),
          0::numeric
        )
    ) as eligible_seconds
  from presence_merged pm
),
eligible_summary as (
  select
    ep.driver_id,
    sum(ep.eligible_seconds) as eligible_online_seconds
  from eligible_presence ep
  group by ep.driver_id
),
presence_raw as (
  select
    s.driver_id,
    count(*) as session_count,
    max(s.last_seen_at) as last_seen_at
  from public.driver_presence_sessions s
  cross join period p
  where coalesce(s.logout_at, now()) > p.period_start
    and s.login_at < coalesce(p.period_end, 'infinity'::timestamptz)
  group by s.driver_id
),
duty_check_universe as (
  select distinct dp.driver_id
  from public.driver_availability_pings dp
  cross join period p
  where dp.created_at >= p.period_start
    and dp.created_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
duty_check as (
  select
    dp.driver_id,
    count(*) as total_pings,
    count(*) filter (
      where dp.status = 'acknowledged'
        and dp.response_result = 'accepted_on_time'
    ) as responded_pings,
    count(*) filter (
      where dp.status = 'expired'
        and not exists (
          select 1
          from public.driver_availability_ping_events w
          where w.ping_id = dp.id
            and w.event_type = 'violation_waived'
        )
    ) as expired_pings,
    count(*) filter (
      where dp.status = 'cancelled'
    ) as cancelled_pings,
    max(dp.created_at) as latest_ping,
    max(dp.responded_at) as latest_response
  from public.driver_availability_pings dp
  cross join period p
  where dp.lifecycle_version = 2
    and dp.presented_at is not null
    and dp.created_at >= p.period_start
    and dp.created_at < coalesce(p.period_end, 'infinity'::timestamptz)
  group by dp.driver_id
),
period_actions as (
  select
    da.trip_id,
    da.driver_id,
    da.created_at,
    da.meta ->> 'to' as to_status
  from public.dispatch_actions da
  cross join period p
  where da.action_type = 'status_change'
    and da.driver_id is not null
    and da.created_at >= p.period_start
    and da.created_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
first_assignment as (
  select
    pa.trip_id,
    pa.driver_id,
    min(pa.created_at) as first_assigned_at
  from period_actions pa
  where pa.to_status = 'assigned'
  group by pa.trip_id, pa.driver_id
),
assignment_pairs as (
  select
    fa.trip_id,
    fa.driver_id,
    count(*) filter (
      where pa.to_status = 'assigned'
    ) as assignment_event_count,
    bool_or(
      pa.to_status = any (
        array[
          'accepted'::text,
          'fare_proposed'::text,
          'ready'::text,
          'on_the_way'::text,
          'arrived'::text,
          'on_trip'::text,
          'completed'::text
        ]
      )
      and pa.created_at >= fa.first_assigned_at
    ) as progressed_after_assignment,
    bool_or(
      pa.to_status = 'completed'
      and pa.created_at >= fa.first_assigned_at
    ) as reached_completed
  from first_assignment fa
  join period_actions pa
    on pa.trip_id = fa.trip_id
   and pa.driver_id = fa.driver_id
  group by fa.trip_id, fa.driver_id
),
dispatch_summary as (
  select
    ap.driver_id,
    count(*) filter (
      where ap.assignment_event_count > 0
    ) as unique_assigned_bookings,
    sum(ap.assignment_event_count) as raw_assignment_events,
    count(*) filter (
      where ap.assignment_event_count > 1
    ) as repeated_assignment_pairs,
    count(*) filter (
      where ap.progressed_after_assignment
    ) as progressed_assignments,
    count(*) filter (
      where ap.reached_completed
    ) as completed_assignments
  from assignment_pairs ap
  where ap.assignment_event_count > 0
  group by ap.driver_id
),
driver_universe as (
  select pr.driver_id
  from presence_raw pr
  union
  select du.driver_id
  from duty_check_universe du
  union
  select ds.driver_id
  from dispatch_summary ds
)
select
  u.driver_id,
  p.period_id as incentive_period_id,
  p.period_name as incentive_period_name,
  p.period_start as incentive_period_start,
  p.period_end as incentive_period_end,
  coalesce(pr.session_count, 0::bigint) as session_count,
  coalesce(ps.online_seconds, 0::numeric) as online_seconds,
  round(coalesce(ps.online_seconds, 0::numeric) / 3600.0, 2) as online_hours,
  pr.last_seen_at,
  coalesce(dc.total_pings, 0::bigint) as duty_check_total_pings,
  coalesce(dc.responded_pings, 0::bigint) as duty_check_responded_pings,
  coalesce(dc.expired_pings, 0::bigint) as duty_check_expired_pings,
  coalesce(dc.cancelled_pings, 0::bigint) as duty_check_cancelled_pings,
  round(
    100.0 * coalesce(dc.responded_pings, 0::bigint)::numeric
    / nullif(
        coalesce(dc.responded_pings, 0::bigint)
        + coalesce(dc.expired_pings, 0::bigint),
        0
      )::numeric,
    2
  ) as duty_check_response_rate_pct,
  dc.latest_ping as duty_check_latest_ping,
  dc.latest_response as duty_check_latest_response,
  coalesce(ds.unique_assigned_bookings, 0::bigint) as unique_assigned_bookings,
  coalesce(ds.raw_assignment_events, 0::numeric) as raw_assignment_events,
  coalesce(ds.repeated_assignment_pairs, 0::bigint) as repeated_assignment_pairs,
  coalesce(ds.progressed_assignments, 0::bigint) as progressed_assignments,
  coalesce(ds.completed_assignments, 0::bigint) as completed_assignments,
  round(
    100.0 * coalesce(ds.progressed_assignments, 0::bigint)::numeric
    / nullif(coalesce(ds.unique_assigned_bookings, 0::bigint), 0)::numeric,
    2
  ) as assignment_progression_pct,
  round(
    100.0 * coalesce(ds.completed_assignments, 0::bigint)::numeric
    / nullif(coalesce(ds.unique_assigned_bookings, 0::bigint), 0)::numeric,
    2
  ) as completion_pct,
  coalesce(ds.repeated_assignment_pairs, 0::bigint) > 0 as has_repeat_assignments,
  coalesce(ps.online_seconds, 0::numeric) as raw_online_seconds,
  round(coalesce(ps.online_seconds, 0::numeric) / 3600.0, 2) as raw_online_hours,
  coalesce(es.eligible_online_seconds, 0::numeric) as eligible_online_seconds,
  round(
    coalesce(es.eligible_online_seconds, 0::numeric) / 3600.0,
    2
  ) as eligible_online_hours
from driver_universe u
cross join period p
join public.driver_reliability_summary_v1 r
  on r.driver_id = u.driver_id
 and r.is_production_driver = true
left join presence_raw pr
  on pr.driver_id = u.driver_id
left join presence_summary ps
  on ps.driver_id = u.driver_id
left join eligible_summary es
  on es.driver_id = u.driver_id
left join duty_check dc
  on dc.driver_id = u.driver_id
left join dispatch_summary ds
  on ds.driver_id = u.driver_id;
$view_4$;

  -- Recompute the same raw facts from the replaced views.
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'driver_id', q.driver_id,
        'manila_date', q.manila_date,
        'raw_online_seconds', q.raw_online_seconds,
        'progressed_booking_count', q.progressed_booking_count,
        'qualifying_trip_count', q.qualifying_trip_count
      )
      order by q.driver_id, q.manila_date
    ),
    '[]'::jsonb
  )
  into v_daily_after
  from public.driver_daily_qualification_v1 q;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'driver_id', q.driver_id,
        'session_count', q.session_count,
        'online_seconds', q.online_seconds,
        'raw_online_seconds', q.raw_online_seconds,
        'unique_assigned_bookings', q.unique_assigned_bookings,
        'raw_assignment_events', q.raw_assignment_events,
        'repeated_assignment_pairs', q.repeated_assignment_pairs,
        'progressed_assignments', q.progressed_assignments,
        'completed_assignments', q.completed_assignments
      )
      order by q.driver_id
    ),
    '[]'::jsonb
  )
  into v_summary_after
  from public.driver_incentive_summary_v1 q;

  if v_daily_after is distinct from v_daily_before then
    raise exception 'Daily raw presence or dispatch invariant changed.';
  end if;

  if v_summary_after is distinct from v_summary_before then
    raise exception 'Incentive summary raw presence or dispatch invariant changed.';
  end if;
end;
$phase1c$;
