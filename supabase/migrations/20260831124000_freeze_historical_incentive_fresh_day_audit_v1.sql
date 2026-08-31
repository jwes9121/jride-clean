-- Freeze the closed Week 3 / Shirt attempt 1 fresh-day correction rows.
-- The live historical audit was being re-evaluated thousands of times inside
-- current incentive claimability queries and caused PostgREST statement timeout.
-- These correction windows both closed on 2026-08-16, so preserve their exact
-- results in an indexed snapshot while keeping the same compatibility view name.

create table public.driver_incentive_fresh_day_cycle_audit_snapshot_v1 as
select *
from public.driver_incentive_fresh_day_cycle_audit_v1;

create unique index driver_incentive_fresh_day_audit_snapshot_uidx
  on public.driver_incentive_fresh_day_cycle_audit_snapshot_v1
  (driver_id, policy_code, cycle_number);

alter table public.driver_incentive_fresh_day_cycle_audit_snapshot_v1 enable row level security;

comment on table public.driver_incentive_fresh_day_cycle_audit_snapshot_v1 is
  'Frozen historical fresh-day correction rows for WEEKLY cycle 3 and SHIRT cycle 1, both closed 2026-08-16. Prevents expensive historical recomputation in future incentive award queries.';

create or replace view public.driver_incentive_fresh_day_cycle_audit_v1 as
select *
from public.driver_incentive_fresh_day_cycle_audit_snapshot_v1;
