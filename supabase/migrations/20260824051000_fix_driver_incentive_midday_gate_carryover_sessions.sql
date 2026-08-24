-- Fix the weekly 10:00-15:00 incentive gate so a session that started
-- before the evaluated day/week still contributes the time that overlaps
-- the 10:00-15:00 Manila window. This preserves existing 5-hour weekly gate
-- semantics while removing false disqualifications from carry-over sessions.

create or replace view public.driver_incentive_weekly_midday_gate_v1 as
with sessions as (
  select
    s.driver_id,
    s.login_at,
    coalesce(s.logout_at, s.last_seen_at, s.login_at) as effective_end
  from public.driver_presence_sessions s
  where s.login_at is not null
    and coalesce(s.logout_at, s.last_seen_at, s.login_at) > s.login_at
), daily_windows as (
  select
    s.driver_id,
    gs.manila_date::date as manila_date,
    greatest(
      s.login_at,
      ((gs.manila_date::date + time '10:00')::timestamp at time zone 'Asia/Manila')
    ) as interval_start,
    least(
      s.effective_end,
      ((gs.manila_date::date + time '15:00')::timestamp at time zone 'Asia/Manila')
    ) as interval_end
  from sessions s
  cross join lateral generate_series(
    greatest((s.login_at at time zone 'Asia/Manila')::date, date '2026-08-17')::timestamp,
    ((s.effective_end - interval '0.000001 second') at time zone 'Asia/Manila')::date::timestamp,
    interval '1 day'
  ) as gs(manila_date)
  where s.effective_end > ((gs.manila_date::date + time '10:00')::timestamp at time zone 'Asia/Manila')
    and s.login_at < ((gs.manila_date::date + time '15:00')::timestamp at time zone 'Asia/Manila')
), valid as (
  select *
  from daily_windows
  where interval_end > interval_start
), ordered as (
  select
    v.*,
    max(v.interval_end) over (
      partition by v.driver_id, v.manila_date
      order by v.interval_start
      rows between unbounded preceding and 1 preceding
    ) as previous_max_end
  from valid v
), flagged as (
  select
    o.*,
    case
      when o.previous_max_end is null or o.interval_start > o.previous_max_end then 1
      else 0
    end as new_island
  from ordered o
), islanded as (
  select
    f.*,
    sum(f.new_island) over (
      partition by f.driver_id, f.manila_date
      order by f.interval_start
    ) as island_id
  from flagged f
), merged as (
  select
    i.driver_id,
    i.manila_date,
    i.island_id,
    min(i.interval_start) as interval_start,
    max(i.interval_end) as interval_end
  from islanded i
  group by i.driver_id, i.manila_date, i.island_id
), daily as (
  select
    m.driver_id,
    m.manila_date,
    round(sum(extract(epoch from (m.interval_end - m.interval_start))) / 3600.0, 2) as midday_hours
  from merged m
  group by m.driver_id, m.manila_date
)
select
  d.driver_id,
  (d.manila_date - (extract(isodow from d.manila_date)::integer - 1)) as week_start,
  (d.manila_date - (extract(isodow from d.manila_date)::integer - 1) + 6) as week_end,
  round(sum(d.midday_hours), 2) as midday_hours,
  count(*) filter (where d.midday_hours > 0) as contributing_days,
  round(greatest(0::numeric, 5.0 - sum(d.midday_hours)), 2) as hours_remaining,
  (sum(d.midday_hours) >= 5.0) as gate_met
from daily d
group by d.driver_id, (d.manila_date - (extract(isodow from d.manila_date)::integer - 1));
