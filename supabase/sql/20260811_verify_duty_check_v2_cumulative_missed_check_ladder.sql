-- Verify JRide Duty Check lifecycle v2 cumulative missed-check ladder
-- Date: 2026-08-11

select
  policy_code,
  display_name,
  cycle_weeks,
  allowed_missed_checks,
  miss_check_scope
from public.driver_incentive_policies
where policy_code in (
  'WEEKLY',
  'PHONE_CLAMP',
  'SHIRT',
  'MONTHLY',
  'THERMAL_BAG',
  'SMARTPHONE'
)
order by sort_order;

with miss_counts as (
  select generate_series(0, 7)::integer as miss_count
),
policy as (
  select
    policy_code,
    allowed_missed_checks
  from public.driver_incentive_policies
  where policy_code in (
    'WEEKLY',
    'PHONE_CLAMP',
    'SHIRT',
    'MONTHLY',
    'THERMAL_BAG',
    'SMARTPHONE'
  )
)
select
  m.miss_count,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'WEEKLY'
  ) as weekly_eligible,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'PHONE_CLAMP'
  ) as phone_clamp_eligible,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'SHIRT'
  ) as shirt_eligible,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'MONTHLY'
  ) as monthly_eligible,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'THERMAL_BAG'
  ) as thermal_bag_eligible,
  bool_and(
    m.miss_count <= p.allowed_missed_checks
  ) filter (
    where p.policy_code = 'SMARTPHONE'
  ) as smartphone_eligible
from miss_counts m
cross join policy p
group by m.miss_count
order by m.miss_count;

with expected_policy (
  policy_code,
  cycle_weeks,
  allowed_missed_checks,
  miss_check_scope
) as (
  values
    ('WEEKLY'::text, 1::integer, 1::integer, 'cumulative'::text),
    ('PHONE_CLAMP'::text, 2::integer, 2::integer, 'cumulative'::text),
    ('SHIRT'::text, 3::integer, 3::integer, 'cumulative'::text),
    ('MONTHLY'::text, 4::integer, 4::integer, 'cumulative'::text),
    ('THERMAL_BAG'::text, 8::integer, 5::integer, 'cumulative'::text),
    ('SMARTPHONE'::text, 12::integer, 6::integer, 'cumulative'::text)
),
policy_mismatches as (
  select
    e.policy_code
  from expected_policy e
  left join public.driver_incentive_policies p
    on p.policy_code = e.policy_code
  where p.policy_code is null
     or p.cycle_weeks <> e.cycle_weeks
     or p.allowed_missed_checks <> e.allowed_missed_checks
     or p.miss_check_scope <> e.miss_check_scope
),
expected_ladder (
  miss_count,
  weekly_eligible,
  phone_clamp_eligible,
  shirt_eligible,
  monthly_eligible,
  thermal_bag_eligible,
  smartphone_eligible
) as (
  values
    (0, true,  true,  true,  true,  true,  true),
    (1, true,  true,  true,  true,  true,  true),
    (2, false, true,  true,  true,  true,  true),
    (3, false, false, true,  true,  true,  true),
    (4, false, false, false, true,  true,  true),
    (5, false, false, false, false, true,  true),
    (6, false, false, false, false, false, true),
    (7, false, false, false, false, false, false)
),
actual_ladder as (
  select
    m.miss_count,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'WEEKLY'
    ) as weekly_eligible,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'PHONE_CLAMP'
    ) as phone_clamp_eligible,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'SHIRT'
    ) as shirt_eligible,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'MONTHLY'
    ) as monthly_eligible,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'THERMAL_BAG'
    ) as thermal_bag_eligible,
    bool_and(
      m.miss_count <= p.allowed_missed_checks
    ) filter (
      where p.policy_code = 'SMARTPHONE'
    ) as smartphone_eligible
  from (
    select generate_series(0, 7)::integer as miss_count
  ) m
  cross join public.driver_incentive_policies p
  where p.policy_code in (
    'WEEKLY',
    'PHONE_CLAMP',
    'SHIRT',
    'MONTHLY',
    'THERMAL_BAG',
    'SMARTPHONE'
  )
  group by m.miss_count
),
ladder_mismatches as (
  select e.miss_count
  from expected_ladder e
  left join actual_ladder a
    on a.miss_count = e.miss_count
  where a.miss_count is null
     or a.weekly_eligible
          is distinct from e.weekly_eligible
     or a.phone_clamp_eligible
          is distinct from e.phone_clamp_eligible
     or a.shirt_eligible
          is distinct from e.shirt_eligible
     or a.monthly_eligible
          is distinct from e.monthly_eligible
     or a.thermal_bag_eligible
          is distinct from e.thermal_bag_eligible
     or a.smartphone_eligible
          is distinct from e.smartphone_eligible
),
definitions as (
  select
    lower(
      pg_get_viewdef(
        'public.driver_weekly_qualification_v1'::regclass,
        true
      )
    ) as weekly_def,
    lower(
      pg_get_viewdef(
        'public.driver_incentive_cycle_qualification_v1'::regclass,
        true
      )
    ) as cycle_def,
    lower(
      pg_get_viewdef(
        'public.driver_incentive_claimability_v1'::regclass,
        true
      )
    ) as claimability_def
),
counts as (
  select
    (
      select count(*)
      from public.driver_availability_pings
      where lifecycle_version = 2
    ) as lifecycle_v2_row_count,
    (
      select count(*)
      from public.driver_weekly_qualification_v1
    ) as weekly_row_count,
    (
      select count(*)
      from public.driver_incentive_cycle_qualification_v1
    ) as cycle_qualification_row_count,
    (
      select count(*)
      from public.driver_incentive_claimability_v1
    ) as claimability_row_count
)
select
  (
    select count(*)
    from policy_mismatches
  ) as policy_mismatch_count,
  (
    select count(*)
    from ladder_mismatches
  ) as ladder_mismatch_count,
  c.lifecycle_v2_row_count,
  c.weekly_row_count,
  c.cycle_qualification_row_count,
  c.claimability_row_count,
  position(
    'driver_incentive_policies'
    in d.weekly_def
  ) > 0 as weekly_uses_policy_table,
  position(
    'calendar_cumulative_missed_checks'
    in d.weekly_def
  ) > 0 as weekly_uses_cumulative_misses,
  position(
    'unwaived_missed_ping_count = 0'
    in d.weekly_def
  ) = 0 as first_miss_does_not_remove_day,
  position(
    'calendar_cumulative_missed_checks'
    in d.cycle_def
  ) > 0 as cycle_uses_cumulative_misses,
  position(
    'driver_incentive_cycle_qualification_v1'
    in d.claimability_def
  ) > 0 as claimability_uses_cycle_qualification,
  (
    (
      select count(*)
      from policy_mismatches
    ) = 0
    and (
      select count(*)
      from ladder_mismatches
    ) = 0
    and c.lifecycle_v2_row_count = 0
    and position(
      'driver_incentive_policies'
      in d.weekly_def
    ) > 0
    and position(
      'calendar_cumulative_missed_checks'
      in d.weekly_def
    ) > 0
    and position(
      'unwaived_missed_ping_count = 0'
      in d.weekly_def
    ) = 0
    and position(
      'calendar_cumulative_missed_checks'
      in d.cycle_def
    ) > 0
    and position(
      'driver_incentive_cycle_qualification_v1'
      in d.claimability_def
    ) > 0
  ) as phase1d_pass
from definitions d
cross join counts c;
