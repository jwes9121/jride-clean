/*
JRide Events Platform
Feature: EVT-003
Purpose: Adds human-readable registration numbers for attendee operations.
Rollback:
  drop index if exists public.uq_event_attendees_registration_number;
  drop index if exists public.uq_event_attendees_event_reg_sequence;
  alter table public.event_attendees drop column if exists registration_number;
  alter table public.event_attendees drop column if exists reg_sequence;
  alter table public.events drop column if exists reg_prefix;
*/

alter table public.events
add column if not exists reg_prefix text not null default '';

alter table public.event_attendees
add column if not exists reg_sequence integer;

alter table public.event_attendees
add column if not exists registration_number text;

create unique index if not exists uq_event_attendees_event_reg_sequence
on public.event_attendees(event_id, reg_sequence)
where reg_sequence is not null;

create unique index if not exists uq_event_attendees_registration_number
on public.event_attendees(registration_number)
where registration_number is not null;

update public.events
set reg_prefix = 'DBHS26'
where slug = 'dbhs-2026'
  and reg_prefix = '';
