-- Read-only verification for driver location observation V1.
-- Run after the migration is deployed. This script changes no data.

do $verify$
declare
  v_table_oid oid := to_regclass(
    'public.driver_location_observation_minutes_v1'
  );
  v_view_oid oid := to_regclass(
    'public.driver_location_observation_current_period_v1'
  );
  v_function_oid oid := to_regprocedure(
    'public.jride_record_driver_location_observation_minute_v1(uuid,double precision,double precision,text,text,text,integer,timestamptz,double precision,boolean,text,text,text,text,text,text,timestamptz)'
  );
begin
  if v_table_oid is null then
    raise exception 'driver_location_observation_minutes_v1 is missing';
  end if;

  if v_view_oid is null then
    raise exception 'driver_location_observation_current_period_v1 is missing';
  end if;

  if v_function_oid is null then
    raise exception 'location observation RPC is missing';
  end if;

  if not (
    select c.relrowsecurity
    from pg_class c
    where c.oid = v_table_oid
  ) then
    raise exception 'location observation table must have RLS enabled';
  end if;

  if not coalesce((
    select c.reloptions @> array['security_invoker=true']::text[]
    from pg_class c
    where c.oid = v_view_oid
  ), false) then
    raise exception 'location observation view must use security_invoker';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated']) as roles(role_name)
    cross join unnest(
      array['select', 'insert', 'update', 'delete', 'truncate']
    ) as privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      'public.driver_location_observation_minutes_v1',
      privileges.privilege_name
    )
  ) then
    raise exception 'location observation table is exposed to client roles';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.driver_location_observation_minutes_v1',
    'select'
  ) or not has_table_privilege(
    'service_role',
    'public.driver_location_observation_minutes_v1',
    'insert'
  ) then
    raise exception 'service_role must have select and insert on observations';
  end if;

  if has_table_privilege(
    'service_role',
    'public.driver_location_observation_minutes_v1',
    'update'
  ) or has_table_privilege(
    'service_role',
    'public.driver_location_observation_minutes_v1',
    'delete'
  ) or has_table_privilege(
    'service_role',
    'public.driver_location_observation_minutes_v1',
    'truncate'
  ) then
    raise exception 'service_role can mutate or truncate recorded observations';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated']) as roles(role_name)
    cross join unnest(
      array['select', 'insert', 'update', 'delete', 'truncate']
    ) as privileges(privilege_name)
    where has_table_privilege(
      roles.role_name,
      'public.driver_location_observation_current_period_v1',
      privileges.privilege_name
    )
  ) then
    raise exception 'location observation view is exposed to client roles';
  end if;

  if not has_table_privilege(
    'service_role',
    'public.driver_location_observation_current_period_v1',
    'select'
  ) then
    raise exception 'service_role cannot read the location observation view';
  end if;

  if exists (
    select 1
    from pg_proc p
    cross join lateral aclexplode(
      coalesce(p.proacl, acldefault('f', p.proowner))
    ) acl
    where p.oid = v_function_oid
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ) then
    raise exception 'location observation RPC is executable by PUBLIC';
  end if;

  if not has_function_privilege(
    'service_role',
    v_function_oid,
    'execute'
  ) then
    raise exception 'service_role cannot execute the location observation RPC';
  end if;

  if has_function_privilege(
    'anon',
    v_function_oid,
    'execute'
  ) or has_function_privilege(
    'authenticated',
    v_function_oid,
    'execute'
  ) then
    raise exception 'location observation RPC is executable by client roles';
  end if;

  if (
    select p.prosecdef
    from pg_proc p
    where p.oid = v_function_oid
  ) then
    raise exception 'location observation RPC must remain SECURITY INVOKER';
  end if;

  if position(
    'driver_location_observation' in lower(
      pg_get_viewdef('public.driver_daily_qualification_v1'::regclass, true)
    )
  ) > 0 then
    raise exception 'incentive qualification unexpectedly references observations';
  end if;

  if exists (
    select 1
    from public.driver_location_observation_current_period_v1 v
    where v.location_observed_minute_count
      <> v.bearer_observed_minute_count
        + v.driver_secret_observed_minute_count
  ) then
    raise exception 'observation auth-mode totals do not reconcile';
  end if;

  if exists (
    select 1
    from public.driver_location_observation_current_period_v1 v
    where v.location_observed_minute_count
      <> v.same_registered_town_minute_count
        + v.different_registered_town_minute_count
        + v.town_not_evaluable_minute_count
  ) then
    raise exception 'observation town-comparison totals do not reconcile';
  end if;

  if exists (
    select 1
    from public.driver_location_observation_current_period_v1 v
    where v.different_registered_town_minute_count
      <> v.different_town_no_trip_minute_count
        + v.different_town_pre_pickup_minute_count
        + v.different_town_post_pickup_minute_count
        + v.different_town_ambiguous_minute_count
        + v.different_town_context_not_evaluable_minute_count
  ) then
    raise exception 'different-town context totals do not reconcile';
  end if;

  if exists (
    select 1
    from public.driver_location_observation_current_period_v1 v
    where v.online_with_fresh_gps_minute_count > v.online_minute_count
       or v.online_with_fresh_gps_minute_count
          > v.location_observed_minute_count
  ) then
    raise exception 'online and fresh-GPS overlap exceeds a source total';
  end if;

  if exists (
    select 1
    from public.driver_location_observation_current_period_v1 v
    where coalesce((
      select sum((item.value ->> 'minute_count')::bigint)
      from jsonb_array_elements(v.observed_town_minutes) as item(value)
    ), 0::numeric) <> v.location_observed_minute_count
  ) then
    raise exception 'observed-town JSON totals do not reconcile';
  end if;
end;
$verify$;

select
  period_name,
  observation_window_start_at,
  observation_window_end_at,
  driver_id,
  driver_name,
  current_registered_town,
  online_minute_count,
  location_observed_minute_count,
  online_with_fresh_gps_minute_count,
  online_without_fresh_gps_minute_count,
  location_coverage_pct,
  same_registered_town_minute_count,
  different_registered_town_minute_count,
  town_not_evaluable_minute_count,
  different_town_no_trip_minute_count,
  different_town_pre_pickup_minute_count,
  different_town_post_pickup_minute_count,
  different_town_ambiguous_minute_count,
  different_town_context_not_evaluable_minute_count,
  bearer_observed_minute_count,
  driver_secret_observed_minute_count,
  accuracy_reported_minute_count,
  client_mock_true_minute_count,
  observed_town_minutes,
  first_observed_at,
  last_observed_at
from public.driver_location_observation_current_period_v1
order by lower(driver_name), driver_id;
