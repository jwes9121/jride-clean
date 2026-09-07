insert into public.analytics_test_identities (
  entity_type,
  entity_id,
  label,
  reason,
  active,
  updated_at
)
select
  'driver',
  d.id,
  d.driver_name,
  'Verified JRide test or demo driver',
  true,
  now()
from public.drivers d
where d.driver_name in (
  'TEST DRIVER 0001',
  'TESTER DRIVER JR',
  '[ARCHIVED] DEMO DRIVER'
)
on conflict (entity_type, entity_id)
do update set
  label = excluded.label,
  reason = excluded.reason,
  active = excluded.active,
  updated_at = now();

insert into public.analytics_test_identities (
  entity_type,
  entity_id,
  label,
  reason,
  active,
  updated_at
)
select
  'passenger',
  u.id,
  u.raw_user_meta_data ->> 'full_name',
  'Verified Auth passenger test identity',
  true,
  now()
from auth.users u
where u.raw_user_meta_data ->> 'role' = 'passenger'
  and u.raw_user_meta_data ->> 'full_name' in (
    'Test Book Lamut',
    'Jride Test',
    'Test User',
    'Lamut Tester'
  )
on conflict (entity_type, entity_id)
do update set
  label = excluded.label,
  reason = excluded.reason,
  active = excluded.active,
  updated_at = now();
