-- JRide driver incentive campaign schedule and major-reward booking thresholds.
-- Explicit campaign windows prevent generic cycle math from offering rewards
-- in the wrong weeks. Test driver IDs are excluded from claimability.
-- Thermal Bag requires 30 completed bookings; Smartphone requires 100.

create table if not exists public.driver_incentive_reward_schedule (
  policy_code text not null references public.driver_incentive_policies(policy_code) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  award_week integer not null check (award_week between 1 and 12),
  window_start_week integer not null check (window_start_week between 1 and 12),
  window_end_week integer not null check (window_end_week between 1 and 12),
  primary key (policy_code, attempt_number),
  unique (policy_code, award_week),
  check (window_start_week <= window_end_week),
  check (award_week = window_end_week)
);

alter table public.driver_incentive_reward_schedule enable row level security;

delete from public.driver_incentive_reward_schedule;

insert into public.driver_incentive_reward_schedule
  (policy_code, attempt_number, award_week, window_start_week, window_end_week)
values
  ('WEEKLY', 1, 1, 1, 1),
  ('WEEKLY', 2, 2, 2, 2),
  ('WEEKLY', 3, 3, 3, 3),
  ('WEEKLY', 4, 4, 4, 4),
  ('WEEKLY', 5, 5, 5, 5),
  ('WEEKLY', 6, 6, 6, 6),
  ('WEEKLY', 7, 7, 7, 7),
  ('WEEKLY', 8, 8, 8, 8),
  ('WEEKLY', 9, 9, 9, 9),
  ('WEEKLY', 10, 10, 10, 10),
  ('WEEKLY', 11, 11, 11, 11),
  ('WEEKLY', 12, 12, 12, 12),
  ('PHONE_CLAMP', 1, 2, 1, 2),
  ('PHONE_CLAMP', 2, 6, 5, 6),
  ('PHONE_CLAMP', 3, 10, 9, 10),
  ('SHIRT', 1, 3, 1, 3),
  ('SHIRT', 2, 7, 5, 7),
  ('SHIRT', 3, 11, 9, 11),
  ('MONTHLY', 1, 4, 1, 4),
  ('MONTHLY', 2, 8, 5, 8),
  ('MONTHLY', 3, 12, 9, 12),
  ('THERMAL_BAG', 1, 8, 1, 8),
  ('SMARTPHONE', 1, 12, 1, 12);

create or replace view public.driver_incentive_cycle_qualification_v1 as
with anchor as (
  select
    (p.start_at at time zone 'Asia/Manila')::date as anchor_date,
    least(
      coalesce((p.end_at at time zone 'Asia/Manila')::date, (p.start_at at time zone 'Asia/Manila')::date + 84),
      (p.start_at at time zone 'Asia/Manila')::date + 84
    ) as campaign_end_date
  from public.driver_incentive_periods p
  where p.is_active
  limit 1
),
driver_days as (
  select q.driver_id, q.manila_date
  from public.driver_daily_qualification_v1 q
  cross join anchor a
  where q.manila_date >= a.anchor_date and q.manila_date < a.campaign_end_date
  union
  select af.driver_id, af.manila_date
  from public.driver_daily_activity_facts_v1 af
  cross join anchor a
  where af.manila_date >= a.anchor_date and af.manila_date < a.campaign_end_date
),
daily_with_week as (
  select
    dd.driver_id,
    coalesce(q.driver_name, d.driver_name, 'Unknown Driver') as driver_name,
    dd.manila_date,
    coalesce(q.eligible_online_seconds, 0::numeric) as eligible_online_seconds,
    coalesce(q.unwaived_missed_ping_count, 0::bigint) as unwaived_missed_ping_count,
    coalesce(af.completed_booking_count, 0::bigint) as completed_booking_count,
    coalesce(q.eligible_online_seconds, 0::numeric) >= 3600::numeric as presence_achieved,
    floor((dd.manila_date - a.anchor_date)::numeric / 7::numeric) + 1::numeric as week_number,
    a.anchor_date,
    a.campaign_end_date
  from driver_days dd
  cross join anchor a
  left join public.driver_daily_qualification_v1 q on q.driver_id = dd.driver_id and q.manila_date = dd.manila_date
  left join public.driver_daily_activity_facts_v1 af on af.driver_id = dd.driver_id and af.manila_date = dd.manila_date
  left join public.drivers d on d.id = dd.driver_id
),
daily_with_cumulative as (
  select
    dw.*,
    sum(dw.unwaived_missed_ping_count) over (
      partition by dw.driver_id
      order by dw.manila_date
      rows between unbounded preceding and current row
    ) as calendar_cumulative_missed_checks
  from daily_with_week dw
),
scheduled_daily as (
  select
    dc.driver_id,
    dc.driver_name,
    dc.manila_date,
    dc.eligible_online_seconds,
    dc.unwaived_missed_ping_count,
    dc.completed_booking_count,
    dc.presence_achieved,
    dc.calendar_cumulative_missed_checks,
    dc.anchor_date,
    dc.campaign_end_date,
    s.policy_code,
    p.display_name,
    s.attempt_number::numeric as cycle_number,
    s.award_week,
    s.window_start_week,
    s.window_end_week,
    (s.window_end_week - s.window_start_week + 1) as cycle_weeks,
    p.required_presence_days,
    p.required_total_hours,
    p.required_booking_count,
    p.allowed_missed_checks,
    p.miss_check_scope,
    dc.anchor_date + ((s.window_start_week - 1) * 7) as cycle_start,
    dc.anchor_date + ((s.window_end_week * 7) - 1) as cycle_end
  from daily_with_cumulative dc
  join public.driver_incentive_reward_schedule s on dc.week_number between s.window_start_week and s.window_end_week
  join public.driver_incentive_policies p on p.policy_code = s.policy_code
  where dc.anchor_date + (s.window_end_week * 7) <= dc.campaign_end_date
),
cycle_totals as (
  select
    sd.driver_id,
    sd.driver_name,
    sd.policy_code,
    sd.display_name,
    sd.cycle_number,
    sd.cycle_weeks,
    min(sd.anchor_date) as anchor_date,
    min(sd.cycle_start) as cycle_start,
    max(sd.cycle_end) as cycle_end,
    min(sd.manila_date) as cycle_data_start,
    max(sd.manila_date) as cycle_data_end,
    count(*) filter (where sd.presence_achieved) as achieved_presence_days,
    sd.required_presence_days,
    round(sum(sd.eligible_online_seconds) / 3600.0, 2) as achieved_total_hours,
    sd.required_total_hours,
    sum(sd.completed_booking_count)::numeric as achieved_booking_count,
    sd.required_booking_count,
    sum(sd.unwaived_missed_ping_count)::numeric as cycle_missed_checks,
    max(sd.calendar_cumulative_missed_checks)::numeric as calendar_cumulative_missed_checks,
    sd.allowed_missed_checks,
    sd.miss_check_scope,
    sd.award_week,
    sd.window_start_week,
    sd.window_end_week
  from scheduled_daily sd
  group by
    sd.driver_id, sd.driver_name, sd.policy_code, sd.display_name, sd.cycle_number,
    sd.cycle_weeks, sd.required_presence_days, sd.required_total_hours,
    sd.required_booking_count, sd.allowed_missed_checks, sd.miss_check_scope,
    sd.award_week, sd.window_start_week, sd.window_end_week
),
evaluated as (
  select
    ct.*,
    ct.achieved_presence_days >= ct.required_presence_days as presence_requirement_met,
    ct.achieved_total_hours >= ct.required_total_hours as hours_requirement_met,
    ct.achieved_booking_count >= ct.required_booking_count as booking_requirement_met,
    case ct.miss_check_scope
      when 'cycle' then ct.cycle_missed_checks
      else ct.calendar_cumulative_missed_checks
    end <= ct.allowed_missed_checks::numeric as duty_check_requirement_met
  from cycle_totals ct
)
select
  driver_id, driver_name, policy_code, display_name, cycle_number, anchor_date,
  cycle_start, cycle_end, cycle_data_start, cycle_data_end,
  achieved_presence_days, required_presence_days, achieved_total_hours,
  required_total_hours, achieved_booking_count, required_booking_count,
  cycle_missed_checks, calendar_cumulative_missed_checks, allowed_missed_checks,
  miss_check_scope,
  presence_requirement_met and hours_requirement_met and booking_requirement_met and duty_check_requirement_met as qualified,
  cycle_weeks, presence_requirement_met, hours_requirement_met,
  booking_requirement_met, duty_check_requirement_met,
  award_week, window_start_week, window_end_week
from evaluated;

create or replace view public.driver_incentive_claimability_v1 as
with weekly_awards as (
  select a.driver_id, a.policy_code, a.cycle_number, bool_or(a.reward_given) as already_awarded
  from public.driver_incentive_awards a
  where a.policy_code = 'WEEKLY'
  group by a.driver_id, a.policy_code, a.cycle_number
),
one_time_awards as (
  select a.driver_id, a.policy_code, bool_or(a.reward_given) as already_awarded
  from public.driver_incentive_awards a
  where a.policy_code = any (array['PHONE_CLAMP','SHIRT','MONTHLY','THERMAL_BAG','SMARTPHONE'])
  group by a.driver_id, a.policy_code
),
midday_window as (
  select
    q.driver_id,
    q.policy_code,
    q.cycle_number,
    count(gs.week_start) as midday_gate_weeks_required,
    count(*) filter (where coalesce(g.gate_met, false)) as midday_gate_weeks_met,
    round(coalesce(sum(coalesce(g.midday_hours, 0)), 0), 2) as midday_hours,
    round(coalesce(sum(case when gs.week_start::date >= date '2026-08-24' then 7.0 else 5.0 end), 0), 2) as required_midday_hours
  from public.driver_incentive_cycle_qualification_v1 q
  join lateral generate_series(
    greatest(q.cycle_start, date '2026-08-17')::timestamp,
    q.cycle_end::timestamp,
    interval '7 days'
  ) gs(week_start) on q.cycle_end >= date '2026-08-17'
  left join public.driver_incentive_weekly_midday_gate_v1 g
    on g.driver_id = q.driver_id and g.week_start = gs.week_start::date
  group by q.driver_id, q.policy_code, q.cycle_number
),
evaluated as (
  select
    q.driver_id, q.driver_name, q.policy_code, q.display_name, q.cycle_number,
    q.anchor_date, q.cycle_start, q.cycle_end, q.cycle_data_start, q.cycle_data_end,
    case when fa.driver_id is not null then fa.fresh_presence_days else q.achieved_presence_days end as achieved_presence_days,
    q.required_presence_days,
    case when fa.driver_id is not null then fa.fresh_total_hours else q.achieved_total_hours end as achieved_total_hours,
    q.required_total_hours, q.achieved_booking_count, q.required_booking_count,
    q.cycle_missed_checks, q.calendar_cumulative_missed_checks,
    q.allowed_missed_checks, q.miss_check_scope,
    case when fa.driver_id is not null then fa.fresh_presence_requirement_met else q.presence_requirement_met end as presence_requirement_met,
    case when fa.driver_id is not null then fa.fresh_hours_requirement_met else q.hours_requirement_met end as hours_requirement_met,
    q.booking_requirement_met,
    q.duty_check_requirement_met as ping_requirement_met,
    q.cycle_weeks,
    case
      when q.cycle_end < date '2026-08-17' then true
      else coalesce(mw.midday_gate_weeks_required, 0) = coalesce(mw.midday_gate_weeks_met, 0)
    end as midday_gate_requirement_met,
    (now() at time zone 'Asia/Manila')::date > q.cycle_end as cycle_closed,
    q.award_week, q.window_start_week, q.window_end_week,
    coalesce(mw.midday_gate_weeks_met, 0) as midday_gate_weeks_met,
    coalesce(mw.midday_gate_weeks_required, 0) as midday_gate_weeks_required,
    coalesce(mw.midday_hours, 0) as midday_hours,
    coalesce(mw.required_midday_hours, 0) as required_midday_hours
  from public.driver_incentive_cycle_qualification_v1 q
  left join public.driver_incentive_fresh_day_cycle_audit_v1 fa
    on fa.driver_id = q.driver_id and fa.policy_code = q.policy_code and fa.cycle_number = q.cycle_number
  left join midday_window mw
    on mw.driver_id = q.driver_id and mw.policy_code = q.policy_code and mw.cycle_number = q.cycle_number
),
finalized as (
  select
    e.*,
    e.presence_requirement_met and e.hours_requirement_met and e.booking_requirement_met
      and e.ping_requirement_met and e.midday_gate_requirement_met as corrected_qualified
  from evaluated e
)
select
  q.driver_id, q.driver_name, q.policy_code, q.display_name, q.cycle_number,
  q.anchor_date, q.cycle_start, q.cycle_end, q.cycle_data_start, q.cycle_data_end,
  q.achieved_presence_days, q.required_presence_days, q.achieved_total_hours,
  q.required_total_hours, q.achieved_booking_count, q.required_booking_count,
  q.cycle_missed_checks, q.calendar_cumulative_missed_checks, q.allowed_missed_checks,
  q.miss_check_scope, q.corrected_qualified as qualified, q.cycle_weeks,
  q.presence_requirement_met, q.hours_requirement_met, q.booking_requirement_met,
  q.ping_requirement_met and q.midday_gate_requirement_met as duty_check_requirement_met,
  case when q.policy_code = 'WEEKLY' then coalesce(wa.already_awarded, false) else coalesce(oa.already_awarded, false) end as already_awarded,
  q.corrected_qualified and q.cycle_closed
    and not case when q.policy_code = 'WEEKLY' then coalesce(wa.already_awarded, false) else coalesce(oa.already_awarded, false) end as claimable,
  q.ping_requirement_met, q.midday_gate_requirement_met,
  q.award_week, q.window_start_week, q.window_end_week,
  q.midday_gate_weeks_met, q.midday_gate_weeks_required,
  q.midday_hours, q.required_midday_hours
from finalized q
left join weekly_awards wa
  on wa.driver_id = q.driver_id and wa.policy_code = q.policy_code and wa.cycle_number::numeric = q.cycle_number
left join one_time_awards oa
  on oa.driver_id = q.driver_id and oa.policy_code = q.policy_code
where q.driver_id not in (
  '00000000-0000-4000-8000-000000000001'::uuid,
  '00000000-0000-4000-8000-000000000002'::uuid
);
