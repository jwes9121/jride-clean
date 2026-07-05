/*
JRide Events Platform
Feature: EVT-006
Purpose: Adds scanner audit field for event check-ins.
Rollback:
  alter table public.event_attendees drop column if exists checked_in_by;
*/

alter table public.event_attendees
add column if not exists checked_in_by uuid;