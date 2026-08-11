-- Verify JRide Duty Check v2 driver capability signal
-- Expected: every boolean below is true.
-- Existing rows should all be v2-capable=false until the new Driver APK reports capability.

with cols as (
  select
    count(*) filter (where column_name = 'client_version_name') > 0
      as has_client_version_name,
    count(*) filter (where column_name = 'client_version_code') > 0
      as has_client_version_code,
    count(*) filter (where column_name = 'duty_check_v2_capable') > 0
      as has_duty_check_v2_capable,
    count(*) filter (where column_name = 'capability_last_seen_at') > 0
      as has_capability_last_seen_at
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'driver_device_locks'
),
defaults as (
  select
    exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'driver_device_locks'
        and column_name = 'duty_check_v2_capable'
        and is_nullable = 'NO'
        and column_default ilike '%false%'
    ) as v2_capability_defaults_false
),
existing as (
  select
    count(*) as lock_rows,
    count(*) filter (where duty_check_v2_capable = true) as capable_rows,
    count(*) filter (where duty_check_v2_capable = false) as non_capable_rows
  from public.driver_device_locks
),
unresolved as (
  select count(*) as unresolved_v2_rows
  from public.driver_availability_pings
  where lifecycle_version = 2
    and (
      status = 'pending'
      or (
        status = 'expired'
        and requires_late_ack = true
        and timer_resumed_at is null
      )
    )
)
select
  cols.has_client_version_name,
  cols.has_client_version_code,
  cols.has_duty_check_v2_capable,
  cols.has_capability_last_seen_at,
  defaults.v2_capability_defaults_false,
  existing.lock_rows,
  existing.capable_rows,
  existing.non_capable_rows,
  (existing.capable_rows = 0) as no_device_enabled_before_android_rollout,
  unresolved.unresolved_v2_rows,
  (unresolved.unresolved_v2_rows = 0) as no_unresolved_v2_rows
from cols, defaults, existing, unresolved;