begin;

create or replace function public.next_paid_event_registration_number(
  p_event_id uuid
)
returns table(reg_sequence integer, registration_number text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_event_slug text;
  v_prefix text;
  v_reusable_suffix integer;
begin
  select n.reg_sequence, n.registration_number
    into reg_sequence, registration_number
  from public.next_event_registration_number(p_event_id) n;

  select e.slug, e.reg_prefix
    into v_event_slug, v_prefix
  from public.events e
  where e.id = p_event_id;

  if v_event_slug <> 'dbhs-batch-2001-fun-run-2026' then
    return next;
    return;
  end if;

  if coalesce(btrim(v_prefix), '') <> 'B2FR' then
    raise exception 'Unexpected registration prefix for target event: %',
      coalesce(v_prefix, '<null>');
  end if;

  select candidate.suffix
    into v_reusable_suffix
  from unnest(array[17,18,19,20,21,22,24]::integer[]) as candidate(suffix)
  where not exists (
    select 1
    from public.event_attendees a
    where a.event_id = p_event_id
      and a.registration_number =
        v_prefix || '-' || lpad(candidate.suffix::text, 6, '0')
  )
  order by candidate.suffix
  limit 1;

  if v_reusable_suffix is not null then
    registration_number :=
      v_prefix || '-' || lpad(v_reusable_suffix::text, 6, '0');
  end if;

  return next;
end;
$function$;

do $patch$
declare
  v_single_oid oid;
  v_party_oid oid;
  v_def text;
  v_old text := 'from public.next_event_registration_number(v_event.id) n;';
  v_new text := 'from public.next_paid_event_registration_number(v_event.id) n;';
  v_count integer;
begin
  v_single_oid :=
    'public.claim_event_ticket_and_register(text,text,text,text,text,text,text)'::regprocedure::oid;
  v_party_oid :=
    'public.claim_public_ticketed_party_and_register(text,text,text,text,text,text,jsonb,text)'::regprocedure::oid;

  v_def := pg_get_functiondef(v_single_oid);
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'claim_event_ticket_and_register patch anchor count %, expected 1', v_count;
  end if;
  execute replace(v_def, v_old, v_new);

  v_def := pg_get_functiondef(v_party_oid);
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception 'claim_public_ticketed_party_and_register patch anchor count %, expected 1', v_count;
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

do $verify$
declare
  v_event_id uuid;
  v_paid_ok integer;
begin
  select id into v_event_id
  from public.events
  where slug = 'dbhs-batch-2001-fun-run-2026'
  limit 1;

  select count(*) into v_paid_ok
  from public.event_attendees ea
  join public.event_tickets et
    on et.event_id = ea.event_id
   and et.claimed_attendee_id = ea.id
  where ea.event_id = v_event_id
    and (
      (
        ea.id = 'a25302e2-46a4-40f4-bfdd-94808da7e8d7'::uuid
        and ea.registration_number = 'B2FR-000023'
        and ea.reg_sequence = 23
        and et.ticket_number = 'FR-021'
        and et.status = 'claimed'
      )
      or
      (
        ea.id = 'e25e075d-d200-4d7b-845d-f0cd1e8d34a9'::uuid
        and ea.registration_number = 'B2FR-000025'
        and ea.reg_sequence = 25
        and et.ticket_number = 'FR-171'
        and et.status = 'claimed'
      )
    );

  if v_paid_ok <> 2 then
    raise exception 'Existing paid registration safety check failed: expected 2 exact rows, found %', v_paid_ok;
  end if;
end;
$verify$;

commit;
