-- JRide Duty Check v2 driver capability signal
-- Date: 2026-08-11
--
-- Stores capability against the currently active driver device lock.
-- Existing/old APKs default to duty_check_v2_capable = false.
-- Normal Admin Duty Check sending remains lifecycle v1 in this phase.

begin;

alter table public.driver_device_locks
  add column if not exists client_version_name text,
  add column if not exists client_version_code bigint,
  add column if not exists duty_check_v2_capable boolean not null default false,
  add column if not exists capability_last_seen_at timestamptz;

do $constraint$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_device_locks_client_version_name_chk'
  ) then
    alter table public.driver_device_locks
      add constraint driver_device_locks_client_version_name_chk
      check (
        client_version_name is null
        or length(client_version_name) <= 64
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'driver_device_locks_client_version_code_chk'
  ) then
    alter table public.driver_device_locks
      add constraint driver_device_locks_client_version_code_chk
      check (
        client_version_code is null
        or client_version_code >= 0
      ) not valid;
  end if;
end
$constraint$;

alter table public.driver_device_locks
  validate constraint driver_device_locks_client_version_name_chk;

alter table public.driver_device_locks
  validate constraint driver_device_locks_client_version_code_chk;

comment on column public.driver_device_locks.client_version_name is
  'Version name last reported by the currently active driver app/device.';

comment on column public.driver_device_locks.client_version_code is
  'Version code last reported by the currently active driver app/device.';

comment on column public.driver_device_locks.duty_check_v2_capable is
  'Explicit active-device capability gate. Missing capability reports must be stored as false.';

comment on column public.driver_device_locks.capability_last_seen_at is
  'Server time when the active device capability state was last evaluated from a driver ping.';

-- Existing rows automatically receive false from the NOT NULL default.
-- Do not rewrite capability metadata here; this keeps the migration safe to rerun
-- after later Android rollout work.

commit;