-- JRide Duty Check lifecycle v2 admin waiver and timer resume RPC
-- Date: 2026-08-11
--
-- Scope:
--   * Atomically record violation_waived.
--   * Resume lifecycle-v2 eligible time at the waiver timestamp.
--   * Preserve lifecycle-v1 rows as historical observation records.
--   * Keep late acknowledgement evidence while removing the miss from the ladder.

begin;

create or replace function public.jride_waive_driver_availability_ping(
  p_ping_id uuid,
  p_admin_id uuid default null,
  p_admin_email text default null,
  p_admin_name text default null,
  p_admin_role text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_ping public.driver_availability_pings%rowtype;
  v_reason text := trim(coalesce(p_reason, ''));
  v_existing_waiver public.driver_availability_ping_events%rowtype;
  v_event public.driver_availability_ping_events%rowtype;
  v_resume_at timestamptz;
  v_code text;
begin
  if p_ping_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_ID_REQUIRED',
      'message', 'ping_id is required.'
    );
  end if;

  if length(v_reason) < 5 or length(v_reason) > 500 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_WAIVER_REASON',
      'message', 'Waiver reason must contain 5 to 500 characters.'
    );
  end if;

  select *
  into v_ping
  from public.driver_availability_pings
  where id = p_ping_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_FOUND',
      'message', 'Duty Check was not found.'
    );
  end if;

  select *
  into v_existing_waiver
  from public.driver_availability_ping_events
  where ping_id = p_ping_id
    and event_type = 'violation_waived'
  limit 1;

  if v_ping.lifecycle_version = 2 then
    if v_ping.status <> 'expired'
       or v_ping.presented_at is null
       or v_ping.timer_frozen_at is null then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_NOT_WAIVABLE',
        'message', 'Only a presented, expired Duty Check may be waived.',
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'driver_id', v_ping.driver_id,
          'status', v_ping.status,
          'lifecycle_version', v_ping.lifecycle_version,
          'presented_at', v_ping.presented_at,
          'timer_frozen_at', v_ping.timer_frozen_at,
          'timer_resumed_at', v_ping.timer_resumed_at,
          'resolution_kind', v_ping.resolution_kind
        )
      );
    end if;

    v_resume_at := greatest(
      coalesce(v_existing_waiver.recorded_at, v_now),
      v_ping.timer_frozen_at
    );

    update public.driver_availability_pings
    set
      requires_late_ack = false,
      timer_resumed_at = coalesce(timer_resumed_at, v_resume_at),
      resolution_kind = 'violation_waived'
    where id = v_ping.id
      and lifecycle_version = 2
      and status = 'expired'
    returning *
    into v_ping;

    if v_existing_waiver.id is null then
      insert into public.driver_availability_ping_events (
        ping_id,
        event_type,
        recorded_at,
        driver_id,
        device_id,
        metadata
      )
      values (
        v_ping.id,
        'violation_waived',
        v_resume_at,
        v_ping.driver_id,
        null,
        jsonb_build_object(
          'reason', v_reason,
          'admin_id', p_admin_id,
          'admin_email', nullif(trim(coalesce(p_admin_email, '')), ''),
          'admin_name', nullif(trim(coalesce(p_admin_name, '')), ''),
          'admin_role', nullif(trim(coalesce(p_admin_role, '')), ''),
          'lifecycle_version', 2,
          'timer_frozen_at', v_ping.timer_frozen_at,
          'timer_resumed_at', v_ping.timer_resumed_at,
          'previous_response_result', v_ping.response_result,
          'previous_late_acknowledged_at', v_ping.late_acknowledged_at
        )
      )
      returning *
      into v_event;

      v_code := case
        when v_ping.late_acknowledged_at is null
          then 'WAIVED_AND_RESUMED'
        else 'WAIVED_AFTER_LATE_ACK'
      end;
    else
      v_event := v_existing_waiver;
      v_code := 'ALREADY_WAIVED';
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', v_code,
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'lifecycle_version', v_ping.lifecycle_version,
        'requires_late_ack', v_ping.requires_late_ack,
        'timer_frozen_at', v_ping.timer_frozen_at,
        'timer_resumed_at', v_ping.timer_resumed_at,
        'late_acknowledged_at', v_ping.late_acknowledged_at,
        'response_result', v_ping.response_result,
        'resolution_kind', v_ping.resolution_kind
      ),
      'event', jsonb_build_object(
        'id', v_event.id,
        'ping_id', v_event.ping_id,
        'event_type', v_event.event_type,
        'recorded_at', v_event.recorded_at,
        'metadata', v_event.metadata
      )
    );
  end if;

  if v_existing_waiver.id is null then
    insert into public.driver_availability_ping_events (
      ping_id,
      event_type,
      recorded_at,
      driver_id,
      device_id,
      metadata
    )
    values (
      v_ping.id,
      'violation_waived',
      v_now,
      v_ping.driver_id,
      null,
      jsonb_build_object(
        'reason', v_reason,
        'admin_id', p_admin_id,
        'admin_email', nullif(trim(coalesce(p_admin_email, '')), ''),
        'admin_name', nullif(trim(coalesce(p_admin_name, '')), ''),
        'admin_role', nullif(trim(coalesce(p_admin_role, '')), ''),
        'lifecycle_version', v_ping.lifecycle_version
      )
    )
    returning *
    into v_event;

    v_code := 'WAIVED_LEGACY';
  else
    v_event := v_existing_waiver;
    v_code := 'ALREADY_WAIVED';
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'server_now', v_now,
    'ping', jsonb_build_object(
      'id', v_ping.id,
      'driver_id', v_ping.driver_id,
      'status', v_ping.status,
      'lifecycle_version', v_ping.lifecycle_version,
      'responded_at', v_ping.responded_at,
      'expired_at', v_ping.expired_at,
      'resolution_kind', v_ping.resolution_kind
    ),
    'event', jsonb_build_object(
      'id', v_event.id,
      'ping_id', v_event.ping_id,
      'event_type', v_event.event_type,
      'recorded_at', v_event.recorded_at,
      'metadata', v_event.metadata
    )
  );
end;
$function$;

revoke all on function public.jride_waive_driver_availability_ping(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from public;

revoke all on function public.jride_waive_driver_availability_ping(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from anon;

revoke all on function public.jride_waive_driver_availability_ping(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) from authenticated;

grant execute on function public.jride_waive_driver_availability_ping(
  uuid,
  uuid,
  text,
  text,
  text,
  text
) to service_role;

commit;
