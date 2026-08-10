-- Verification for JRide Duty Check lifecycle-v2 incentive timer views.

-- 1. No lifecycle-v2 checks should exist before Android and web activation.
select
  count(*) filter (
    where lifecycle_version = 2
  ) as lifecycle_v2_row_count,
  count(*) filter (
    where lifecycle_version = 2
      and (
        status = 'pending'
        or (
          status = 'expired'
          and requires_late_ack = true
          and timer_resumed_at is null
        )
      )
  ) as unresolved_lifecycle_v2_count
from public.driver_availability_pings;

-- 2. Canonical helper views should currently be empty.
select
  (
    select count(*)
    from public.driver_duty_check_v2_exclusion_intervals_v1
  ) as exclusion_interval_count,
  (
    select count(*)
    from public.driver_duty_check_v2_misses_v1
  ) as v2_miss_count;

-- 3. Lifecycle-v1 observation records must not remove eligible time.
select
  count(*) filter (
    where excluded_seconds <> 0
  ) as daily_rows_with_excluded_seconds,
  coalesce(sum(excluded_seconds), 0) as total_excluded_seconds,
  coalesce(sum(unwaived_missed_ping_count), 0) as total_v2_missed_checks
from public.driver_daily_qualification_v1;

-- 4. With zero lifecycle-v2 rows, raw and eligible period totals must match.
select
  count(*) filter (
    where raw_online_seconds is distinct from eligible_online_seconds
  ) as summary_rows_with_exclusion,
  coalesce(sum(raw_online_seconds - eligible_online_seconds), 0) as total_summary_excluded_seconds,
  coalesce(sum(duty_check_expired_pings), 0) as enforceable_expired_ping_count
from public.driver_incentive_summary_v1;

-- 5. The daily and summary views must reference the canonical v2 fields and
-- must not contain the old login/other-ping reset heuristics.
with defs as (
  select
    lower(pg_get_viewdef('public.driver_daily_qualification_v1'::regclass, true)) as daily_def,
    lower(pg_get_viewdef('public.driver_incentive_summary_v1'::regclass, true)) as summary_def
)
select
  position('driver_duty_check_v2_exclusion_intervals_v1' in daily_def) > 0 as daily_uses_canonical_intervals,
  position('driver_duty_check_v2_misses_v1' in daily_def) > 0 as daily_uses_canonical_misses,
  position('driver_duty_check_v2_exclusion_intervals_v1' in summary_def) > 0 as summary_uses_canonical_intervals,
  position('min(s.login_at)' in daily_def) = 0 as daily_has_no_login_resume_heuristic,
  position('min(s.login_at)' in summary_def) = 0 as summary_has_no_login_resume_heuristic,
  position('p2.responded_at' in daily_def) = 0 as daily_has_no_other_ping_resume_heuristic,
  position('p2.responded_at' in summary_def) = 0 as summary_has_no_other_ping_resume_heuristic
from defs;

-- 6. Helper definitions must be exact-ping, lifecycle-v2 based.
with defs as (
  select
    lower(pg_get_viewdef('public.driver_duty_check_v2_exclusion_intervals_v1'::regclass, true)) as exclusion_def,
    lower(pg_get_viewdef('public.driver_duty_check_v2_misses_v1'::regclass, true)) as misses_def
)
select
  position('lifecycle_version = 2' in exclusion_def) > 0 as exclusion_is_v2_only,
  position('timer_frozen_at' in exclusion_def) > 0 as exclusion_uses_timer_frozen_at,
  position('timer_resumed_at' in exclusion_def) > 0 as exclusion_uses_timer_resumed_at,
  position('lifecycle_version = 2' in misses_def) > 0 as misses_are_v2_only,
  position('violation_waived' in misses_def) > 0 as misses_honor_waiver
from defs;

-- 7. Existing dependent views must still be queryable.
select
  (select count(*) from public.driver_weekly_qualification_v1) as weekly_row_count,
  (select count(*) from public.driver_incentive_claimability_v1) as claimability_row_count,
  (select count(*) from public.driver_incentive_cycle_qualification_v1) as cycle_qualification_row_count;

-- 8. Legacy operational records remain intact for the Duty Check dashboard.
select
  lifecycle_version,
  status,
  count(*) as total
from public.driver_availability_pings
group by lifecycle_version, status
order by lifecycle_version, status;
