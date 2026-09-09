-- Contact records are employee reports; subsequent presence is independent evidence.
-- No SMS, push notification, driver status, assignment or schedule is changed.
set lock_timeout = '3s';
set statement_timeout = '30s';

create table public.operations_shift_outreach (
  request_id uuid primary key,
  day date not null,
  duty text not null,
  driver_id uuid not null,
  driver_name text not null,
  town text not null,
  actor_id text not null,
  actor_email text not null,
  channel text not null check (channel in ('call','message','in_person')),
  outcome text not null check (outcome in ('no_answer','will_go_online','unavailable_today','needs_help','reminded')),
  note text not null check (length(trim(note)) between 8 and 500),
  signal_at_contact text not null,
  last_seen_at_contact timestamptz,
  previous_contact_id uuid,
  recorded_at timestamptz not null default clock_timestamp(),
  foreign key(day,duty) references public.operations_shift_runs(day,duty)
);
create index operations_shift_outreach_driver_day_idx
  on public.operations_shift_outreach(day,driver_id,recorded_at desc,request_id);
create index operations_shift_outreach_shift_idx on public.operations_shift_outreach(day,duty,recorded_at);
alter table public.operations_shift_outreach enable row level security;
revoke all on public.operations_shift_outreach from public,anon,authenticated;
grant select,insert on public.operations_shift_outreach to service_role;

create function public.operations_shift_outreach_roster_v1()
returns table(driver_id uuid, name text, phone text, town text, signal text,
  last_seen_at timestamptz, needs_wallet_help boolean)
language sql stable security invoker set search_path = public, pg_temp as $$
  select d.id,coalesce(nullif(d.driver_name,''),nullif(p.full_name,''),'Unnamed driver'),
    nullif(trim(p.phone),''),coalesce(nullif(trim(p.municipality),''),nullif(trim(l.home_town),''),'Unknown'),
    case
      when exists(select 1 from bookings b where coalesce(b.assigned_driver_id,b.driver_id)=d.id
        and lower(coalesce(b.status,'')) not in ('completed','cancelled','canceled')) then 'on_trip'
      when l.updated_at is null then 'not_recorded'
      when l.updated_at < statement_timestamp()-interval '120 seconds' or l.updated_at > statement_timestamp() then 'stale'
      when lower(trim(l.status)) in ('online','available','idle','waiting') then 'online'
      when lower(trim(l.status)) in ('busy','on_trip','on-trip','in_trip') then 'on_trip'
      when lower(trim(l.status))='offline' then 'offline'
      else 'unknown'
    end,l.updated_at,
    coalesce(d.wallet_locked,false) or (d.wallet_balance is not null and d.min_wallet_required is not null and d.wallet_balance<d.min_wallet_required)
  from drivers d
  left join lateral (select full_name,phone,municipality from driver_profiles where driver_id=d.id limit 1) p on true
  left join lateral (select status,updated_at,home_town from driver_locations where driver_id=d.id order by updated_at desc nulls last,id desc limit 1) l on true
  where lower(trim(coalesce(d.driver_status,''))) not in ('deactivated','deleted','removed','removed_from_pilot','inactive','terminated','pending','suspended')
    and lower(trim(coalesce(d.roster_status,''))) not in ('deactivated','deleted','removed','removed_from_pilot','inactive','terminated','pending','suspended')
    and d.id not in ('d41bf199-96c6-4022-8a3d-09ab9dbd270f','5b9c3a17-7c5e-45fd-93ab-1f8f2a6d3c72',
      '00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002')
    and not exists(select 1 from analytics_test_identities t where t.active and t.entity_type='driver' and t.entity_id=d.id)
    and coalesce(d.driver_name,'') !~* '\m(test|tester|dummy|sample)\s+driver\M|\mdriver\s+(test|tester)\M'
    and coalesce(p.full_name,'') !~* '\m(test|tester|dummy|sample)\s+driver\M|\mdriver\s+(test|tester)\M'
    and lower(coalesce(nullif(trim(p.municipality),''),nullif(trim(l.home_town),''),'')) in ('lagawe','hingyon','banaue','lamut')
$$;
revoke all on function public.operations_shift_outreach_roster_v1() from public,anon,authenticated;
grant execute on function public.operations_shift_outreach_roster_v1() to service_role;

create function public.operations_shift_outreach_read_v1(p_email text,p_admin boolean,p_day date,p_duty text)
returns jsonb language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare catalog jsonb; begins timestamptz; ends timestamptz; live boolean; contacts jsonb; candidates jsonb;
begin
  catalog := operations_shift_catalog_v1(p_email,p_admin);
  if p_day is null or p_duty is null or p_duty not in ('primary','evening') or p_day<date '2026-09-08'
    or p_day>(statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Choose a valid shift.' using errcode='22023'; end if;
  if not p_admin and not exists(select 1 from jsonb_array_elements(catalog->'shifts') x
    where x->>'day'=p_day::text and x->>'duty'=p_duty) then
    raise exception 'You may view only your assigned or covered shifts.' using errcode='42501'; end if;
  begins := (p_day+case p_duty when 'primary' then time '10:00' else time '15:00' end) at time zone 'Asia/Manila';
  ends := (p_day+case p_duty when 'primary' then time '15:00' else time '19:00' end) at time zone 'Asia/Manila';
  live := statement_timestamp()>=begins and statement_timestamp()<ends;
  select coalesce(jsonb_agg(to_jsonb(a)||jsonb_build_object('online_after_contact_at',online.at)
    order by a.recorded_at desc,a.request_id),'[]'::jsonb) into contacts
  from operations_shift_outreach a
  left join lateral (
    -- Start of the next observed minute avoids crediting the pre-contact part of a bucket.
    select min(m.minute_started_at) as at from driver_presence_minutes m
    where m.driver_id=a.driver_id and m.minute_started_at>a.recorded_at
      and m.minute_started_at<least(ends,statement_timestamp())
  ) online on true where a.day=p_day and a.duty=p_duty;
  select coalesce(jsonb_agg(to_jsonb(d)||jsonb_build_object('last_contact',case when c.request_id is null then null else to_jsonb(c) end)
    order by d.needs_wallet_help desc,d.town,d.name,d.driver_id),'[]'::jsonb) into candidates
  from operations_shift_outreach_roster_v1() d
  left join lateral (select request_id,outcome,note,actor_id,recorded_at,duty from operations_shift_outreach
    where day=p_day and driver_id=d.driver_id order by recorded_at desc,request_id desc limit 1) c on true
  where live and d.signal not in ('online','on_trip');
  return jsonb_build_object('live',live,'server_time',statement_timestamp(),'candidates',candidates,'contacts',contacts,
    'basis','Live follow-up list, not historical proof of offline duration. Online after contact means a later observed minute within this shift; it does not prove the reminder caused the return.');
end $$;
revoke all on function public.operations_shift_outreach_read_v1(text,boolean,date,text) from public,anon,authenticated;
grant execute on function public.operations_shift_outreach_read_v1(text,boolean,date,text) to service_role;

create function public.operations_shift_outreach_apply_v1(p_email text,p_admin boolean,p_day date,p_duty text,
  p_driver uuid,p_channel text,p_outcome text,p_note text,p_request uuid,p_previous uuid)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare s jsonb; me text; r operations_shift_runs%rowtype; prior operations_shift_outreach%rowtype;
  last_contact operations_shift_outreach%rowtype; d record; begins timestamptz; ends timestamptz;
  n timestamptz := clock_timestamp(); note_text text := trim(coalesce(p_note,''));
begin
  if p_email is null or trim(p_email)='' or p_admin is null or p_day is null or p_duty is null
    or p_duty not in ('primary','evening') or p_driver is null or p_request is null
    or p_channel is null or p_channel not in ('call','message','in_person')
    or p_outcome is null or p_outcome not in ('no_answer','will_go_online','unavailable_today','needs_help','reminded')
    or length(note_text)<8 or length(note_text)>500 or note_text ~ '[^\x20-\x7e\r\n]' then
    raise exception 'Choose the contact method, outcome and a brief note.' using errcode='22023'; end if;
  select state into strict s from operations_schedule_state where id=1 for share;
  if p_admin then me := 'admin:'||lower(trim(p_email));
  else select e->>'id' into me from jsonb_array_elements(s->'employees') e where lower(e->>'email')=lower(trim(p_email)); end if;
  if me is null then raise exception 'Coordinator identity is not linked.' using errcode='42501'; end if;
  -- Serialize against takeover and coverage before checking the monitor.
  select * into r from operations_shift_runs where day=p_day and duty=p_duty for update;
  select * into prior from operations_shift_outreach where request_id=p_request;
  if found then
    if prior.actor_id<>me or prior.day<>p_day or prior.duty<>p_duty or prior.driver_id<>p_driver
      or prior.channel<>p_channel or prior.outcome<>p_outcome or prior.note<>note_text
      or prior.previous_contact_id is distinct from p_previous then
      raise exception 'Request identifier already belongs to another action.' using errcode='23505'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  begins := (p_day+case p_duty when 'primary' then time '10:00' else time '15:00' end) at time zone 'Asia/Manila';
  ends := (p_day+case p_duty when 'primary' then time '15:00' else time '19:00' end) at time zone 'Asia/Manila';
  if n<begins or n>=ends then raise exception 'Driver reminders can be logged only during the live shift.' using errcode='22023'; end if;
  if r.monitor_id is null or me is distinct from r.monitor_id or (not p_admin and s->'rests'->>p_day::text=me) then
    raise exception 'Only the acknowledged duty monitor can record outreach.' using errcode='42501'; end if;
  select * into last_contact from operations_shift_outreach where day=p_day and driver_id=p_driver
    order by recorded_at desc,request_id desc limit 1;
  if last_contact.request_id is distinct from p_previous then
    raise exception 'Another contact was recorded. Refresh before contacting this driver again.' using errcode='40001'; end if;
  if last_contact.outcome='unavailable_today' then
    raise exception 'This driver already reported unavailable today. Do not send another online reminder.' using errcode='22023'; end if;
  select * into d from operations_shift_outreach_roster_v1() where driver_id=p_driver;
  if not found then raise exception 'Driver is no longer in the eligible outreach roster.' using errcode='22023'; end if;
  if d.signal in ('online','on_trip') then
    raise exception 'Driver is now online or on a trip. Refresh; an offline reminder is no longer needed.' using errcode='40001'; end if;
  insert into operations_shift_outreach(request_id,day,duty,driver_id,driver_name,town,actor_id,actor_email,
    channel,outcome,note,signal_at_contact,last_seen_at_contact,previous_contact_id,recorded_at)
  values(p_request,p_day,p_duty,p_driver,d.name,d.town,me,lower(trim(p_email)),p_channel,p_outcome,note_text,
    d.signal,d.last_seen_at,p_previous,n);
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.operations_shift_outreach_apply_v1(text,boolean,date,text,uuid,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.operations_shift_outreach_apply_v1(text,boolean,date,text,uuid,text,text,text,uuid,uuid) to service_role;

-- Audit records should not be rewritten by the web application.
revoke update,delete on public.operations_shift_actions,public.operations_shift_booking_history from service_role;
