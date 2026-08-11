-- JRide Duty Check lifecycle v2 alert-start timer
-- Date: 2026-08-11
--
-- Starts the 180-second response window only after Android confirms that
-- the high-priority Duty Check notification was successfully posted.
-- Screen presentation remains an audit event and does not reset the deadline.
--
-- Normal admin Duty Check creation remains lifecycle version 1 until the
-- alert-start Android client is deployed and verified.

begin;

do $guard$
begin
  if exists (
    select 1
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
  ) then
    raise exception
      'Resolve all lifecycle-v2 pending or unresolved Duty Checks before installing alert-start timing.';
  end if;
end
$guard$;

alter table public.driver_availability_pings
  add column if not exists alerted_at timestamptz,
  add column if not exists alerted_device_id text;

alter table public.driver_availability_ping_events
  drop constraint if exists
    driver_availability_ping_events_event_type_check;

alter table public.driver_availability_ping_events
  add constraint
    driver_availability_ping_events_event_type_check
  check (
    event_type = any (
      array[
        'created'::text,
        'fetched_by_device'::text,
        'alerted_on_device'::text,
        'presented_on_screen'::text,
        'acknowledged'::text,
        'expired'::text,
        'cancelled'::text,
        'late_response_rejected'::text,
        'late_acknowledged'::text,
        'manual_response_recorded'::text,
        'violation_waived'::text
      ]
    )
  );

alter table public.driver_availability_pings
  drop constraint if exists
    driver_availability_pings_response_deadline_chk;

alter table public.driver_availability_pings
  add constraint
    driver_availability_pings_response_deadline_chk
  check (
    response_expires_at is null
    or (
      lifecycle_version = 2
      and (
        (
          alerted_at is not null
          and response_expires_at > alerted_at
        )
        or (
          alerted_at is null
          and presented_at is not null
          and response_expires_at > presented_at
        )
      )
    )
  ) not valid;

alter table public.driver_availability_pings
  validate constraint
    driver_availability_pings_response_deadline_chk;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname =
      'driver_availability_pings_alerted_lifecycle_chk'
  ) then
    alter table public.driver_availability_pings
      add constraint
        driver_availability_pings_alerted_lifecycle_chk
      check (
        alerted_at is null
        or lifecycle_version = 2
      ) not valid;
  end if;
end
$constraint$;

alter table public.driver_availability_pings
  validate constraint
    driver_availability_pings_alerted_lifecycle_chk;

drop index if exists
  public.driver_availability_pings_v2_delivery_deadline_idx;

create index
  driver_availability_pings_v2_delivery_deadline_idx
on public.driver_availability_pings (delivery_expires_at)
where
  lifecycle_version = 2
  and status = 'pending'
  and alerted_at is null;

drop index if exists
  public.driver_availability_pings_v2_response_deadline_idx;

create index
  driver_availability_pings_v2_response_deadline_idx
on public.driver_availability_pings (response_expires_at)
where
  lifecycle_version = 2
  and status = 'pending'
  and alerted_at is not null;

create or replace function public.jride_refresh_driver_availability_ping_v2(
  p_driver_id uuid,
  p_device_id text default null,
  p_expiry_source text default 'state_refresh'
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_device_id text := nullif(trim(coalesce(p_device_id, '')), '');
  v_expiry_source text := coalesce(
    nullif(trim(coalesce(p_expiry_source, '')), ''),
    'state_refresh'
  );
begin
  if p_driver_id is null then
    return;
  end if;

  with cancelled_rows as (
    update public.driver_availability_pings
    set
      status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, v_now),
      requires_late_ack = false,
      resolution_kind = coalesce(
        resolution_kind,
        'delivery_expired_not_alerted'
      )
    where driver_id = p_driver_id
      and lifecycle_version = 2
      and status = 'pending'
      and alerted_at is null
      and delivery_expires_at is not null
      and delivery_expires_at < v_now
    returning
      id,
      driver_id,
      cancelled_at,
      delivery_expires_at
  )
  insert into public.driver_availability_ping_events (
    ping_id,
    event_type,
    recorded_at,
    driver_id,
    device_id,
    metadata
  )
  select
    id,
    'cancelled',
    coalesce(cancelled_at, v_now),
    driver_id,
    v_device_id,
    jsonb_build_object(
      'cancel_source', 'delivery_expired_not_alerted',
      'state_refresh_source', v_expiry_source,
      'delivery_expires_at', delivery_expires_at
    )
  from cancelled_rows
  on conflict (ping_id, event_type) do nothing;

  with expired_rows as (
    update public.driver_availability_pings
    set
      status = 'expired',
      expired_at = coalesce(
        expired_at,
        response_expires_at,
        v_now
      ),
      requires_late_ack = true,
      timer_frozen_at = coalesce(
        timer_frozen_at,
        response_expires_at,
        v_now
      ),
      resolution_kind = 'expired_unacknowledged'
    where driver_id = p_driver_id
      and lifecycle_version = 2
      and status = 'pending'
      and alerted_at is not null
      and response_expires_at is not null
      and response_expires_at < v_now
    returning
      id,
      driver_id,
      expired_at,
      response_expires_at,
      timer_frozen_at
  )
  insert into public.driver_availability_ping_events (
    ping_id,
    event_type,
    recorded_at,
    driver_id,
    device_id,
    metadata
  )
  select
    id,
    'expired',
    coalesce(timer_frozen_at, expired_at, v_now),
    driver_id,
    v_device_id,
    jsonb_build_object(
      'expiry_source', v_expiry_source,
      'response_expires_at', response_expires_at,
      'timer_frozen_at', timer_frozen_at,
      'requires_late_ack', true
    )
  from expired_rows
  on conflict (ping_id, event_type) do nothing;
end;
$function$;

create or replace function public.jride_create_driver_availability_ping_v2(
  p_driver_id uuid,
  p_created_by uuid default null,
  p_creation_source text default 'admin',
  p_notes text default null,
  p_response_window_seconds integer default 180,
  p_delivery_window_seconds integer default 180
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_ping public.driver_availability_pings%rowtype;
  v_existing public.driver_availability_pings%rowtype;
  v_response_window_seconds integer :=
    coalesce(p_response_window_seconds, 180);
  v_delivery_window_seconds integer :=
    coalesce(p_delivery_window_seconds, 180);
  v_creation_source text := coalesce(
    nullif(trim(coalesce(p_creation_source, '')), ''),
    'admin'
  );
  v_delivery_expires_at timestamptz;
begin
  if p_driver_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVER_ID_REQUIRED'
    );
  end if;

  if v_response_window_seconds < 30
     or v_response_window_seconds > 600 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_RESPONSE_WINDOW',
      'minimum_seconds', 30,
      'maximum_seconds', 600
    );
  end if;

  if v_delivery_window_seconds < 30
     or v_delivery_window_seconds > 600 then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_DELIVERY_WINDOW',
      'minimum_seconds', 30,
      'maximum_seconds', 600
    );
  end if;

  if v_creation_source not in (
    'admin',
    'dispatcher',
    'system',
    'test'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'INVALID_CREATION_SOURCE'
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    null,
    'v2_create_before_new_ping'
  );

  with expired_rows as (
    update public.driver_availability_pings
    set
      status = 'expired',
      expired_at = coalesce(expired_at, v_now)
    where driver_id = p_driver_id
      and lifecycle_version = 1
      and status = 'pending'
      and expires_at < v_now
    returning id, driver_id, expired_at
  )
  insert into public.driver_availability_ping_events (
    ping_id,
    event_type,
    recorded_at,
    driver_id,
    metadata
  )
  select
    id,
    'expired',
    coalesce(expired_at, v_now),
    driver_id,
    jsonb_build_object(
      'expiry_source',
      'v2_create_before_new_ping_legacy_cleanup'
    )
  from expired_rows
  on conflict (ping_id, event_type) do nothing;

  select *
  into v_existing
  from public.driver_availability_pings
  where driver_id = p_driver_id
    and (
      status = 'pending'
      or (
        lifecycle_version = 2
        and status = 'expired'
        and requires_late_ack = true
        and timer_resumed_at is null
      )
    )
  order by created_at desc
  limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'code',
        case
          when v_existing.status = 'pending'
            then 'PING_ALREADY_PENDING'
          else 'PING_ALREADY_UNRESOLVED'
        end,
      'ping', jsonb_build_object(
        'id', v_existing.id,
        'driver_id', v_existing.driver_id,
        'status', v_existing.status,
        'lifecycle_version', v_existing.lifecycle_version,
        'requires_late_ack', v_existing.requires_late_ack,
        'created_at', v_existing.created_at,
        'expires_at', v_existing.expires_at
      )
    );
  end if;

  v_delivery_expires_at :=
    v_now + make_interval(
      secs => v_delivery_window_seconds
    );

  insert into public.driver_availability_pings (
    driver_id,
    status,
    created_at,
    expires_at,
    created_by,
    creation_source,
    notes,
    lifecycle_version,
    response_window_seconds,
    delivery_expires_at,
    requires_late_ack
  )
  values (
    p_driver_id,
    'pending',
    v_now,
    v_delivery_expires_at,
    p_created_by,
    v_creation_source,
    nullif(trim(coalesce(p_notes, '')), ''),
    2,
    v_response_window_seconds,
    v_delivery_expires_at,
    false
  )
  returning *
  into v_ping;

  insert into public.driver_availability_ping_events (
    ping_id,
    event_type,
    recorded_at,
    driver_id,
    metadata
  )
  values (
    v_ping.id,
    'created',
    v_now,
    v_ping.driver_id,
    jsonb_build_object(
      'creation_source', v_ping.creation_source,
      'lifecycle_version', 2,
      'delivery_window_seconds',
        v_delivery_window_seconds,
      'response_window_seconds',
        v_response_window_seconds,
      'delivery_expires_at',
        v_delivery_expires_at
    )
  )
  on conflict (ping_id, event_type) do nothing;

  return jsonb_build_object(
    'ok', true,
    'code', 'PING_CREATED_V2',
    'ping', jsonb_build_object(
      'id', v_ping.id,
      'driver_id', v_ping.driver_id,
      'status', v_ping.status,
      'state', 'awaiting_alert',
      'created_at', v_ping.created_at,
      'expires_at', v_ping.expires_at,
      'delivery_expires_at',
        v_ping.delivery_expires_at,
      'response_window_seconds',
        v_ping.response_window_seconds,
      'creation_source', v_ping.creation_source,
      'lifecycle_version', v_ping.lifecycle_version
    )
  );
end;
$function$;

create or replace function public.jride_fetch_driver_availability_ping(
  p_driver_id uuid,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_ping public.driver_availability_pings%rowtype;
  v_device_id text :=
    nullif(trim(coalesce(p_device_id, '')), '');
  v_state text;
begin
  if p_driver_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVER_ID_REQUIRED',
      'ping', null
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    v_device_id,
    'driver_pending_fetch_v2'
  );

  with expired_rows as (
    update public.driver_availability_pings
    set
      status = 'expired',
      expired_at = coalesce(expired_at, v_now)
    where driver_id = p_driver_id
      and lifecycle_version = 1
      and status = 'pending'
      and expires_at < v_now
    returning id, driver_id, expired_at
  )
  insert into public.driver_availability_ping_events (
    ping_id,
    event_type,
    recorded_at,
    driver_id,
    device_id,
    metadata
  )
  select
    id,
    'expired',
    coalesce(expired_at, v_now),
    driver_id,
    v_device_id,
    jsonb_build_object(
      'expiry_source',
      'driver_pending_fetch_legacy'
    )
  from expired_rows
  on conflict (ping_id, event_type) do nothing;

  select *
  into v_ping
  from public.driver_availability_pings
  where driver_id = p_driver_id
    and lifecycle_version = 2
    and status = 'expired'
    and requires_late_ack = true
    and timer_resumed_at is null
  order by timer_frozen_at asc nulls last
  limit 1
  for update;

  if found then
    update public.driver_availability_pings
    set
      last_fetched_at = v_now,
      fetch_count = fetch_count + 1
    where id = v_ping.id
      and driver_id = p_driver_id
      and lifecycle_version = 2
      and status = 'expired'
      and requires_late_ack = true
      and timer_resumed_at is null
    returning *
    into v_ping;

    return jsonb_build_object(
      'ok', true,
      'code', 'LATE_ACK_REQUIRED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'expired_unacknowledged',
        'lifecycle_version', v_ping.lifecycle_version,
        'created_at', v_ping.created_at,
        'expires_at',
          coalesce(
            v_ping.response_expires_at,
            v_ping.expires_at
          ),
        'alerted_at', v_ping.alerted_at,
        'alerted_device_id',
          v_ping.alerted_device_id,
        'presented_at', v_ping.presented_at,
        'response_expires_at',
          v_ping.response_expires_at,
        'requires_late_ack',
          v_ping.requires_late_ack,
        'timer_frozen_at',
          v_ping.timer_frozen_at,
        'resolution_kind',
          v_ping.resolution_kind,
        'first_seen_at', v_ping.first_seen_at,
        'last_fetched_at',
          v_ping.last_fetched_at,
        'fetch_count', v_ping.fetch_count
      )
    );
  end if;

  select *
  into v_ping
  from public.driver_availability_pings
  where driver_id = p_driver_id
    and status = 'pending'
    and (
      (
        lifecycle_version = 1
        and expires_at >= v_now
      )
      or
      (
        lifecycle_version = 2
        and (
          (
            alerted_at is null
            and delivery_expires_at is not null
            and delivery_expires_at >= v_now
          )
          or
          (
            alerted_at is not null
            and response_expires_at is not null
            and response_expires_at >= v_now
          )
        )
      )
    )
  order by created_at asc
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'code', 'NO_PENDING_PING',
      'server_now', v_now,
      'ping', null
    );
  end if;

  update public.driver_availability_pings
  set
    first_seen_at = coalesce(first_seen_at, v_now),
    last_fetched_at = v_now,
    fetch_count = fetch_count + 1
  where id = v_ping.id
    and driver_id = p_driver_id
    and status = 'pending'
  returning *
  into v_ping;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'code', 'NO_PENDING_PING',
      'server_now', v_now,
      'ping', null
    );
  end if;

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
    'fetched_by_device',
    v_now,
    p_driver_id,
    v_device_id,
    jsonb_build_object(
      'first_seen_at', v_ping.first_seen_at,
      'lifecycle_version',
        v_ping.lifecycle_version
    )
  )
  on conflict (ping_id, event_type) do nothing;

  v_state :=
    case
      when v_ping.lifecycle_version = 2
           and v_ping.alerted_at is null
        then 'awaiting_alert'
      when v_ping.lifecycle_version = 2
           and v_ping.presented_at is null
        then 'awaiting_presentation'
      when v_ping.lifecycle_version = 2
        then 'awaiting_response'
      else 'legacy_pending'
    end;

  return jsonb_build_object(
    'ok', true,
    'code', 'PENDING_PING_FOUND',
    'server_now', v_now,
    'ping', jsonb_build_object(
      'id', v_ping.id,
      'driver_id', v_ping.driver_id,
      'status', v_ping.status,
      'state', v_state,
      'lifecycle_version',
        v_ping.lifecycle_version,
      'created_at', v_ping.created_at,
      'expires_at',
        case
          when v_ping.lifecycle_version = 2
               and v_ping.alerted_at is null
            then v_ping.delivery_expires_at
          when v_ping.lifecycle_version = 2
            then v_ping.response_expires_at
          else v_ping.expires_at
        end,
      'delivery_expires_at',
        v_ping.delivery_expires_at,
      'alerted_at', v_ping.alerted_at,
      'alerted_device_id',
        v_ping.alerted_device_id,
      'presented_at', v_ping.presented_at,
      'response_expires_at',
        v_ping.response_expires_at,
      'response_window_seconds',
        v_ping.response_window_seconds,
      'requires_late_ack',
        v_ping.requires_late_ack,
      'first_seen_at', v_ping.first_seen_at,
      'last_fetched_at', v_ping.last_fetched_at,
      'fetch_count', v_ping.fetch_count
    )
  );
end;
$function$;

create or replace function public.jride_alert_driver_availability_ping(
  p_ping_id uuid,
  p_driver_id uuid,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_ping public.driver_availability_pings%rowtype;
  v_device_id text :=
    nullif(trim(coalesce(p_device_id, '')), '');
  v_response_expires_at timestamptz;
begin
  if p_ping_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_ID_REQUIRED'
    );
  end if;

  if p_driver_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVER_ID_REQUIRED'
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    v_device_id,
    'driver_alert_request'
  );

  select *
  into v_ping
  from public.driver_availability_pings
  where id = p_ping_id
    and driver_id = p_driver_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_FOUND'
    );
  end if;

  if v_ping.lifecycle_version = 1 then
    if v_ping.status = 'acknowledged' then
      return jsonb_build_object(
        'ok', true,
        'code', 'ALREADY_ACKNOWLEDGED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'status', v_ping.status,
          'responded_at', v_ping.responded_at
        )
      );
    end if;

    if v_ping.status = 'cancelled' then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_CANCELLED',
        'server_now', v_now
      );
    end if;

    if v_ping.status = 'expired'
       or v_ping.expires_at < v_now then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_EXPIRED',
        'server_now', v_now,
        'expires_at', v_ping.expires_at
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'LEGACY_PING',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'legacy_pending',
        'lifecycle_version', 1,
        'expires_at', v_ping.expires_at
      )
    );
  end if;

  if v_ping.status = 'acknowledged' then
    return jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_ACKNOWLEDGED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'responded_at', v_ping.responded_at
      )
    );
  end if;

  if v_ping.status = 'cancelled' then
    return jsonb_build_object(
      'ok', false,
      'code',
        case
          when v_ping.resolution_kind in (
            'delivery_expired_not_alerted',
            'delivery_expired_not_presented'
          )
            then 'PING_DELIVERY_EXPIRED'
          else 'PING_CANCELLED'
        end,
      'server_now', v_now,
      'resolution_kind', v_ping.resolution_kind
    );
  end if;

  if v_ping.status = 'expired' then
    if v_ping.requires_late_ack
       and v_ping.timer_resumed_at is null then
      return jsonb_build_object(
        'ok', true,
        'code', 'LATE_ACK_REQUIRED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'driver_id', v_ping.driver_id,
          'status', v_ping.status,
          'state', 'expired_unacknowledged',
          'lifecycle_version', v_ping.lifecycle_version,
          'alerted_at', v_ping.alerted_at,
          'alerted_device_id', v_ping.alerted_device_id,
          'presented_at', v_ping.presented_at,
          'response_expires_at', v_ping.response_expires_at,
          'timer_frozen_at', v_ping.timer_frozen_at,
          'requires_late_ack', v_ping.requires_late_ack,
          'resolution_kind', v_ping.resolution_kind
        )
      );
    end if;

    if v_ping.response_result = 'accepted_late'
       or v_ping.late_acknowledged_at is not null then
      return jsonb_build_object(
        'ok', true,
        'code', 'ALREADY_LATE_ACKNOWLEDGED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'status', v_ping.status,
          'late_acknowledged_at', v_ping.late_acknowledged_at,
          'timer_resumed_at', v_ping.timer_resumed_at,
          'resolution_kind', v_ping.resolution_kind
        )
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'PING_RESOLVED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'timer_resumed_at', v_ping.timer_resumed_at,
        'resolution_kind', v_ping.resolution_kind
      )
    );
  end if;

  if v_ping.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_ALERTABLE',
      'server_now', v_now,
      'status', v_ping.status
    );
  end if;

  if v_ping.alerted_at is null then
    if v_ping.delivery_expires_at is null
       or v_ping.delivery_expires_at < v_now then
      perform public.jride_refresh_driver_availability_ping_v2(
        p_driver_id,
        v_device_id,
        'driver_alert_delivery_expired'
      );

      return jsonb_build_object(
        'ok', false,
        'code', 'PING_DELIVERY_EXPIRED',
        'server_now', v_now
      );
    end if;

    v_response_expires_at :=
      v_now + make_interval(
        secs => v_ping.response_window_seconds
      );

    update public.driver_availability_pings
    set
      alerted_at = v_now,
      alerted_device_id = v_device_id,
      response_expires_at = v_response_expires_at,
      expires_at = v_response_expires_at,
      resolution_kind = 'awaiting_response'
    where id = p_ping_id
      and driver_id = p_driver_id
      and lifecycle_version = 2
      and status = 'pending'
      and alerted_at is null
    returning *
    into v_ping;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_ALERT_RACE',
        'server_now', v_now
      );
    end if;

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
      'alerted_on_device',
      v_now,
      p_driver_id,
      v_device_id,
      jsonb_build_object(
        'alerted_at', v_ping.alerted_at,
        'response_window_seconds', v_ping.response_window_seconds,
        'response_expires_at', v_ping.response_expires_at
      )
    )
    on conflict (ping_id, event_type) do nothing;

    return jsonb_build_object(
      'ok', true,
      'code', 'ALERTED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state',
          case
            when v_ping.presented_at is null
              then 'awaiting_presentation'
            else 'awaiting_response'
          end,
        'lifecycle_version', v_ping.lifecycle_version,
        'alerted_at', v_ping.alerted_at,
        'alerted_device_id', v_ping.alerted_device_id,
        'presented_at', v_ping.presented_at,
        'response_expires_at', v_ping.response_expires_at,
        'expires_at', v_ping.response_expires_at,
        'response_window_seconds', v_ping.response_window_seconds
      )
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    v_device_id,
    'driver_alert_repeat'
  );

  select *
  into v_ping
  from public.driver_availability_pings
  where id = p_ping_id
    and driver_id = p_driver_id
  limit 1;

  if v_ping.status = 'expired'
     and v_ping.requires_late_ack
     and v_ping.timer_resumed_at is null then
    return jsonb_build_object(
      'ok', true,
      'code', 'LATE_ACK_REQUIRED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'expired_unacknowledged',
        'lifecycle_version', v_ping.lifecycle_version,
        'alerted_at', v_ping.alerted_at,
        'alerted_device_id', v_ping.alerted_device_id,
        'presented_at', v_ping.presented_at,
        'response_expires_at', v_ping.response_expires_at,
        'timer_frozen_at', v_ping.timer_frozen_at,
        'requires_late_ack', v_ping.requires_late_ack
      )
    );
  end if;

  if v_ping.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'code', 'PING_RESOLVED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'resolution_kind', v_ping.resolution_kind
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ALREADY_ALERTED',
    'server_now', v_now,
    'ping', jsonb_build_object(
      'id', v_ping.id,
      'driver_id', v_ping.driver_id,
      'status', v_ping.status,
      'state',
        case
          when v_ping.presented_at is null
            then 'awaiting_presentation'
          else 'awaiting_response'
        end,
      'lifecycle_version', v_ping.lifecycle_version,
      'alerted_at', v_ping.alerted_at,
      'alerted_device_id', v_ping.alerted_device_id,
      'presented_at', v_ping.presented_at,
      'response_expires_at', v_ping.response_expires_at,
      'expires_at', v_ping.response_expires_at,
      'response_window_seconds', v_ping.response_window_seconds
    )
  );
end;
$function$;

create or replace function public.jride_present_driver_availability_ping(
  p_ping_id uuid,
  p_driver_id uuid,
  p_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_now timestamptz := now();
  v_ping public.driver_availability_pings%rowtype;
  v_device_id text :=
    nullif(trim(coalesce(p_device_id, '')), '');
begin
  if p_ping_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_ID_REQUIRED'
    );
  end if;

  if p_driver_id is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'DRIVER_ID_REQUIRED'
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    v_device_id,
    'driver_present_request'
  );

  select *
  into v_ping
  from public.driver_availability_pings
  where id = p_ping_id
    and driver_id = p_driver_id
  limit 1
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_FOUND'
    );
  end if;

  if v_ping.lifecycle_version = 1 then
    if v_ping.status = 'acknowledged' then
      return jsonb_build_object(
        'ok', true,
        'code', 'ALREADY_ACKNOWLEDGED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'status', v_ping.status,
          'responded_at', v_ping.responded_at
        )
      );
    end if;

    if v_ping.status = 'cancelled' then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_CANCELLED',
        'server_now', v_now
      );
    end if;

    if v_ping.status = 'expired' then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_EXPIRED',
        'server_now', v_now,
        'expires_at', v_ping.expires_at
      );
    end if;

    if v_ping.expires_at < v_now then
      update public.driver_availability_pings
      set
        status = 'expired',
        expired_at = coalesce(expired_at, v_now)
      where id = p_ping_id
        and driver_id = p_driver_id
        and lifecycle_version = 1
        and status = 'pending'
      returning *
      into v_ping;

      insert into public.driver_availability_ping_events (
        ping_id,
        event_type,
        recorded_at,
        driver_id,
        device_id,
        metadata
      )
      values (
        p_ping_id,
        'expired',
        coalesce(v_ping.expired_at, v_now),
        p_driver_id,
        v_device_id,
        jsonb_build_object(
          'expiry_source', 'driver_present_legacy',
          'lifecycle_version', 1
        )
      )
      on conflict (ping_id, event_type) do nothing;

      return jsonb_build_object(
        'ok', false,
        'code', 'PING_EXPIRED',
        'server_now', v_now,
        'expires_at', v_ping.expires_at
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'LEGACY_PING',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'legacy_pending',
        'lifecycle_version', 1,
        'expires_at', v_ping.expires_at
      )
    );
  end if;

  if v_ping.status = 'acknowledged' then
    return jsonb_build_object(
      'ok', true,
      'code', 'ALREADY_ACKNOWLEDGED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'responded_at', v_ping.responded_at
      )
    );
  end if;

  if v_ping.status = 'cancelled' then
    return jsonb_build_object(
      'ok', false,
      'code',
        case
          when v_ping.resolution_kind in (
            'delivery_expired_not_alerted',
            'delivery_expired_not_presented'
          )
            then 'PING_DELIVERY_EXPIRED'
          else 'PING_CANCELLED'
        end,
      'server_now', v_now,
      'resolution_kind', v_ping.resolution_kind
    );
  end if;

  if v_ping.status = 'expired' then
    if v_ping.requires_late_ack
       and v_ping.timer_resumed_at is null then

      if v_ping.presented_at is null then
        update public.driver_availability_pings
        set
          presented_at = v_now,
          presented_device_id =
            coalesce(v_device_id, presented_device_id)
        where id = p_ping_id
          and driver_id = p_driver_id
          and lifecycle_version = 2
          and status = 'expired'
          and requires_late_ack = true
          and timer_resumed_at is null
          and presented_at is null
        returning *
        into v_ping;

        if found then
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
            'presented_on_screen',
            v_now,
            p_driver_id,
            v_device_id,
            jsonb_build_object(
              'presented_at', v_ping.presented_at,
              'presentation_after_expiry', true,
              'alerted_at', v_ping.alerted_at,
              'response_expires_at', v_ping.response_expires_at
            )
          )
          on conflict (ping_id, event_type) do nothing;
        else
          select *
          into v_ping
          from public.driver_availability_pings
          where id = p_ping_id
            and driver_id = p_driver_id
          limit 1;
        end if;
      end if;

      return jsonb_build_object(
        'ok', true,
        'code', 'LATE_ACK_REQUIRED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'driver_id', v_ping.driver_id,
          'status', v_ping.status,
          'state', 'expired_unacknowledged',
          'lifecycle_version', v_ping.lifecycle_version,
          'alerted_at', v_ping.alerted_at,
          'alerted_device_id', v_ping.alerted_device_id,
          'presented_at', v_ping.presented_at,
          'response_expires_at', v_ping.response_expires_at,
          'timer_frozen_at', v_ping.timer_frozen_at,
          'requires_late_ack', v_ping.requires_late_ack,
          'resolution_kind', v_ping.resolution_kind
        )
      );
    end if;

    if v_ping.response_result = 'accepted_late'
       or v_ping.late_acknowledged_at is not null then
      return jsonb_build_object(
        'ok', true,
        'code', 'ALREADY_LATE_ACKNOWLEDGED',
        'server_now', v_now,
        'ping', jsonb_build_object(
          'id', v_ping.id,
          'status', v_ping.status,
          'late_acknowledged_at', v_ping.late_acknowledged_at,
          'timer_resumed_at', v_ping.timer_resumed_at,
          'resolution_kind', v_ping.resolution_kind
        )
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'code', 'PING_RESOLVED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'timer_resumed_at', v_ping.timer_resumed_at,
        'resolution_kind', v_ping.resolution_kind
      )
    );
  end if;

  if v_ping.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_PRESENTABLE',
      'server_now', v_now,
      'status', v_ping.status
    );
  end if;

  if v_ping.alerted_at is null
     or v_ping.response_expires_at is null then
    return jsonb_build_object(
      'ok', false,
      'code', 'PING_NOT_ALERTED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'lifecycle_version', v_ping.lifecycle_version,
        'delivery_expires_at', v_ping.delivery_expires_at
      )
    );
  end if;

  if v_ping.presented_at is null then
    update public.driver_availability_pings
    set
      presented_at = v_now,
      presented_device_id = v_device_id
    where id = p_ping_id
      and driver_id = p_driver_id
      and lifecycle_version = 2
      and status = 'pending'
      and alerted_at is not null
      and response_expires_at is not null
      and presented_at is null
    returning *
    into v_ping;

    if not found then
      return jsonb_build_object(
        'ok', false,
        'code', 'PING_PRESENT_RACE',
        'server_now', v_now
      );
    end if;

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
      'presented_on_screen',
      v_now,
      p_driver_id,
      v_device_id,
      jsonb_build_object(
        'presented_at', v_ping.presented_at,
        'alerted_at', v_ping.alerted_at,
        'response_window_seconds', v_ping.response_window_seconds,
        'response_expires_at', v_ping.response_expires_at
      )
    )
    on conflict (ping_id, event_type) do nothing;

    return jsonb_build_object(
      'ok', true,
      'code', 'PRESENTED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'awaiting_response',
        'lifecycle_version', v_ping.lifecycle_version,
        'alerted_at', v_ping.alerted_at,
        'alerted_device_id', v_ping.alerted_device_id,
        'presented_at', v_ping.presented_at,
        'response_expires_at', v_ping.response_expires_at,
        'expires_at', v_ping.response_expires_at,
        'response_window_seconds', v_ping.response_window_seconds
      )
    );
  end if;

  perform public.jride_refresh_driver_availability_ping_v2(
    p_driver_id,
    v_device_id,
    'driver_present_repeat'
  );

  select *
  into v_ping
  from public.driver_availability_pings
  where id = p_ping_id
    and driver_id = p_driver_id
  limit 1;

  if v_ping.status = 'expired'
     and v_ping.requires_late_ack
     and v_ping.timer_resumed_at is null then
    return jsonb_build_object(
      'ok', true,
      'code', 'LATE_ACK_REQUIRED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'driver_id', v_ping.driver_id,
        'status', v_ping.status,
        'state', 'expired_unacknowledged',
        'lifecycle_version', v_ping.lifecycle_version,
        'alerted_at', v_ping.alerted_at,
        'alerted_device_id', v_ping.alerted_device_id,
        'presented_at', v_ping.presented_at,
        'response_expires_at', v_ping.response_expires_at,
        'timer_frozen_at', v_ping.timer_frozen_at,
        'requires_late_ack', v_ping.requires_late_ack
      )
    );
  end if;

  if v_ping.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'code', 'PING_RESOLVED',
      'server_now', v_now,
      'ping', jsonb_build_object(
        'id', v_ping.id,
        'status', v_ping.status,
        'resolution_kind', v_ping.resolution_kind
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'code', 'ALREADY_PRESENTED',
    'server_now', v_now,
    'ping', jsonb_build_object(
      'id', v_ping.id,
      'driver_id', v_ping.driver_id,
      'status', v_ping.status,
      'state', 'awaiting_response',
      'lifecycle_version', v_ping.lifecycle_version,
      'alerted_at', v_ping.alerted_at,
      'alerted_device_id', v_ping.alerted_device_id,
      'presented_at', v_ping.presented_at,
      'response_expires_at', v_ping.response_expires_at,
      'expires_at', v_ping.response_expires_at,
      'response_window_seconds', v_ping.response_window_seconds
    )
  );
end;
$function$;

revoke all on function
  public.jride_alert_driver_availability_ping(
    uuid,
    uuid,
    text
  )
from public;

revoke all on function
  public.jride_alert_driver_availability_ping(
    uuid,
    uuid,
    text
  )
from anon;

revoke all on function
  public.jride_alert_driver_availability_ping(
    uuid,
    uuid,
    text
  )
from authenticated;

grant execute on function
  public.jride_alert_driver_availability_ping(
    uuid,
    uuid,
    text
  )
to service_role;

comment on column
  public.driver_availability_pings.alerted_at
is
  'Server timestamp when Android confirms the Duty Check notification was successfully posted; lifecycle-v2 response timing starts here.';

comment on column
  public.driver_availability_pings.alerted_device_id
is
  'Device identifier that confirmed the lifecycle-v2 Duty Check notification was posted.';

commit;
