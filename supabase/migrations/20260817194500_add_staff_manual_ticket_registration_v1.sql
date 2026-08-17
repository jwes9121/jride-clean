alter table public.event_attendees
drop constraint if exists event_attendees_registration_source_check;

alter table public.event_attendees
add constraint event_attendees_registration_source_check
check (
  registration_source = any (
    array[
      'online'::text,
      'jride_login'::text,
      'assisted'::text,
      'walk_in'::text,
      'manual_ticket'::text
    ]
  )
);
create or replace function public.claim_staff_event_ticket_and_register_v1(
  p_event_slug text,
  p_ticket_number text,
  p_claim_code text,
  p_full_name text,
  p_mobile_number text,
  p_nickname text,
  p_group_value text,
  p_client_key_hash text
)
returns table(
  success boolean,
  result_code text,
  message text,
  event_id uuid,
  ticket_id uuid,
  ticket_number text,
  attendee_id uuid,
  registration_number text,
  qr_token text,
  package_name text,
  ticket_price numeric,
  group_value text,
  registration_source text,
  checked_in_at timestamptz
)
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_event_id uuid;
  v_group_value text := lower(btrim(coalesce(p_group_value, '')));
  v_claim record;
  v_now timestamptz := now();
  v_checked_in_at timestamptz;
begin
  select e.id
  into v_event_id
  from public.events e
  where e.slug = btrim(coalesce(p_event_slug, ''));

  if v_event_id is null then
    return query
    select false, 'EVENT_NOT_FOUND', 'Event was not found.', null::uuid,
      null::uuid, null::text, null::uuid, null::text, null::text,
      null::text, null::numeric, null::text, null::text, null::timestamptz;
    return;
  end if;

  if v_group_value = '' or not exists (
    select 1
    from public.event_group_values gv
    where gv.event_id = v_event_id
      and lower(btrim(gv.value)) = v_group_value
  ) then
    return query
    select false, 'INVALID_GROUP_VALUE', 'Select a valid registration category.', v_event_id,
      null::uuid, null::text, null::uuid, null::text, null::text,
      null::text, null::numeric, null::text, null::text, null::timestamptz;
    return;
  end if;

  select *
  into v_claim
  from public.claim_event_ticket_and_register(
    p_event_slug,
    p_ticket_number,
    p_claim_code,
    p_full_name,
    p_mobile_number,
    p_nickname,
    p_client_key_hash
  );

  if v_claim is null then
    raise exception 'Ticket registration returned no result.';
  end if;

  if coalesce(v_claim.success, false) = false then
    return query
    select v_claim.success, v_claim.result_code, v_claim.message,
      v_claim.event_id, v_claim.ticket_id, v_claim.ticket_number,
      v_claim.attendee_id, v_claim.registration_number, v_claim.qr_token,
      v_claim.package_name, v_claim.ticket_price,
      null::text, null::text, null::timestamptz;
    return;
  end if;

  update public.event_attendees a
  set
    group_value = v_group_value,
    registration_source = 'manual_ticket',
    attendance_status = 'checked_in',
    checked_in_at = v_now,
    updated_at = v_now
  where a.id = v_claim.attendee_id
    and a.event_id = v_event_id
  returning a.checked_in_at into v_checked_in_at;

  if not found then
    raise exception 'Manual ticket attendee update failed.';
  end if;

  return query
  select true, 'CLAIMED',
    'Manual ticket registration completed and attendance was checked in.',
    v_claim.event_id, v_claim.ticket_id, v_claim.ticket_number,
    v_claim.attendee_id, v_claim.registration_number, v_claim.qr_token,
    v_claim.package_name, v_claim.ticket_price,
    v_group_value, 'manual_ticket'::text, v_checked_in_at;
end;
$$;

revoke all on function public.claim_staff_event_ticket_and_register_v1(
  text,text,text,text,text,text,text,text
) from public;

revoke all on function public.claim_staff_event_ticket_and_register_v1(
  text,text,text,text,text,text,text,text
) from anon;

revoke all on function public.claim_staff_event_ticket_and_register_v1(
  text,text,text,text,text,text,text,text
) from authenticated;

grant execute on function public.claim_staff_event_ticket_and_register_v1(
  text,text,text,text,text,text,text,text
) to service_role;