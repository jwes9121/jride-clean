/*
JRide Events Platform
Fun Walk event hardening:
1. Canonical raffle eligibility function shared by draw, eligible count,
   and projector animation names.
2. For dbhs-batch-2001-fun-run-2026, eligibility is:
   - registration_source = online
   - registration_status = registered
   - gate attendance_status = checked_in with checked_in_at present
   - not disqualified and not merged
   - all attendee types, including Batch 2001, Golden Jubilarians,
     regular participants, and online guests
   - not already selected/claimed in a prior raffle
3. Other events preserve attendee_type.raffle_eligible behavior.

Authorized manual gate check-in remains a valid fallback for an attendee
who originally registered online. Manual event-day registration sources
(manual_ticket and walk_in) remain excluded from this Fun Walk raffle.
*/

create or replace function public.event_raffle_eligible_attendees_v2(
  p_event_slug text
)
returns table (
  attendee_id uuid,
  full_name text,
  group_value text,
  registration_number text,
  registration_source text,
  attendance_status text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    a.id as attendee_id,
    a.full_name,
    a.group_value,
    a.registration_number,
    a.registration_source,
    a.attendance_status
  from public.events e
  join public.event_attendees a
    on a.event_id = e.id
  join public.event_attendee_types t
    on t.id = a.attendee_type_id
  where e.slug = p_event_slug
    and a.registration_status = 'registered'
    and a.attendance_status = 'checked_in'
    and a.checked_in_at is not null
    and coalesce(a.is_disqualified, false) = false
    and a.merged_into is null
    and (
      (
        e.slug = 'dbhs-batch-2001-fun-run-2026'
        and a.registration_source = 'online'
      )
      or
      (
        e.slug <> 'dbhs-batch-2001-fun-run-2026'
        and coalesce(t.raffle_eligible, false) = true
      )
    )
    and not exists (
      select 1
      from public.event_raffle_winners w
      where w.event_id = e.id
        and w.attendee_id = a.id
        and w.status in ('selected', 'claimed')
    );
$function$;

revoke all on function public.event_raffle_eligible_attendees_v2(text)
  from public;
grant execute on function public.event_raffle_eligible_attendees_v2(text)
  to service_role;

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

  perform pg_advisory_xact_lock(
    hashtext(v_event_id::text)::bigint
  );

  if exists (
    select 1
    from public.event_raffle_draws
    where event_id = v_event_id
      and status in ('rolling', 'winner_selected')
  ) then
    raise exception 'An active raffle draw already exists';
  end if;

  select
    eligible.attendee_id,
    eligible.full_name,
    eligible.group_value,
    eligible.registration_number
  into v_attendee
  from public.event_raffle_eligible_attendees_v2(
    p_event_slug
  ) eligible
  order by gen_random_uuid()
  limit 1;

  if v_attendee.attendee_id is null then
    raise exception 'No eligible raffle attendees found';
  end if;

  v_reveal_at :=
    now() + make_interval(secs => p_roll_seconds);
  v_claim_deadline_at :=
    v_reveal_at +
    make_interval(secs => p_claim_seconds);

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
    v_attendee.attendee_id,
    'selected',
    v_claim_deadline_at,
    now()
  )
  returning id into v_winner_id;

  return query
  select
    v_draw_id,
    v_winner_id,
    v_attendee.attendee_id,
    v_attendee.full_name,
    v_attendee.group_value,
    v_attendee.registration_number,
    v_reveal_at,
    v_claim_deadline_at;
end;
$function$;

revoke all on function public.event_start_raffle_draw(
  text, text, text, integer, integer
) from public;
grant execute on function public.event_start_raffle_draw(
  text, text, text, integer, integer
) to service_role;