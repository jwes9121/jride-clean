/*
JRide Events Platform
Feature: EVT-003
Purpose: Adds concurrency-safe registration number generation.
Rollback:
  drop function if exists public.next_event_registration_number(uuid);
*/

create or replace function public.next_event_registration_number(p_event_id uuid)
returns table(reg_sequence integer, registration_number text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_prefix text;
  v_next integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  select e.reg_prefix
    into v_prefix
  from public.events e
  where e.id = p_event_id;

  if v_prefix is null or length(trim(v_prefix)) = 0 then
    raise exception 'Missing registration prefix for event %', p_event_id;
  end if;

  select coalesce(max(a.reg_sequence), 0) + 1
    into v_next
  from public.event_attendees a
  where a.event_id = p_event_id;

  reg_sequence := v_next;
  registration_number := v_prefix || '-' || lpad(v_next::text, 6, '0');

  return next;
end;
$$;