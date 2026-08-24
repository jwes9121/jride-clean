create or replace view public.driver_daily_qualification_v1 as
with period as (
  select dip.id as period_id,
         dip.name as period_name,
         dip.start_at as period_start,
         dip.end_at as period_end
  from public.driver_incentive_periods dip
  where dip.is_active
  limit 1
),
cutover as (
  select timestamptz '2026-08-24 00:00:00+08' as minute_cutover
),
legacy_presence_intervals as (
  select s.driver_id,
         greatest(s.login_at, p.period_start) as interval_start,
         least(
           coalesce(s.logout_at, s.last_seen_at, s.login_at),
           coalesce(p.period_end, 'infinity'::timestamptz),
           c.minute_cutover
         ) as interval_end
  from public.driver_presence_sessions s
  cross join period p
  cross join cutover c
  where coalesce(s.logout_at, s.last_seen_at, s.login_at) > p.period_start
    and s.login_at < least(coalesce(p.period_end, 'infinity'::timestamptz), c.minute_cutover)
),
legacy_ordered as (
  select pi.*,
         max(pi.interval_end) over (
           partition by pi.driver_id
           order by pi.interval_start
           rows between unbounded preceding and 1 preceding
         ) as previous_max_end
  from legacy_presence_intervals pi
  where pi.interval_end > pi.interval_start
),
legacy_flagged as (
  select po.*,
         case when po.previous_max_end is null or po.interval_start > po.previous_max_end then 1 else 0 end as new_island
  from legacy_ordered po
),
legacy_islanded as (
  select pf.*,
         sum(pf.new_island) over (partition by pf.driver_id order by pf.interval_start) as island_id
  from legacy_flagged pf
),
legacy_merged as (
  select driver_id,
         island_id,
         min(interval_start) as interval_start,
         max(interval_end) as interval_end
  from legacy_islanded
  group by driver_id, island_id
),
legacy_daily_segments as (
  select pm.driver_id,
         gs.manila_date::date as manila_date,
         greatest(
           pm.interval_start,
           ((gs.manila_date::date)::timestamp at time zone 'Asia/Manila')
         ) as segment_start,
         least(
           pm.interval_end,
           (((gs.manila_date::date + 1))::timestamp at time zone 'Asia/Manila')
         ) as segment_end
  from legacy_merged pm
  cross join lateral generate_series(
    ((pm.interval_start at time zone 'Asia/Manila')::date)::timestamp,
    (((pm.interval_end - interval '0.000001 second') at time zone 'Asia/Manila')::date)::timestamp,
    interval '1 day'
  ) as gs(manila_date)
  where pm.interval_end > pm.interval_start
),
exclusion_intervals_raw as (
  select e.driver_id,
         greatest(e.ineligible_start, p.period_start) as ineligible_start,
         least(e.ineligible_end, coalesce(p.period_end, 'infinity'::timestamptz)) as ineligible_end
  from public.driver_duty_check_v2_exclusion_intervals_v1 e
  cross join period p
  where e.ineligible_end > p.period_start
    and e.ineligible_start < coalesce(p.period_end, 'infinity'::timestamptz)
),
exclusion_ordered as (
  select e.*,
         max(e.ineligible_end) over (
           partition by e.driver_id
           order by e.ineligible_start
           rows between unbounded preceding and 1 preceding
         ) as previous_max_end
  from exclusion_intervals_raw e
  where e.ineligible_end > e.ineligible_start
),
exclusion_flagged as (
  select e.*,
         case when e.previous_max_end is null or e.ineligible_start > e.previous_max_end then 1 else 0 end as new_island
  from exclusion_ordered e
),
exclusion_islanded as (
  select e.*,
         sum(e.new_island) over (partition by e.driver_id order by e.ineligible_start) as island_id
  from exclusion_flagged e
),
eligibility_windows as (
  select driver_id,
         island_id,
         min(ineligible_start) as ineligible_start,
         max(ineligible_end) as ineligible_end
  from exclusion_islanded
  group by driver_id, island_id
),
legacy_daily_calculation as (
  select pds.driver_id,
         pds.manila_date,
         extract(epoch from (pds.segment_end - pds.segment_start)) as raw_seconds,
         greatest(
           0::numeric,
           extract(epoch from (pds.segment_end - pds.segment_start)) -
           coalesce((
             select sum(extract(epoch from (
               least(pds.segment_end, ew.ineligible_end) - greatest(pds.segment_start, ew.ineligible_start)
             )))
             from eligibility_windows ew
             where ew.driver_id = pds.driver_id
               and ew.ineligible_start < pds.segment_end
               and ew.ineligible_end > pds.segment_start
           ), 0::numeric)
         ) as eligible_seconds
  from legacy_daily_segments pds
),
legacy_daily as (
  select driver_id,
         manila_date,
         sum(raw_seconds) as raw_online_seconds,
         sum(eligible_seconds) as eligible_online_seconds
  from legacy_daily_calculation
  group by driver_id, manila_date
),
minute_rows as (
  select m.driver_id,
         m.minute_started_at,
         (m.minute_started_at at time zone 'Asia/Manila')::date as manila_date
  from public.driver_presence_minutes m
  cross join period p
  cross join cutover c
  where m.minute_started_at >= greatest(p.period_start, c.minute_cutover)
    and m.minute_started_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
minute_calculation as (
  select m.driver_id,
         m.manila_date,
         60::numeric as raw_seconds,
         greatest(
           0::numeric,
           60::numeric - coalesce((
             select sum(extract(epoch from (
               least(m.minute_started_at + interval '1 minute', ew.ineligible_end) -
               greatest(m.minute_started_at, ew.ineligible_start)
             )))
             from eligibility_windows ew
             where ew.driver_id = m.driver_id
               and ew.ineligible_start < m.minute_started_at + interval '1 minute'
               and ew.ineligible_end > m.minute_started_at
           ), 0::numeric)
         ) as eligible_seconds
  from minute_rows m
),
minute_daily as (
  select driver_id,
         manila_date,
         sum(raw_seconds) as raw_online_seconds,
         sum(eligible_seconds) as eligible_online_seconds
  from minute_calculation
  group by driver_id, manila_date
),
daily_summary as (
  select driver_id,
         manila_date,
         sum(raw_online_seconds) as raw_online_seconds,
         sum(eligible_online_seconds) as eligible_online_seconds
  from (
    select * from legacy_daily
    union all
    select * from minute_daily
  ) x
  group by driver_id, manila_date
),
dispatch_progression_by_day as (
  select da.driver_id,
         (da.created_at at time zone 'Asia/Manila')::date as manila_date,
         count(distinct da.trip_id) as progressed_booking_count,
         array_agg(distinct da.trip_id order by da.trip_id) as qualifying_trip_ids
  from public.dispatch_actions da
  cross join period p
  where da.action_type = 'status_change'
    and da.driver_id is not null
    and (da.meta ->> 'to') = any (array['accepted','fare_proposed','ready','on_the_way','arrived','on_trip','completed'])
    and da.created_at >= p.period_start
    and da.created_at < coalesce(p.period_end, 'infinity'::timestamptz)
  group by da.driver_id, (da.created_at at time zone 'Asia/Manila')::date
),
duty_check_misses as (
  select m.driver_id, m.missed_at
  from public.driver_duty_check_v2_misses_v1 m
  cross join period p
  where m.counts_for_ladder
    and m.missed_at >= p.period_start
    and m.missed_at < coalesce(p.period_end, 'infinity'::timestamptz)
),
daily_unwaived_missed_checks as (
  select m.driver_id,
         (m.missed_at at time zone 'Asia/Manila')::date as manila_date,
         count(*) as unwaived_missed_ping_count
  from duty_check_misses m
  group by m.driver_id, (m.missed_at at time zone 'Asia/Manila')::date
)
select ds.driver_id,
       coalesce(d.driver_name, 'Unknown Driver') as driver_name,
       ds.manila_date,
       ds.raw_online_seconds,
       round(ds.raw_online_seconds / 3600.0, 2) as raw_online_hours,
       ds.eligible_online_seconds,
       round(ds.eligible_online_seconds / 3600.0, 2) as eligible_online_hours,
       ds.raw_online_seconds - ds.eligible_online_seconds as excluded_seconds,
       round((ds.raw_online_seconds - ds.eligible_online_seconds) / 3600.0, 2) as excluded_hours,
       coalesce(dp.progressed_booking_count, 0) as progressed_booking_count,
       coalesce(dp.qualifying_trip_ids, array[]::uuid[]) as qualifying_trip_ids,
       coalesce(array_length(dp.qualifying_trip_ids, 1), 0) as qualifying_trip_count,
       coalesce(duw.unwaived_missed_ping_count, 0) as unwaived_missed_ping_count,
       ds.manila_date = (now() at time zone 'Asia/Manila')::date as is_today
from daily_summary ds
left join public.drivers d on d.id = ds.driver_id
left join dispatch_progression_by_day dp on dp.driver_id = ds.driver_id and dp.manila_date = ds.manila_date
left join daily_unwaived_missed_checks duw on duw.driver_id = ds.driver_id and duw.manila_date = ds.manila_date;

create or replace view public.driver_incentive_weekly_midday_gate_v1 as
with cutover as (
  select date '2026-08-24' as minute_start_date
),
historical_days as (
  select gs::date as manila_date
  from generate_series(date '2026-08-17', date '2026-08-23', interval '1 day') gs
),
historical_segments as (
  select s.driver_id,
         d.manila_date,
         greatest(
           s.login_at,
           ((d.manila_date + time '10:00')::timestamp at time zone 'Asia/Manila')
         ) as interval_start,
         least(
           coalesce(s.logout_at, s.last_seen_at, s.login_at),
           ((d.manila_date + time '15:00')::timestamp at time zone 'Asia/Manila')
         ) as interval_end
  from public.driver_presence_sessions s
  cross join historical_days d
  where coalesce(s.logout_at, s.last_seen_at, s.login_at) > ((d.manila_date + time '10:00')::timestamp at time zone 'Asia/Manila')
    and s.login_at < ((d.manila_date + time '15:00')::timestamp at time zone 'Asia/Manila')
),
historical_valid as (
  select * from historical_segments where interval_end > interval_start
),
historical_ordered as (
  select v.*,
         max(v.interval_end) over (
           partition by v.driver_id, v.manila_date
           order by v.interval_start
           rows between unbounded preceding and 1 preceding
         ) as previous_max_end
  from historical_valid v
),
historical_flagged as (
  select o.*,
         case when o.previous_max_end is null or o.interval_start > o.previous_max_end then 1 else 0 end as new_island
  from historical_ordered o
),
historical_islanded as (
  select f.*,
         sum(f.new_island) over (
           partition by f.driver_id, f.manila_date
           order by f.interval_start
         ) as island_id
  from historical_flagged f
),
historical_merged as (
  select driver_id,
         manila_date,
         island_id,
         min(interval_start) as interval_start,
         max(interval_end) as interval_end
  from historical_islanded
  group by driver_id, manila_date, island_id
),
historical_daily as (
  select driver_id,
         manila_date,
         sum(extract(epoch from (interval_end - interval_start))) / 3600.0 as midday_hours
  from historical_merged
  group by driver_id, manila_date
),
historical_weekly as (
  select driver_id,
         date '2026-08-17' as week_start,
         round(sum(midday_hours), 2) as midday_hours,
         count(*) filter (where midday_hours > 0) as contributing_days
  from historical_daily
  group by driver_id
),
minute_midday as (
  select m.driver_id,
         (m.minute_started_at at time zone 'Asia/Manila')::date as manila_date,
         ((m.minute_started_at at time zone 'Asia/Manila')::date -
           (extract(isodow from (m.minute_started_at at time zone 'Asia/Manila')::date)::integer - 1)) as week_start
  from public.driver_presence_minutes m
  cross join cutover c
  where (m.minute_started_at at time zone 'Asia/Manila')::date >= c.minute_start_date
    and (m.minute_started_at at time zone 'Asia/Manila')::time >= time '10:00'
    and (m.minute_started_at at time zone 'Asia/Manila')::time < time '15:00'
),
minute_weekly as (
  select driver_id,
         week_start,
         round(count(*)::numeric / 60.0, 2) as midday_hours,
         count(distinct manila_date) as contributing_days
  from minute_midday
  group by driver_id, week_start
),
weekly as (
  select * from historical_weekly
  union all
  select * from minute_weekly
),
with_requirement as (
  select w.*,
         case when w.week_start >= date '2026-08-24' then 7.0::numeric else 5.0::numeric end as required_midday_hours
  from weekly w
)
select driver_id,
       week_start,
       week_start + 6 as week_end,
       midday_hours,
       contributing_days,
       round(greatest(0::numeric, required_midday_hours - midday_hours), 2) as hours_remaining,
       midday_hours >= required_midday_hours as gate_met,
       required_midday_hours
from with_requirement;

update public.driver_incentive_policies
set allowed_missed_checks = case when policy_code = 'WEEKLY' then 1 else 2 end
where policy_code in ('WEEKLY','PHONE_CLAMP','SHIRT','MONTHLY','THERMAL_BAG','SMARTPHONE');

create or replace view public.driver_incentive_claimability_v1 as
with weekly_awards as (
  select driver_id, policy_code, cycle_number, bool_or(reward_given) as already_awarded
  from public.driver_incentive_awards
  where policy_code = 'WEEKLY'
  group by driver_id, policy_code, cycle_number
),
one_time_awards as (
  select driver_id, policy_code, bool_or(reward_given) as already_awarded
  from public.driver_incentive_awards
  where policy_code = any (array['PHONE_CLAMP','SHIRT','MONTHLY','THERMAL_BAG','SMARTPHONE'])
  group by driver_id, policy_code
),
evaluated as (
  select q.driver_id,
         q.driver_name,
         q.policy_code,
         q.display_name,
         q.cycle_number,
         q.anchor_date,
         q.cycle_start,
         q.cycle_end,
         q.cycle_data_start,
         q.cycle_data_end,
         case when fa.driver_id is not null then fa.fresh_presence_days else q.achieved_presence_days end as achieved_presence_days,
         q.required_presence_days,
         case when fa.driver_id is not null then fa.fresh_total_hours else q.achieved_total_hours end as achieved_total_hours,
         q.required_total_hours,
         q.achieved_booking_count,
         q.required_booking_count,
         q.cycle_missed_checks,
         q.calendar_cumulative_missed_checks,
         q.allowed_missed_checks,
         q.miss_check_scope,
         case when fa.driver_id is not null then fa.fresh_presence_requirement_met else q.presence_requirement_met end as presence_requirement_met,
         case when fa.driver_id is not null then fa.fresh_hours_requirement_met else q.hours_requirement_met end as hours_requirement_met,
         q.booking_requirement_met,
         q.duty_check_requirement_met as ping_requirement_met,
         q.cycle_weeks,
         case
           when q.cycle_end < date '2026-08-17' then true
           else not exists (
             select 1
             from generate_series(
               greatest(q.cycle_start, date '2026-08-17')::timestamp,
               q.cycle_end::timestamp,
               interval '7 days'
             ) gs(week_start)
             left join public.driver_incentive_weekly_midday_gate_v1 g
               on g.driver_id = q.driver_id
              and g.week_start = gs.week_start::date
             where coalesce(g.gate_met, false) = false
           )
         end as midday_gate_requirement_met,
         (now() at time zone 'Asia/Manila')::date > q.cycle_end as cycle_closed
  from public.driver_incentive_cycle_qualification_v1 q
  left join public.driver_incentive_fresh_day_cycle_audit_v1 fa
    on fa.driver_id = q.driver_id
   and fa.policy_code = q.policy_code
   and fa.cycle_number = q.cycle_number
),
finalized as (
  select e.*,
         (e.presence_requirement_met and e.hours_requirement_met and e.booking_requirement_met and e.ping_requirement_met and e.midday_gate_requirement_met) as corrected_qualified
  from evaluated e
)
select q.driver_id,
       q.driver_name,
       q.policy_code,
       q.display_name,
       q.cycle_number,
       q.anchor_date,
       q.cycle_start,
       q.cycle_end,
       q.cycle_data_start,
       q.cycle_data_end,
       q.achieved_presence_days,
       q.required_presence_days,
       q.achieved_total_hours,
       q.required_total_hours,
       q.achieved_booking_count,
       q.required_booking_count,
       q.cycle_missed_checks,
       q.calendar_cumulative_missed_checks,
       q.allowed_missed_checks,
       q.miss_check_scope,
       q.corrected_qualified as qualified,
       q.cycle_weeks,
       q.presence_requirement_met,
       q.hours_requirement_met,
       q.booking_requirement_met,
       (q.ping_requirement_met and q.midday_gate_requirement_met) as duty_check_requirement_met,
       case when q.policy_code = 'WEEKLY' then coalesce(wa.already_awarded,false) else coalesce(oa.already_awarded,false) end as already_awarded,
       (q.corrected_qualified and q.cycle_closed and not case when q.policy_code = 'WEEKLY' then coalesce(wa.already_awarded,false) else coalesce(oa.already_awarded,false) end) as claimable,
       q.ping_requirement_met,
       q.midday_gate_requirement_met
from finalized q
left join weekly_awards wa
  on wa.driver_id = q.driver_id
 and wa.policy_code = q.policy_code
 and wa.cycle_number::numeric = q.cycle_number
left join one_time_awards oa
  on oa.driver_id = q.driver_id
 and oa.policy_code = q.policy_code;

create or replace view public.driver_incentive_midday_cycle_audit_v1 as
select q.driver_id,
       q.driver_name,
       q.policy_code,
       q.display_name,
       q.cycle_number,
       gs.week_start::date as week_start,
       gs.week_start::date + 6 as week_end,
       coalesce(g.midday_hours,0::numeric) as achieved_midday_hours,
       case when gs.week_start::date >= date '2026-08-24' then 7.0::numeric else 5.0::numeric end as required_midday_hours,
       coalesce(g.gate_met,false) as gate_met
from public.driver_incentive_cycle_qualification_v1 q
cross join lateral generate_series(
  greatest(q.cycle_start, date '2026-08-17')::timestamp,
  q.cycle_end::timestamp,
  interval '7 days'
) gs(week_start)
left join public.driver_incentive_weekly_midday_gate_v1 g
  on g.driver_id = q.driver_id
 and g.week_start = gs.week_start::date
where q.cycle_end >= date '2026-08-17';

comment on view public.driver_incentive_weekly_midday_gate_v1 is
  'Weekly 10:00-15:00 Manila duty gate: 5 hours for week starting 2026-08-17, 7 hours per week from 2026-08-24 onward. Uses observed heartbeat minutes from 2026-08-24 onward.';
comment on view public.driver_incentive_midday_cycle_audit_v1 is
  'Per-driver per-policy weekly audit of achieved versus required 10:00-15:00 incentive duty hours.';
