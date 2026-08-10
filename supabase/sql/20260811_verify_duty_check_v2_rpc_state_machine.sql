-- Verify JRide Duty Check lifecycle v2 RPC state machine.
-- This script performs reads only.

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as arguments,
  p.prosecdef as security_definer,
  p.proacl as execution_acl
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'jride_refresh_driver_availability_ping_v2',
    'jride_create_driver_availability_ping',
    'jride_create_driver_availability_ping_v2',
    'jride_fetch_driver_availability_ping',
    'jride_present_driver_availability_ping',
    'jride_respond_driver_availability_ping'
  )
order by p.proname;

select
  p.proname,
  position(
    'PING_CREATED_V2'
    in pg_get_functiondef(p.oid)
  ) > 0 as has_v2_create_code,
  position(
    'PRESENTED'
    in pg_get_functiondef(p.oid)
  ) > 0 as has_presented_code,
  position(
    'LATE_ACK_REQUIRED'
    in pg_get_functiondef(p.oid)
  ) > 0 as has_late_ack_required_code,
  position(
    'ACKNOWLEDGED_LATE'
    in pg_get_functiondef(p.oid)
  ) > 0 as has_acknowledged_late_code
from pg_proc p
join pg_namespace n
  on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'jride_create_driver_availability_ping_v2',
    'jride_fetch_driver_availability_ping',
    'jride_present_driver_availability_ping',
    'jride_respond_driver_availability_ping'
  )
order by p.proname;

select
  lifecycle_version,
  status,
  count(*) as total
from public.driver_availability_pings
group by lifecycle_version, status
order by lifecycle_version, status;

select
  count(*) as lifecycle_v2_row_count
from public.driver_availability_pings
where lifecycle_version = 2;

select
  count(*) as unresolved_lifecycle_v2_count
from public.driver_availability_pings
where lifecycle_version = 2
  and (
    status = 'pending'
    or (
      status = 'expired'
      and requires_late_ack = true
      and timer_resumed_at is null
    )
  );

select
  conname,
  pg_get_constraintdef(oid) as definition
from pg_constraint
where conname in (
  'driver_availability_pings_lifecycle_version_chk',
  'driver_availability_pings_response_window_chk',
  'driver_availability_pings_v2_delivery_deadline_chk',
  'driver_availability_pings_presented_lifecycle_chk',
  'driver_availability_pings_response_deadline_chk',
  'driver_availability_pings_late_ack_required_chk',
  'driver_availability_pings_late_ack_fields_chk',
  'driver_availability_pings_resume_after_freeze_chk',
  'driver_availability_ping_events_event_type_check'
)
order by conname;

select
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and indexname in (
    'driver_availability_pings_one_unresolved_v2_idx',
    'driver_availability_pings_v2_delivery_deadline_idx',
    'driver_availability_pings_v2_response_deadline_idx',
    'driver_availability_pings_v2_unresolved_late_ack_idx'
  )
order by indexname;

select
  c.relname as table_name,
  t.tgname as trigger_name,
  pg_get_triggerdef(t.oid, true) as trigger_definition
from pg_trigger t
join pg_class c
  on c.oid = t.tgrelid
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'driver_availability_pings',
    'driver_availability_ping_events'
  )
  and not t.tgisinternal
order by c.relname, t.tgname;
