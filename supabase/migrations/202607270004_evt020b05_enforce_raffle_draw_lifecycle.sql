/*
JRide Events Platform
Feature: EVT-020B05
Purpose: Add event lifecycle enforcement to event_start_raffle_draw, on
top of the verbatim reconciliation in EVT-020B04. This is the second
behavior-changing migration in the EVT-020 Phase 3B RPC pair.

Policy (EVT-020 Phase 3B decision): a raffle draw may only be started
while the parent event's status is registration_closed or live - the same
operational-open window as check-in, checkpoint scanning, household
registration, and distribution claims. This was deliberately widened from
an initial "live only" proposal after observing that raffle eligibility
already requires attendance_status = 'checked_in', and check-in itself
opens at registration_closed - so checked-in, raffle-eligible attendees
can already exist before an event is marked live. Restricting draws to
live only would have been inconsistent with that existing window.
draft, published, registration_open, completed, and archived are blocked.

The check is placed immediately after resolving the event id and before
the advisory lock, so an out-of-window draw attempt fails fast without
taking the lock or checking for an existing active draw first.

Exception code EVENT_NOT_OPERATIONAL mirrors the app-level
reason: "event_not_operational" response already introduced in EVT-020
Phase 3B.1 and reused in EVT-020B03, so a caller mapping RPC exceptions to
route responses can use the same string across check-in, distribution, and
raffle.

Rollback:
  -- reapply the EVT-020B04 definition verbatim (see that migration file)
  -- to remove this check without losing the reconciled baseline.
*/

create or replace function public.event_start_raffle_draw(
  p_event_slug text,
  p_draw_name text default 'Raffle Draw'::text,
  p_draw_type text default 'minor'::text,
  p_roll_seconds integer default 60,
  p_claim_seconds integer default 20
)
returns table (
  draw_id uuid,
  winner_id uuid,
  attendee_id uuid,
  full_name text,
  group_value text,
  registration_number text,
  reveal_at timestamp with time zone,
  claim_deadline_at timestamp with time zone
)
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_event_id uuid;
  v_event_status text;
  v_draw_id uuid;
  v_winner_id uuid;
  v_attendee record;
  v_reveal_at timestamptz;
  v_claim_deadline_at timestamptz;
begin
  select id, status
  into v_event_id, v_event_status
  from public.events
  where slug = p_event_slug;

  if v_event_id is null then
    raise exception 'Event not found';
  end if;

  if v_event_status not in ('registration_closed', 'live') then
    raise exception 'EVENT_NOT_OPERATIONAL';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_event_id::text)::bigint);

  if exists (
    select 1
    from public.event_raffle_draws
    where event_id = v_event_id
      and status in ('rolling', 'winner_selected')
  ) then
    raise exception 'An active raffle draw already exists';
  end if;

  select
    a.id,
    a.full_name,
    a.group_value,
    a.registration_number
  into v_attendee
  from public.event_attendees a
  join public.event_attendee_types t
    on t.id = a.attendee_type_id
  where a.event_id = v_event_id
    and a.attendance_status = 'checked_in'
    and coalesce(a.is_disqualified, false) = false
    and a.merged_into is null
    and coalesce(t.raffle_eligible, false) = true
    and not exists (
      select 1
      from public.event_raffle_winners w
      where w.event_id = v_event_id
        and w.attendee_id = a.id
        and w.status in ('selected', 'claimed')
    )
  order by gen_random_uuid()
  limit 1;

  if v_attendee.id is null then
    raise exception 'No eligible raffle attendees found';
  end if;

  v_reveal_at := now() + make_interval(secs => p_roll_seconds);
  v_claim_deadline_at := v_reveal_at + make_interval(secs => p_claim_seconds);

  insert into public.event_raffle_draws (
    event_id,
    draw_name,
    draw_type,
    status,
    started_at,
    winner_selected_at,
    created_at,
    updated_at
  )
  values (
    v_event_id,
    p_draw_name,
    p_draw_type,
    'winner_selected',
    now(),
    v_reveal_at,
    now(),
    now()
  )
  returning id into v_draw_id;

  insert into public.event_raffle_winners (
    event_id,
    draw_id,
    attendee_id,
    status,
    claim_deadline_at,
    created_at
  )
  values (
    v_event_id,
    v_draw_id,
    v_attendee.id,
    'selected',
    v_claim_deadline_at,
    now()
  )
  returning id into v_winner_id;

  return query
  select
    v_draw_id,
    v_winner_id,
    v_attendee.id,
    v_attendee.full_name,
    v_attendee.group_value,
    v_attendee.registration_number,
    v_reveal_at,
    v_claim_deadline_at;
end;
$function$;

revoke all on function public.event_start_raffle_draw(text, text, text, integer, integer) from public;
grant execute on function public.event_start_raffle_draw(text, text, text, integer, integer) to service_role;
