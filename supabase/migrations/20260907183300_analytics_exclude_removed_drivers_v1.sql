comment on table public.analytics_test_identities is
  'Role-scoped identities excluded from production analytics. Includes verified test identities and driver lifecycle exclusions; driver and passenger UUID namespaces remain separate.';

create or replace function public.jride_sync_driver_analytics_exclusion_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_hidden boolean;
  v_reason text;
begin
  v_hidden := lower(coalesce(new.driver_status, '')) in (
      'deactivated','inactive','terminated','deleted','removed','removed_from_pilot','pending'
    )
    or lower(coalesce(new.roster_status, '')) in (
      'deactivated','inactive','terminated','deleted','removed','removed_from_pilot','pending'
    );

  if v_hidden then
    v_reason := 'Driver lifecycle exclusion: ' ||
      coalesce(nullif(lower(trim(new.roster_status)), ''), nullif(lower(trim(new.driver_status)), ''), 'removed');

    insert into public.analytics_test_identities (
      entity_type, entity_id, label, reason, active, updated_at
    )
    values (
      'driver', new.id, new.driver_name, v_reason, true, now()
    )
    on conflict (entity_type, entity_id)
    do update set
      label = coalesce(excluded.label, public.analytics_test_identities.label),
      reason = case
        when public.analytics_test_identities.reason like 'Driver lifecycle exclusion:%'
          then excluded.reason
        else public.analytics_test_identities.reason
      end,
      active = true,
      updated_at = now();
  else
    update public.analytics_test_identities
       set active = false,
           updated_at = now()
     where entity_type = 'driver'
       and entity_id = new.id
       and reason like 'Driver lifecycle exclusion:%';
  end if;

  return new;
end;
$function$;

drop trigger if exists drivers_sync_analytics_exclusion_v1 on public.drivers;
create trigger drivers_sync_analytics_exclusion_v1
after insert or update of driver_status, roster_status, driver_name
on public.drivers
for each row
execute function public.jride_sync_driver_analytics_exclusion_v1();

insert into public.analytics_test_identities (
  entity_type, entity_id, label, reason, active, updated_at
)
select
  'driver',
  d.id,
  d.driver_name,
  'Driver lifecycle exclusion: ' ||
    coalesce(nullif(lower(trim(d.roster_status)), ''), nullif(lower(trim(d.driver_status)), ''), 'removed'),
  true,
  now()
from public.drivers d
where lower(coalesce(d.driver_status, '')) in (
    'deactivated','inactive','terminated','deleted','removed','removed_from_pilot','pending'
  )
   or lower(coalesce(d.roster_status, '')) in (
    'deactivated','inactive','terminated','deleted','removed','removed_from_pilot','pending'
  )
on conflict (entity_type, entity_id)
do update set
  label = coalesce(excluded.label, public.analytics_test_identities.label),
  reason = case
    when public.analytics_test_identities.reason like 'Driver lifecycle exclusion:%'
      then excluded.reason
    else public.analytics_test_identities.reason
  end,
  active = true,
  updated_at = now();
