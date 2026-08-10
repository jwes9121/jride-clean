with target_function as (
  select
    p.oid,
    p.prosecdef,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p
  join pg_namespace n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'jride_waive_driver_availability_ping'
    and pg_get_function_identity_arguments(p.oid) =
      'p_ping_id uuid, p_admin_id uuid, p_admin_email text, p_admin_name text, p_admin_role text, p_reason text'
)
select
  count(*) as installed_function_count,
  coalesce(bool_and(prosecdef), false) as security_definer,
  coalesce(bool_or(position('WAIVED_AND_RESUMED' in definition) > 0), false)
    as has_waived_and_resumed,
  coalesce(bool_or(position('WAIVED_AFTER_LATE_ACK' in definition) > 0), false)
    as has_waived_after_late_ack,
  coalesce(bool_or(position('ALREADY_WAIVED' in definition) > 0), false)
    as has_idempotent_code,
  coalesce(bool_or(position('timer_resumed_at' in definition) > 0), false)
    as updates_timer_resumed_at,
  coalesce(bool_or(position('requires_late_ack = false' in definition) > 0), false)
    as clears_late_ack_requirement,
  coalesce(bool_or(position('violation_waived' in definition) > 0), false)
    as records_waiver_event,
  has_function_privilege(
    'service_role',
    'public.jride_waive_driver_availability_ping(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ) as service_role_can_execute,
  has_function_privilege(
    'anon',
    'public.jride_waive_driver_availability_ping(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ) as anon_can_execute,
  has_function_privilege(
    'authenticated',
    'public.jride_waive_driver_availability_ping(uuid,uuid,text,text,text,text)',
    'EXECUTE'
  ) as authenticated_can_execute,
  (
    select count(*)
    from public.driver_availability_pings
    where lifecycle_version = 2
  ) as lifecycle_v2_row_count,
  (
    select count(*)
    from public.driver_availability_pings
    where lifecycle_version = 2
      and status = 'expired'
      and requires_late_ack = true
      and timer_resumed_at is null
  ) as unresolved_lifecycle_v2_count
from target_function;
