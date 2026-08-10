-- JRide Duty Check lifecycle v2 cumulative missed-check ladder
-- Date: 2026-08-11
--
-- Scope:
--   * Keep all existing lifecycle-version-1 Duty Checks observation-only.
--   * Make every incentive policy use the same campaign-cumulative miss ladder.
--   * Preserve the first cumulative miss as warning-only.
--   * Disqualify Weekly Load beginning with cumulative miss 2.
--   * Preserve current output values while no lifecycle-version-2 rows exist.
--   * Do not activate lifecycle version 2 or change Android in this migration.
--
-- Locked ladder:
--   0-1 misses: all Duty Check requirements remain met.
--   2 misses: WEEKLY fails.
--   3 misses: PHONE_CLAMP also fails.
--   4 misses: SHIRT also fails.
--   5 misses: MONTHLY also fails.
--   6 misses: THERMAL_BAG also fails.
--   7+ misses: SMARTPHONE also fails.

do $phase1d$
declare
  v_v2_count bigint;
  v_expected_policy_count integer;
  v_updated_policy_count integer;

  v_weekly_before jsonb;
  v_weekly_after jsonb;

  v_cycle_before jsonb;
  v_cycle_after jsonb;

  v_claimability_before jsonb;
  v_claimability_after jsonb;
begin
  select count(*)
  into v_v2_count
  from public.driver_availability_pings
  where lifecycle_version = 2;

  if v_v2_count <> 0 then
    raise exception
      'Phase 1D requires zero lifecycle-v2 rows, found %.',
      v_v2_count;
  end if;

  with expected (
    policy_code,
    cycle_weeks,
    allowed_missed_checks
  ) as (
    values
      ('WEEKLY'::text, 1::integer, 1::integer),
      ('PHONE_CLAMP'::text, 2::integer, 2::integer),
      ('SHIRT'::text, 3::integer, 3::integer),
      ('MONTHLY'::text, 4::integer, 4::integer),
      ('THERMAL_BAG'::text, 8::integer, 5::integer),
      ('SMARTPHONE'::text, 12::integer, 6::integer)
  )
  select count(*)
  into v_expected_policy_count
  from expected e
  join public.driver_incentive_policies p
    on p.policy_code = e.policy_code
   and p.cycle_weeks = e.cycle_weeks
   and p.allowed_missed_checks = e.allowed_missed_checks;

  if v_expected_policy_count <> 6 then
    raise exception
      'Duty Check policy ladder mismatch. Expected 6 exact policy mappings, found %.',
      v_expected_policy_count;
  end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(w)
      order by w.driver_id
    ),
    '[]'::jsonb
  )
  into v_weekly_before
  from public.driver_weekly_qualification_v1 w;

  select coalesce(
    jsonb_agg(
      to_jsonb(q) - 'miss_check_scope'
      order by
        q.driver_id,
        q.policy_code,
        q.cycle_number
    ),
    '[]'::jsonb
  )
  into v_cycle_before
  from public.driver_incentive_cycle_qualification_v1 q;

  select coalesce(
    jsonb_agg(
      to_jsonb(c) - 'miss_check_scope'
      order by
        c.driver_id,
        c.policy_code,
        c.cycle_number
    ),
    '[]'::jsonb
  )
  into v_claimability_before
  from public.driver_incentive_claimability_v1 c;

  update public.driver_incentive_policies
  set miss_check_scope = 'cumulative'
  where policy_code in (
    'WEEKLY',
    'PHONE_CLAMP',
    'SHIRT',
    'MONTHLY',
    'THERMAL_BAG',
    'SMARTPHONE'
  );

  get diagnostics v_updated_policy_count = row_count;

  if v_updated_policy_count <> 6 then
    raise exception
      'Expected to update 6 Duty Check policy rows, updated %.',
      v_updated_policy_count;
  end if;

  execute $weekly_view$
    create or replace view public.driver_weekly_qualification_v1 as
    with weekly_bounds as (
      select
        p.id as period_id,
        p.start_at as period_start,
        p.end_at as period_end
      from public.driver_incentive_periods p
      where p.is_active
      limit 1
    ),
    weekly_policy as (
      select
        (
          p.required_total_hours::numeric
          * 3600::numeric
          / nullif(
              p.required_presence_days,
              0
            )::numeric
        ) as daily_seconds_required,
        (
          p.required_total_hours::numeric
          * 3600::numeric
        ) as weekly_seconds_required,
        p.required_presence_days::bigint as required_days,
        p.allowed_missed_checks::numeric as max_missed_checks
      from public.driver_incentive_policies p
      where p.policy_code = 'WEEKLY'
        and p.miss_check_scope = 'cumulative'
      limit 1
    ),
    daily_with_cumulative as (
      select
        q.driver_id,
        q.driver_name,
        q.manila_date,
        q.eligible_online_seconds,
        q.progressed_booking_count,
        q.unwaived_missed_ping_count,
        sum(
          coalesce(
            q.unwaived_missed_ping_count,
            0::bigint
          )
        ) over (
          partition by q.driver_id
          order by q.manila_date
          rows between unbounded preceding and current row
        ) as calendar_cumulative_missed_checks
      from public.driver_daily_qualification_v1 q
      cross join weekly_bounds wb
      where q.manila_date >= (
          wb.period_start
          at time zone 'Asia/Manila'
        )::date
        and q.manila_date < coalesce(
          (
            wb.period_end
            at time zone 'Asia/Manila'
          )::date + 1,
          'infinity'::date
        )
    ),
    daily_weekly_eval as (
      select
        d.driver_id,
        d.driver_name,
        d.manila_date,
        d.eligible_online_seconds,
        d.progressed_booking_count,
        d.unwaived_missed_ping_count,
        d.calendar_cumulative_missed_checks,
        d.eligible_online_seconds
          >= wp.daily_seconds_required
          as hours_requirement_met,
        d.calendar_cumulative_missed_checks
          <= wp.max_missed_checks
          as duty_check_requirement_met,
        d.progressed_booking_count > 0
          as activity_recorded,
        d.eligible_online_seconds
          >= wp.daily_seconds_required
          as qualified_day
      from daily_with_cumulative d
      cross join weekly_policy wp
    )
    select
      dwe.driver_id,
      dwe.driver_name,
      wb.period_id as incentive_period_id,
      sum(
        dwe.eligible_online_seconds
      ) as total_eligible_seconds,
      round(
        sum(
          dwe.eligible_online_seconds
        ) / 3600.0,
        2
      ) as total_eligible_hours,
      count(*) filter (
        where dwe.hours_requirement_met
      ) as hours_target_day_count,
      count(*) filter (
        where dwe.activity_recorded
      ) as activity_day_count,
      count(*) filter (
        where dwe.duty_check_requirement_met
      ) as duty_check_compliant_day_count,
      count(*) filter (
        where dwe.qualified_day
      ) as qualified_day_count,
      sum(
        dwe.progressed_booking_count
      ) as total_progressed_booking_count,
      sum(
        dwe.unwaived_missed_ping_count
      ) as total_unwaived_missed_checks,
      wp.daily_seconds_required,
      wp.weekly_seconds_required,
      wp.required_days,
      wp.max_missed_checks,
      sum(
        dwe.eligible_online_seconds
      ) >= wp.weekly_seconds_required
        as weekly_hours_requirement_met,
      count(*) filter (
        where dwe.qualified_day
      ) >= wp.required_days
        as weekly_days_requirement_met,
      max(
        dwe.calendar_cumulative_missed_checks
      ) <= wp.max_missed_checks
        as weekly_duty_check_requirement_met,
      sum(
        dwe.eligible_online_seconds
      ) >= wp.weekly_seconds_required
      and count(*) filter (
        where dwe.qualified_day
      ) >= wp.required_days
      and max(
        dwe.calendar_cumulative_missed_checks
      ) <= wp.max_missed_checks
        as weekly_qualified
    from daily_weekly_eval dwe
    cross join weekly_bounds wb
    cross join weekly_policy wp
    group by
      dwe.driver_id,
      dwe.driver_name,
      wb.period_id,
      wp.daily_seconds_required,
      wp.weekly_seconds_required,
      wp.required_days,
      wp.max_missed_checks
  $weekly_view$;

  select coalesce(
    jsonb_agg(
      to_jsonb(w)
      order by w.driver_id
    ),
    '[]'::jsonb
  )
  into v_weekly_after
  from public.driver_weekly_qualification_v1 w;

  select coalesce(
    jsonb_agg(
      to_jsonb(q) - 'miss_check_scope'
      order by
        q.driver_id,
        q.policy_code,
        q.cycle_number
    ),
    '[]'::jsonb
  )
  into v_cycle_after
  from public.driver_incentive_cycle_qualification_v1 q;

  select coalesce(
    jsonb_agg(
      to_jsonb(c) - 'miss_check_scope'
      order by
        c.driver_id,
        c.policy_code,
        c.cycle_number
    ),
    '[]'::jsonb
  )
  into v_claimability_after
  from public.driver_incentive_claimability_v1 c;

  if v_weekly_after is distinct from v_weekly_before then
    raise exception
      'Phase 1D changed current weekly qualification output while no lifecycle-v2 misses exist.';
  end if;

  if v_cycle_after is distinct from v_cycle_before then
    raise exception
      'Phase 1D changed current cycle qualification output beyond miss_check_scope while no lifecycle-v2 misses exist.';
  end if;

  if v_claimability_after is distinct from v_claimability_before then
    raise exception
      'Phase 1D changed current claimability output beyond miss_check_scope while no lifecycle-v2 misses exist.';
  end if;

  if exists (
    select 1
    from public.driver_incentive_policies p
    where p.policy_code in (
      'WEEKLY',
      'PHONE_CLAMP',
      'SHIRT',
      'MONTHLY',
      'THERMAL_BAG',
      'SMARTPHONE'
    )
      and p.miss_check_scope <> 'cumulative'
  ) then
    raise exception
      'One or more Duty Check policy rows did not switch to cumulative scope.';
  end if;
end
$phase1d$;
