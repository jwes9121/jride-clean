-- Verify JRide Duty Check lifecycle v2 alert-start timing.

with defs as (
  select
    (
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'jride_alert_driver_availability_ping'
      limit 1
    ) as alert_def,
    (
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'jride_present_driver_availability_ping'
      limit 1
    ) as present_def,
    (
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'jride_create_driver_availability_ping_v2'
      limit 1
    ) as create_v2_def,
    (
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'jride_fetch_driver_availability_ping'
      limit 1
    ) as fetch_def,
    (
      select pg_get_functiondef(p.oid)
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'jride_refresh_driver_availability_ping_v2'
      limit 1
    ) as refresh_def
),
counts as (
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
  from public.driver_availability_pings
)
select
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'driver_availability_pings'
      and column_name in (
        'alerted_at',
        'alerted_device_id'
      )
  ) = 2 as alerted_columns_installed,

  (
    select position(
      'alerted_on_device'
      in pg_get_constraintdef(c.oid)
    ) > 0
    from pg_constraint c
    where c.conname =
      'driver_availability_ping_events_event_type_check'
  ) as alerted_event_allowed,

  position('awaiting_alert' in defs.create_v2_def) > 0
    as create_v2_reports_awaiting_alert,

  position('ALERTED' in defs.alert_def) > 0
    as alert_rpc_has_alerted_code,

  position('ALREADY_ALERTED' in defs.alert_def) > 0
    as alert_rpc_is_idempotent,

  position('alerted_at = v_now' in defs.alert_def) > 0
    as alert_rpc_sets_alerted_at,

  position('response_expires_at = v_response_expires_at' in defs.alert_def) > 0
    as alert_rpc_sets_response_deadline,

  position('make_interval' in defs.alert_def) > 0
    as alert_rpc_starts_response_window,

  position('PING_NOT_ALERTED' in defs.present_def) > 0
    as present_requires_prior_alert,

  position('make_interval' in defs.present_def) = 0
    as present_does_not_start_or_extend_timer,

  position('alerted_at is null' in lower(defs.fetch_def)) > 0
    as fetch_has_pre_alert_state,

  position('alerted_at is not null' in lower(defs.fetch_def)) > 0
    as fetch_has_alerted_state,

  position('alerted_at is null' in lower(defs.refresh_def)) > 0
    as refresh_delivery_expiry_uses_alert_state,

  position('alerted_at is not null' in lower(defs.refresh_def)) > 0
    as refresh_response_expiry_uses_alert_state,

  has_function_privilege(
    'service_role',
    'public.jride_alert_driver_availability_ping(uuid,uuid,text)',
    'EXECUTE'
  ) as service_role_can_alert,

  not has_function_privilege(
    'anon',
    'public.jride_alert_driver_availability_ping(uuid,uuid,text)',
    'EXECUTE'
  ) as anon_cannot_alert,

  not has_function_privilege(
    'authenticated',
    'public.jride_alert_driver_availability_ping(uuid,uuid,text)',
    'EXECUTE'
  ) as authenticated_cannot_alert,

  (
    select position(
      'alerted_at is null'
      in lower(indexdef)
    ) > 0
    from pg_indexes
    where schemaname = 'public'
      and indexname =
        'driver_availability_pings_v2_delivery_deadline_idx'
  ) as delivery_index_uses_alerted_at,

  (
    select position(
      'alerted_at is not null'
      in lower(indexdef)
    ) > 0
    from pg_indexes
    where schemaname = 'public'
      and indexname =
        'driver_availability_pings_v2_response_deadline_idx'
  ) as response_index_uses_alerted_at,

  counts.lifecycle_v2_row_count,
  counts.unresolved_lifecycle_v2_count

from defs
cross join counts;
