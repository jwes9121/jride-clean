-- JRIDE_DRIVER_STANDBY_CANCEL_ON_DUTY_EXIT_V1
-- An explicit Standby Location belongs only to the current online waiting session.
-- Leaving normal online duty cancels any still-active standby confirmation so an
-- Offline -> Online (or Walk-in -> Online) cycle always requires a new confirmation.
-- This trigger never writes driver_locations coordinates or updated_at.

create or replace function public.jride_cancel_driver_standby_on_duty_exit_v1()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if lower(btrim(coalesce(new.status, ''))) not in (
    'online',
    'available',
    'idle',
    'waiting'
  ) then
    update public.driver_standby_sessions
       set cancelled_at = now(),
           cancel_reason = 'duty_left_online',
           updated_at = now()
     where driver_id = new.driver_id
       and consumed_at is null
       and cancelled_at is null
       and expires_at > now();
  end if;

  return new;
end;
$$;

drop trigger if exists driver_locations_cancel_standby_on_duty_exit_v1
  on public.driver_locations;

create trigger driver_locations_cancel_standby_on_duty_exit_v1
after insert or update of status
on public.driver_locations
for each row
execute function public.jride_cancel_driver_standby_on_duty_exit_v1();

comment on function public.jride_cancel_driver_standby_on_duty_exit_v1() is
  'Cancels an active Standby Location whenever driver duty leaves normal online waiting states. Does not alter live GPS.';
