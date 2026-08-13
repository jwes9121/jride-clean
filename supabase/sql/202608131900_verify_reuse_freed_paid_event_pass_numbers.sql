with target_event as (
  select id from public.events
  where slug = 'dbhs-batch-2001-fun-run-2026'
  limit 1
),
freed(pass_number) as (
  values
    ('B2FR-000017'),
    ('B2FR-000018'),
    ('B2FR-000019'),
    ('B2FR-000020'),
    ('B2FR-000021'),
    ('B2FR-000022'),
    ('B2FR-000024')
)
select
  f.pass_number,
  case when ea.id is null then 'AVAILABLE' else 'IN_USE' end as status,
  ea.full_name,
  ea.group_value
from freed f
left join public.event_attendees ea
  on ea.event_id = (select id from target_event)
 and ea.registration_number = f.pass_number
order by f.pass_number;

select
  p.proname,
  position('next_paid_event_registration_number' in pg_get_functiondef(p.oid)) > 0
    as uses_paid_allocator,
  position('from public.next_event_registration_number(v_event.id) n;' in pg_get_functiondef(p.oid)) = 0
    as old_allocator_call_removed
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'claim_event_ticket_and_register',
    'claim_public_ticketed_party_and_register'
  )
order by p.proname;

select *
from public.next_paid_event_registration_number(
  (
    select id
    from public.events
    where slug = 'dbhs-batch-2001-fun-run-2026'
    limit 1
  )
);

select
  ea.registration_number,
  ea.reg_sequence,
  ea.full_name,
  et.ticket_number,
  et.ticket_type,
  et.status as ticket_status
from public.event_attendees ea
join public.events e on e.id = ea.event_id
join public.event_tickets et
  on et.event_id = ea.event_id
 and et.claimed_attendee_id = ea.id
where e.slug = 'dbhs-batch-2001-fun-run-2026'
  and ea.id in (
    'a25302e2-46a4-40f4-bfdd-94808da7e8d7'::uuid,
    'e25e075d-d200-4d7b-845d-f0cd1e8d34a9'::uuid
  )
order by ea.reg_sequence;
