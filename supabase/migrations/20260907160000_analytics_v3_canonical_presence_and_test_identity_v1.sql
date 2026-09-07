create table if not exists public.analytics_test_identities (
  entity_type text not null,
  entity_id uuid not null,
  label text null,
  reason text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint analytics_test_identities_pkey primary key (entity_type, entity_id),
  constraint analytics_test_identities_entity_type_chk check (entity_type in ('driver', 'passenger'))
);

alter table public.analytics_test_identities enable row level security;

comment on table public.analytics_test_identities is
  'Role-scoped test identities excluded from production analytics. Driver IDs and passenger Auth user IDs are intentionally separate namespaces.';

create or replace view public.driver_presence_daily_net_v1
with (security_invoker = true)
as
with cutover as (
  select '2026-08-23 16:00:00+00'::timestamptz as minute_cutover
),
legacy_intervals as (
  select
    s.driver_id,
    s.id as session_id,
    s.login_at as interval_start,
    least(
      coalesce(s.logout_at, s.last_seen_at, s.login_at),
      c.minute_cutover
    ) as interval_end
  from public.driver_presence_sessions s
  cross join cutover c
  where s.login_at < c.minute_cutover
    and coalesce(s.logout_at, s.last_seen_at, s.login_at) > s.login_at
),
legacy_ordered as (
  select
    li.driver_id,
    li.interval_start,
    li.interval_end,
    max(li.interval_end) over (
      partition by li.driver_id
      order by li.interval_start
      rows between unbounded preceding and 1 preceding
    ) as previous_max_end
  from legacy_intervals li
  where li.interval_end > li.interval_start
),
legacy_flagged as (
  select
    lo.driver_id,
    lo.interval_start,
    lo.interval_end,
    case
      when lo.previous_max_end is null or lo.interval_start > lo.previous_max_end then 1
      else 0
    end as new_island
  from legacy_ordered lo
),
legacy_islanded as (
  select
    lf.driver_id,
    lf.interval_start,
    lf.interval_end,
    sum(lf.new_island) over (
      partition by lf.driver_id
      order by lf.interval_start
    ) as island_id
  from legacy_flagged lf
),
legacy_merged as (
  select
    li.driver_id,
    li.island_id,
    min(li.interval_start) as interval_start,
    max(li.interval_end) as interval_end
  from legacy_islanded li
  group by li.driver_id, li.island_id
),
legacy_daily_segments as (
  select
    lm.driver_id,
    gs.manila_date::date as manila_date,
    greatest(
      lm.interval_start,
      (gs.manila_date::date::timestamp without time zone at time zone 'Asia/Manila')
    ) as segment_start,
    least(
      lm.interval_end,
      ((gs.manila_date::date + 1)::timestamp without time zone at time zone 'Asia/Manila')
    ) as segment_end
  from legacy_merged lm
  cross join lateral generate_series(
    (lm.interval_start at time zone 'Asia/Manila')::date::timestamp without time zone,
    ((lm.interval_end - interval '1 microsecond') at time zone 'Asia/Manila')::date::timestamp without time zone,
    interval '1 day'
  ) gs(manila_date)
  where lm.interval_end > lm.interval_start
),
exclusion_raw as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end
  from public.driver_duty_check_v2_exclusion_intervals_v1 e
  where e.ineligible_end > e.ineligible_start
),
exclusion_ordered as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    max(e.ineligible_end) over (
      partition by e.driver_id
      order by e.ineligible_start
      rows between unbounded preceding and 1 preceding
    ) as previous_max_end
  from exclusion_raw e
),
exclusion_flagged as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    case
      when e.previous_max_end is null or e.ineligible_start > e.previous_max_end then 1
      else 0
    end as new_island
  from exclusion_ordered e
),
exclusion_islanded as (
  select
    e.driver_id,
    e.ineligible_start,
    e.ineligible_end,
    sum(e.new_island) over (
      partition by e.driver_id
      order by e.ineligible_start
    ) as island_id
  from exclusion_flagged e
),
eligibility_windows as (
  select
    e.driver_id,
    e.island_id,
    min(e.ineligible_start) as ineligible_start,
    max(e.ineligible_end) as ineligible_end
  from exclusion_islanded e
  group by e.driver_id, e.island_id
),
legacy_calculation as (
  select
    lds.driver_id,
    lds.manila_date,
    extract(epoch from lds.segment_end - lds.segment_start)::numeric as raw_seconds,
    greatest(
      0::numeric,
      extract(epoch from lds.segment_end - lds.segment_start)::numeric
      - coalesce((
          select sum(
            extract(epoch from least(lds.segment_end, ew.ineligible_end) - greatest(lds.segment_start, ew.ineligible_start))
          )
          from eligibility_windows ew
          where ew.driver_id = lds.driver_id
            and ew.ineligible_start < lds.segment_end
            and ew.ineligible_end > lds.segment_start
        ), 0::numeric)
    ) as eligible_seconds,
    lds.segment_start as first_seen_at,
    lds.segment_end as last_seen_at
  from legacy_daily_segments lds
),
legacy_daily as (
  select
    lc.driver_id,
    lc.manila_date,
    sum(lc.raw_seconds) as raw_online_seconds,
    sum(lc.eligible_seconds) as eligible_online_seconds,
    min(lc.first_seen_at) as first_seen_at,
    max(lc.last_seen_at) as last_seen_at
  from legacy_calculation lc
  group by lc.driver_id, lc.manila_date
),
minute_rows as (
  select
    m.driver_id,
    m.minute_started_at,
    m.last_seen_at,
    (m.minute_started_at at time zone 'Asia/Manila')::date as manila_date
  from public.driver_presence_minutes m
  cross join cutover c
  where m.minute_started_at >= c.minute_cutover
),
minute_calculation as (
  select
    m.driver_id,
    m.manila_date,
    60::numeric as raw_seconds,
    greatest(
      0::numeric,
      60::numeric
      - coalesce((
          select sum(
            extract(epoch from least(m.minute_started_at + interval '1 minute', ew.ineligible_end) - greatest(m.minute_started_at, ew.ineligible_start))
          )
          from eligibility_windows ew
          where ew.driver_id = m.driver_id
            and ew.ineligible_start < m.minute_started_at + interval '1 minute'
            and ew.ineligible_end > m.minute_started_at
        ), 0::numeric)
    ) as eligible_seconds,
    m.minute_started_at as first_seen_at,
    greatest(m.minute_started_at, m.last_seen_at) as last_seen_at
  from minute_rows m
),
minute_daily as (
  select
    mc.driver_id,
    mc.manila_date,
    sum(mc.raw_seconds) as raw_online_seconds,
    sum(mc.eligible_seconds) as eligible_online_seconds,
    min(mc.first_seen_at) as first_seen_at,
    max(mc.last_seen_at) as last_seen_at
  from minute_calculation mc
  group by mc.driver_id, mc.manila_date
),
combined as (
  select * from legacy_daily
  union all
  select * from minute_daily
)
select
  c.driver_id,
  c.manila_date,
  sum(c.raw_online_seconds) as raw_online_seconds,
  round(sum(c.raw_online_seconds) / 3600.0, 2) as raw_online_hours,
  sum(c.eligible_online_seconds) as net_online_seconds,
  round(sum(c.eligible_online_seconds) / 3600.0, 2) as net_online_hours,
  sum(c.raw_online_seconds) - sum(c.eligible_online_seconds) as security_excluded_seconds,
  round((sum(c.raw_online_seconds) - sum(c.eligible_online_seconds)) / 3600.0, 2) as security_excluded_hours,
  min(c.first_seen_at) as first_seen_at,
  max(c.last_seen_at) as last_seen_at
from combined c
group by c.driver_id, c.manila_date;

comment on view public.driver_presence_daily_net_v1 is
  'Canonical Analytics V3 daily driver presence. Legacy sessions end at logout/last_seen, post-cutover presence uses observed heartbeat minutes, Manila days are split correctly, and Duty Check frozen intervals are deducted from net time.';

create or replace view public.driver_presence_session_starts_daily_v1
with (security_invoker = true)
as
select
  s.driver_id,
  (s.login_at at time zone 'Asia/Manila')::date as manila_date,
  count(*) as session_count
from public.driver_presence_sessions s
where coalesce(s.logout_at, s.last_seen_at, s.login_at) >= s.login_at
group by s.driver_id, (s.login_at at time zone 'Asia/Manila')::date;

comment on view public.driver_presence_session_starts_daily_v1 is
  'Count of driver presence sessions by Manila login date for Analytics V3 session-count display.';

create or replace view public.analytics_v3_bookings_v1
with (security_invoker = true)
as
select b.*
from public.bookings b
where not exists (
  select 1
  from public.analytics_booking_exclusions e
  where e.booking_id = b.id
    and e.active = true
)
and not exists (
  select 1
  from public.analytics_test_identities t
  where t.active = true
    and t.entity_type = 'driver'
    and (t.entity_id = b.assigned_driver_id or t.entity_id = b.driver_id)
)
and not exists (
  select 1
  from public.analytics_test_identities t
  where t.active = true
    and t.entity_type = 'passenger'
    and t.entity_id = b.created_by_user_id
);

comment on view public.analytics_v3_bookings_v1 is
  'Production Analytics V3 booking source. Excludes manually excluded bookings plus role-scoped dummy driver and passenger identities without mixing the two ID namespaces.';
