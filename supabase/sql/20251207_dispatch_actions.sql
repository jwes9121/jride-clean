-- Dispatch actions log + RPCs

create table if not exists public.dispatch_actions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  dispatcher_id uuid,
  dispatcher_name text,
  trip_id uuid not null,
  driver_id uuid,
  action_type text not null,
  note text,
  meta jsonb default '{}'::jsonb
);

comment on table public.dispatch_actions is 'Audit log for dispatcher actions (nudge, reassign, emergency, etc.)';

-- Nudge
create or replace function public.admin_nudge_driver(
  p_trip_id uuid,
  p_driver_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_payload jsonb;
begin
  insert into public.dispatch_actions (trip_id, driver_id, action_type, note)
  values (p_trip_id, p_driver_id, 'nudge', p_note);

  v_payload := jsonb_build_object(
    'trip_id', p_trip_id,
    'driver_id', p_driver_id,
    'note', coalesce(p_note, '')
  );

  return v_payload;
end;
$$;

-- Reassign (simple version: just switch bookings.driver_id)
create or replace function public.admin_reassign_trip(
  p_trip_id uuid,
  p_from_driver_id uuid,
  p_to_driver_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  select jsonb_build_object(
    'id', b.id,
    'driver_id', b.driver_id,
    'status', b.status
  )
  into v_before
  from public.bookings b
  where b.id = p_trip_id;

  update public.bookings
  set driver_id = p_to_driver_id,
      updated_at = now()
  where id = p_trip_id;

  select jsonb_build_object(
    'id', b.id,
    'driver_id', b.driver_id,
    'status', b.status
  )
  into v_after
  from public.bookings b
  where b.id = p_trip_id;

  insert into public.dispatch_actions (trip_id, driver_id, action_type, note, meta)
  values (
    p_trip_id,
    p_to_driver_id,
    'reassign',
    p_note,
    jsonb_build_object(
      'from_driver_id', p_from_driver_id,
      'to_driver_id', p_to_driver_id,
      'before', v_before,
      'after', v_after
    )
  );

  return jsonb_build_object(
    'trip_id', p_trip_id,
    'from_driver_id', p_from_driver_id,
    'to_driver_id', p_to_driver_id
  );
end;
$$;

-- Emergency flag (bookings.is_emergency boolean expected)
create or replace function public.admin_set_trip_emergency(
  p_trip_id uuid,
  p_is_emergency boolean
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_after jsonb;
begin
  update public.bookings
  set is_emergency = p_is_emergency,
      updated_at = now()
  where id = p_trip_id;

  select jsonb_build_object(
    'id', b.id,
    'is_emergency', b.is_emergency,
    'status', b.status
  )
  into v_after
  from public.bookings b
  where b.id = p_trip_id;

  insert into public.dispatch_actions (trip_id, action_type, meta)
  values (
    p_trip_id,
    case when p_is_emergency then 'emergency_on' else 'emergency_off' end,
    jsonb_build_object('is_emergency', p_is_emergency)
  );

  return v_after;
end;
$$;
