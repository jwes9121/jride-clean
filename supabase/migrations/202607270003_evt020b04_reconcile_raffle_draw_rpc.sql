/*
JRide Events Platform
Feature: EVT-020B04
Purpose: Repository reconciliation only. Captures the current, already-live
definition of event_start_raffle_draw verbatim, with no logic change
whatsoever. Same situation as EVT-020B02: this function was applied
directly to production outside the migration history and does not appear
in any prior migration file. Existing prior notes on this function ("fixed
search_path, execute restricted to service_role/postgres") are confirmed
by this inspection - SET search_path and the grants below match.

No intended behavioral change for existing production databases. This is
byte-for-byte the function definition returned by inspecting pg_proc in
production (identity_arguments, result_type, language, and body all
verified against the live database before this file was written).

Rollback:
  drop function if exists public.event_start_raffle_draw(text, text, text, integer, integer);
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
  v_draw_id uuid;
  v_winner_id uuid;
  v_attendee record;
  v_reveal_at timestamptz;
  v_claim_deadline_at timestamptz;
begin
  select id
  into v_event_id
  from public.events
  where slug = p_event_slug;

  if v_event_id is null then
    raise exception 'Event not found';
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
