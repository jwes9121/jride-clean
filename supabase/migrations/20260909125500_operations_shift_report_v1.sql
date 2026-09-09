-- Additive reporting only. Does not change bookings, schedules, incentives or GPS.
-- All RPCs are service-role-only; the Next.js route supplies the authenticated actor.
set lock_timeout = '3s';
set statement_timeout = '30s';

create table public.operations_shift_config (
  id integer primary key check (id = 1),
  tracking_started_at timestamptz not null default transaction_timestamp()
);
insert into public.operations_shift_config (id) values (1);

create table public.operations_shift_booking_history (
  id bigint generated always as identity primary key,
  booking_id uuid not null,
  observed_at timestamptz not null default clock_timestamp(),
  operation text not null check (operation in ('baseline','insert','change','delete')),
  status_before text,
  status_after text,
  service_type text,
  town text,
  driver_id uuid,
  passenger_id uuid,
  driver_status text,
  vendor_status text,
  booking_code text,
  booked_at timestamptz,
  completed_at timestamptz,
  cancel_reason text
);
create index operations_shift_history_booking_time_idx
  on public.operations_shift_booking_history (booking_id, observed_at desc, id desc);
create index operations_shift_history_time_idx on public.operations_shift_booking_history (observed_at);

create function public.operations_shift_observe_booking_v1()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare b public.bookings%rowtype;
begin
  if tg_op = 'UPDATE' then
    if row(old.status,old.driver_status,old.vendor_status,old.assigned_driver_id,old.driver_id,
           old.completed_at,old.cancel_reason,old.vendor_cancel_reason,old.town,old.service_type)
       is not distinct from
       row(new.status,new.driver_status,new.vendor_status,new.assigned_driver_id,new.driver_id,
           new.completed_at,new.cancel_reason,new.vendor_cancel_reason,new.town,new.service_type)
    then return new; end if;
  end if;
  if tg_op = 'DELETE' then b := old; else b := new; end if;
  insert into public.operations_shift_booking_history
    (booking_id,operation,status_before,status_after,service_type,town,driver_id,passenger_id,
     driver_status,vendor_status,booking_code,booked_at,completed_at,cancel_reason)
  values (b.id,case tg_op when 'INSERT' then 'insert' when 'DELETE' then 'delete' else 'change' end,
    case when tg_op = 'INSERT' then null else old.status end,b.status,b.service_type,b.town,
    coalesce(b.assigned_driver_id,b.driver_id),b.created_by_user_id,b.driver_status,b.vendor_status,
    b.booking_code,b.created_at,b.completed_at,coalesce(nullif(b.cancel_reason,''),nullif(b.vendor_cancel_reason,'')));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.operations_shift_observe_booking_v1() from public, anon, authenticated;
create trigger operations_shift_observe_booking_v1
  after insert or update or delete on public.bookings
  for each row execute function public.operations_shift_observe_booking_v1();

-- These are observations at rollout, NOT fabricated historical transitions.
insert into public.operations_shift_booking_history
  (booking_id,observed_at,operation,status_after,service_type,town,driver_id,passenger_id,
   driver_status,vendor_status,booking_code,booked_at,completed_at,cancel_reason)
select id,transaction_timestamp(),'baseline',status,service_type,town,
  coalesce(assigned_driver_id,driver_id),created_by_user_id,driver_status,vendor_status,
  booking_code,created_at,completed_at,coalesce(nullif(cancel_reason,''),nullif(vendor_cancel_reason,''))
from public.bookings;

create table public.operations_shift_runs (
  day date not null,
  duty text not null check (duty in ('primary','evening')),
  version integer not null default 0,
  scheduled_owner text,
  monitor_id text,
  acknowledged_at timestamptz,
  first_ack_id text,
  cover_to text,
  cover_reason text,
  created_at timestamptz not null default clock_timestamp(),
  primary key (day,duty)
);
create table public.operations_shift_cases (
  booking_id uuid primary key,
  issue_open boolean not null default false,
  raised_at timestamptz,
  issue_ack_at timestamptz,
  resolved_at timestamptz,
  issue_note text,
  handover_pending boolean not null default false,
  handover_note text,
  last_reviewed_at timestamptz,
  last_monitor_id text,
  last_day date,
  last_duty text
);
create table public.operations_shift_actions (
  id bigint generated always as identity primary key,
  request_id uuid not null unique,
  day date not null,
  duty text not null,
  actor_id text not null,
  actor_email text not null,
  action text not null,
  booking_id uuid,
  note text not null default '',
  target text,
  recorded_at timestamptz not null default clock_timestamp(),
  details jsonb not null default '{}'::jsonb,
  foreign key (day,duty) references public.operations_shift_runs(day,duty)
);
create index operations_shift_actions_window_idx on public.operations_shift_actions(day,duty,recorded_at,id);
create index operations_shift_actions_actor_idx on public.operations_shift_actions(actor_email,day,duty);
create index operations_shift_actions_booking_idx on public.operations_shift_actions(booking_id,recorded_at);

alter table public.operations_shift_config enable row level security;
alter table public.operations_shift_booking_history enable row level security;
alter table public.operations_shift_runs enable row level security;
alter table public.operations_shift_cases enable row level security;
alter table public.operations_shift_actions enable row level security;
revoke all on public.operations_shift_config,public.operations_shift_booking_history,
  public.operations_shift_runs,public.operations_shift_cases,public.operations_shift_actions
  from public,anon,authenticated;
grant select,insert,update,delete on public.operations_shift_config,public.operations_shift_booking_history,
  public.operations_shift_runs,public.operations_shift_cases,public.operations_shift_actions to service_role;
grant usage,select on sequence public.operations_shift_booking_history_id_seq,public.operations_shift_actions_id_seq to service_role;

create function public.operations_shift_presence_v1(p_start timestamptz,p_end timestamptz)
returns jsonb language sql stable set search_path = public, pg_temp as $$
with minutes as (
  select m.driver_id,
    case lower(trim(m.town)) when 'lagawe' then 'Lagawe' when 'hingyon' then 'Hingyon'
      when 'banaue' then 'Banaue' when 'lamut' then 'Lamut' else 'Unknown' end as town,
    tstzrange(greatest(m.minute_started_at,p_start),least(m.minute_started_at+interval '1 minute',p_end),'[)') as observed
  from driver_presence_minutes m
  where p_end > p_start and m.minute_started_at >= date_trunc('minute',p_start)
    and m.minute_started_at < p_end
    and not exists (select 1 from analytics_test_identities t where t.active and t.entity_type='driver' and t.entity_id=m.driver_id)
), exclusions as (
  select e.driver_id,range_agg(tstzrange(greatest(e.ineligible_start,p_start),least(e.ineligible_end,p_end),'[)')) as ranges
  from driver_duty_check_v2_exclusion_intervals_v1 e
  where e.ineligible_start < p_end and e.ineligible_end > p_start and e.ineligible_end > e.ineligible_start
  group by e.driver_id
), slices as (
  select m.*,tstzmultirange(m.observed)-coalesce(e.ranges,'{}'::tstzmultirange) as eligible
  from minutes m left join exclusions e using(driver_id)
), totals as (
  select s.driver_id,s.town,
    sum(extract(epoch from upper(observed)-lower(observed))) as raw_seconds,
    sum(coalesce((select sum(extract(epoch from upper(r)-lower(r))) from unnest(s.eligible) r),0)) as net_seconds,
    min(lower(observed)) as first_seen_at,max(upper(observed)) as last_seen_at
  from slices s group by s.driver_id,s.town
), starts as (
  select driver_id,count(*) as session_starts
  from driver_presence_sessions s where login_at >= p_start and login_at < p_end
    and coalesce(logout_at,last_seen_at,login_at)>=login_at
    and not exists(select 1 from analytics_test_identities t where t.active and t.entity_type='driver' and t.entity_id=s.driver_id)
  group by driver_id
), driver_totals as (
  select t.driver_id,coalesce(nullif(d.driver_name,''),nullif(p.full_name,''),'Unknown driver') as name,
    sum(t.raw_seconds) as raw_seconds,sum(t.net_seconds) as net_seconds,
    sum(t.raw_seconds-t.net_seconds) as excluded_seconds,
    coalesce(max(st.session_starts),0) as session_starts,
    min(t.first_seen_at) as first_seen_at,max(t.last_seen_at) as last_seen_at,
    string_agg(distinct t.town,', ' order by t.town) as town,
    exists(select 1 from driver_presence_minutes m where m.driver_id=t.driver_id and m.minute_started_at=p_start-interval '1 minute') as recorded_before_start
  from totals t left join drivers d on d.id=t.driver_id
    left join lateral (select full_name from driver_profiles where driver_id=t.driver_id limit 1) p on true
    left join starts st on st.driver_id=t.driver_id
  group by t.driver_id,d.driver_name,p.full_name
), town_ranges as (
  select s.town,range_agg(r) as ranges from slices s cross join lateral unnest(s.eligible) r group by s.town
), town_totals as (
  select t.town,count(distinct t.driver_id) as unique_drivers,
    sum(t.raw_seconds) as raw_seconds,sum(t.net_seconds) as net_seconds,
    sum(t.raw_seconds-t.net_seconds) as excluded_seconds
  from totals t group by t.town
), towns as (
  select a.town,coalesce(t.unique_drivers,0) as unique_drivers,
    coalesce(t.raw_seconds,0) as raw_seconds,coalesce(t.net_seconds,0) as net_seconds,
    coalesce(t.excluded_seconds,0) as excluded_seconds,
    coalesce(t.net_seconds/nullif(extract(epoch from p_end-p_start),0),0) as average_online,
    greatest(0,extract(epoch from p_end-p_start)-coalesce((select sum(extract(epoch from upper(r)-lower(r))) from unnest(tr.ranges) r),0)) as no_recorded_presence_seconds
  from (values ('Lagawe'),('Hingyon'),('Banaue'),('Lamut'),('Unknown')) a(town)
    left join town_totals t using(town) left join town_ranges tr using(town)
)
select jsonb_build_object(
  'drivers',coalesce((select jsonb_agg(to_jsonb(d) order by name,driver_id) from driver_totals d),'[]'::jsonb),
  'towns',coalesce((select jsonb_agg(to_jsonb(t) order by town) from towns t),'[]'::jsonb),
  'unique_drivers',(select count(*) from driver_totals),
  'net_unique_drivers',(select count(*) from driver_totals where net_seconds>0),
  'drivers_starting_sessions',(select count(*) from starts),
  'session_starts',coalesce((select sum(session_starts) from starts),0),
  'raw_seconds',coalesce((select sum(raw_seconds) from totals),0),
  'net_seconds',coalesce((select sum(net_seconds) from totals),0),
  'excluded_seconds',coalesce((select sum(raw_seconds-net_seconds) from totals),0),
  'elapsed_seconds',greatest(0,extract(epoch from p_end-p_start)),
  'basis','Recorded minute buckets clipped to shift; overlapping security exclusions merged before deduction. Missing telemetry is not proof that all drivers were offline.',
  'calculated_at',statement_timestamp()
)
$$;
revoke all on function public.operations_shift_presence_v1(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.operations_shift_presence_v1(timestamptz,timestamptz) to service_role;

create function public.operations_shift_metrics_v1(p_start timestamptz,p_end timestamptz,p_full boolean)
returns jsonb language sql stable set search_path = public, pg_temp as $$
with ending as (
  select distinct on (h.booking_id) h.* from operations_shift_booking_history h
  where p_full and h.observed_at < p_end order by h.booking_id,h.observed_at desc,h.id desc
), opening as (
  select distinct on (h.booking_id) h.* from operations_shift_booking_history h
  where p_full and h.observed_at < p_start order by h.booking_id,h.observed_at desc,h.id desc
), outcomes as (
  select h.booking_id,
    min(observed_at) filter (where lower(status_after)='completed') as completed_in_shift_at,
    min(observed_at) filter (where lower(status_after) in ('cancelled','canceled')) as cancelled_in_shift_at
  from operations_shift_booking_history h
  where h.observed_at >= p_start and h.observed_at < p_end
    and h.operation in ('insert','change') and h.status_before is distinct from h.status_after
    and lower(h.status_after) in ('completed','cancelled','canceled')
  group by h.booking_id
), legacy_cancel as (
  select e.booking_id,min(e.created_at) as cancelled_at from booking_lifecycle_events e
  where not p_full and e.created_at >= p_start and e.created_at < p_end
    and lower(e.status_after) in ('cancelled','canceled')
    and lower(coalesce(e.status_before,'')) not in ('cancelled','canceled')
  group by e.booking_id
), facts as (
  select e.booking_id as id,e.booking_code,e.service_type,e.town,e.status_after as status,
    e.driver_id,e.passenger_id,e.driver_status,e.vendor_status,e.booked_at,e.cancel_reason,
    e.observed_at as last_status_at,
    e.booked_at >= p_start and e.booked_at < p_end as is_new,
    o.completed_in_shift_at as completed_in_shift_at,o.cancelled_in_shift_at as cancelled_in_shift_at,
    coalesce(a.operation<>'delete' and lower(coalesce(a.status_after,'')) not in ('completed','cancelled','canceled'),false) as carry_in,
    e.operation<>'delete' and lower(coalesce(e.status_after,'')) not in ('completed','cancelled','canceled') as carry_out,
    e.operation='delete' and e.observed_at >= p_start as deleted_in_shift
  from ending e left join opening a using(booking_id) left join outcomes o using(booking_id)
  union all
  select b.id,b.booking_code,b.service_type,b.town,b.status,coalesce(b.assigned_driver_id,b.driver_id),b.created_by_user_id,
    b.driver_status,b.vendor_status,b.created_at,coalesce(nullif(b.cancel_reason,''),nullif(b.vendor_cancel_reason,'')),
    null::timestamptz,
    b.created_at >= p_start and b.created_at < p_end,
    case when b.completed_at >= p_start and b.completed_at < p_end then b.completed_at else o.completed_in_shift_at end,
    coalesce(c.cancelled_at,o.cancelled_in_shift_at),null::boolean,null::boolean,false
  from analytics_v3_bookings_v1 b left join outcomes o on o.booking_id=b.id
    left join legacy_cancel c on c.booking_id=b.id
  where not p_full and b.created_at < p_end
), eligible as (
  select f.*,
    case when f.service_type='takeout' then 'Takeout' when f.service_type='errand' then 'Errand' else 'Ride' end as service,
    coalesce(nullif(d.driver_name,''),nullif(p.full_name,''),case when f.driver_id is null then 'Unassigned' else 'Unknown driver' end) as driver_name,
    (f.carry_out and f.driver_id is null) as waiting_for_driver
  from facts f left join drivers d on d.id=f.driver_id
    left join lateral (select full_name from driver_profiles where driver_id=f.driver_id limit 1) p on true
  where f.service_type in ('tricycle','motorcycle','ride','takeout','errand')
    and not exists(select 1 from analytics_booking_exclusions x where x.booking_id=f.id and x.active)
    and not exists(select 1 from analytics_test_identities t where t.active and
      ((t.entity_type='driver' and t.entity_id=f.driver_id) or (t.entity_type='passenger' and t.entity_id=f.passenger_id)))
), relevant as (
  select * from eligible where is_new or completed_in_shift_at is not null or cancelled_in_shift_at is not null
    or carry_in or carry_out or deleted_in_shift
)
select jsonb_build_object(
  'new_bookings',(select count(*) from relevant where is_new),
  'completed_trips',(select count(*) from relevant where completed_in_shift_at is not null),
  'known_cancelled',(select count(*) from relevant where cancelled_in_shift_at is not null),
  'cancelled_trips',case when p_full then (select count(*) from relevant where cancelled_in_shift_at is not null) end,
  'carry_in',case when p_full then (select count(*) from relevant where carry_in) end,
  'carry_out',case when p_full then (select count(*) from relevant where carry_out) end,
  'waiting_for_driver',case when p_full then (select count(*) from relevant where waiting_for_driver) end,
  'deleted_records',(select count(*) from relevant where deleted_in_shift),
  'offer_expiries',(select count(*) from booking_lifecycle_events e join eligible b on b.id=e.booking_id
    where e.created_at >= p_start and e.created_at < p_end and e.event_type='assignment_expired'),
  'bookings',coalesce((select jsonb_agg(to_jsonb(r)-'passenger_id' order by booked_at,id) from relevant r),'[]'::jsonb),
  'basis',case when p_full then 'Recorded status transitions within shift. Counts are distinct bookings per outcome; reopened bookings can appear in more than one outcome.'
    else 'Partial historical data. Completions use completed_at or recorded transitions. Cancellation total and opening/closing states are not reconstructed from updated_at.' end
)
$$;
revoke all on function public.operations_shift_metrics_v1(timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.operations_shift_metrics_v1(timestamptz,timestamptz,boolean) to service_role;

create function public.operations_shift_catalog_v1(p_email text,p_admin boolean)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare s jsonb; me text; result jsonb;
begin
  if p_email is null or trim(p_email)='' or p_admin is null then raise exception 'Valid staff identity is required.' using errcode='42501'; end if;
  select state into strict s from operations_schedule_state where id=1;
  if p_admin then me := 'admin:'||lower(trim(p_email));
  else select e->>'id' into me from jsonb_array_elements(s->'employees') e where lower(e->>'email')=lower(trim(p_email)); end if;
  if me is null or trim(p_email)='' then raise exception 'Coordinator identity is not linked.' using errcode='42501'; end if;
  with available as (
    select split_part(k,'/',1)::date as day,split_part(k,'/',2) as duty from jsonb_each(s->'slots') a(k,v)
    where (p_admin or v->>'owner'=me) and k ~ '^\d{4}-\d{2}-\d{2}/(primary|evening)$'
    union
    select day,duty from operations_shift_runs where p_admin or scheduled_owner=me or monitor_id=me or cover_to in (me,case when p_admin then 'admin' else me end)
    union
    select day,duty from operations_shift_actions where p_admin or actor_email=lower(trim(p_email))
  )
  select coalesce(jsonb_agg(jsonb_build_object('day',day,'duty',duty) order by day desc,duty),'[]'::jsonb)
  into result from available where day >= date '2026-09-08' and day <= (statement_timestamp() at time zone 'Asia/Manila')::date;
  return jsonb_build_object('shifts',result,'actor_id',me,'server_time',statement_timestamp());
end $$;
revoke all on function public.operations_shift_catalog_v1(text,boolean) from public,anon,authenticated;
grant execute on function public.operations_shift_catalog_v1(text,boolean) to service_role;

create function public.operations_shift_read_v1(p_email text,p_admin boolean,p_day date,p_duty text,p_presence boolean default true)
returns jsonb language plpgsql stable set search_path = public, pg_temp as $$
declare s jsonb; me text; planned text; r operations_shift_runs%rowtype;
  begins timestamptz; ends timestamptz; asof timestamptz; since_at timestamptz; full_history boolean;
  watch jsonb; actions jsonb; task_actions jsonb; phase text; live_watch boolean;
begin
  if p_day is null or p_duty is null or p_duty not in ('primary','evening') or p_day < date '2026-09-08'
    or p_day > (statement_timestamp() at time zone 'Asia/Manila')::date then
    raise exception 'Choose a valid shift from September 8 through today.' using errcode='22023'; end if;
  if p_email is null or trim(p_email)='' or p_admin is null then raise exception 'Valid staff identity is required.' using errcode='42501'; end if;
  select state into strict s from operations_schedule_state where id=1;
  if p_admin then me := 'admin:'||lower(trim(p_email));
  else select e->>'id' into me from jsonb_array_elements(s->'employees') e where lower(e->>'email')=lower(trim(p_email)); end if;
  if me is null or trim(p_email)='' then raise exception 'Coordinator identity is not linked.' using errcode='42501'; end if;
  planned := s->'slots'->(p_day::text||'/'||p_duty)->>'owner';
  select * into r from operations_shift_runs where day=p_day and duty=p_duty;
  if not p_admin and me is distinct from planned and me is distinct from r.scheduled_owner
    and me is distinct from r.monitor_id and me is distinct from r.cover_to
    and not exists(select 1 from operations_shift_actions a where a.day=p_day and a.duty=p_duty and a.actor_email=lower(trim(p_email)))
  then raise exception 'You may view only your assigned shifts or shifts you covered.' using errcode='42501'; end if;
  begins := (p_day + case p_duty when 'primary' then time '10:00' else time '15:00' end) at time zone 'Asia/Manila';
  ends := (p_day + case p_duty when 'primary' then time '15:00' else time '19:00' end) at time zone 'Asia/Manila';
  asof := greatest(begins,least(statement_timestamp(),ends));
  phase := case when statement_timestamp()<begins then 'NOT STARTED' when statement_timestamp()<ends then 'LIVE' else 'ENDED' end;
  select tracking_started_at into strict since_at from operations_shift_config where id=1;
  full_history := begins >= since_at;
  live_watch := statement_timestamp()>=begins and (p_day=(statement_timestamp() at time zone 'Asia/Manila')::date
    or (p_duty='evening' and statement_timestamp()<(((p_day+1)+time '10:00') at time zone 'Asia/Manila')));
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',b.id,'booking_code',b.booking_code,'service_type',b.service_type,'town',b.town,'status',b.status,
    'driver_status',b.driver_status,'vendor_status',b.vendor_status,
    'driver_id',coalesce(b.assigned_driver_id,b.driver_id),
    'driver_name',coalesce(nullif(d.driver_name,''),case when coalesce(b.assigned_driver_id,b.driver_id) is null then 'Unassigned' else 'Unknown driver' end),
    'booked_at',b.created_at,'last_status_at',h.observed_at,'case',case when c.booking_id is not null then to_jsonb(c) else null end,
    'needs_ack',c.last_day is distinct from p_day or c.last_duty is distinct from p_duty or c.last_monitor_id is distinct from r.monitor_id
  ) order by coalesce(c.issue_open,false) desc,b.created_at,b.id),'[]'::jsonb) into watch
  from analytics_v3_bookings_v1 b left join operations_shift_cases c on c.booking_id=b.id
    left join drivers d on d.id=coalesce(b.assigned_driver_id,b.driver_id)
    left join lateral (select observed_at from operations_shift_booking_history where booking_id=b.id and operation<>'baseline' order by observed_at desc,id desc limit 1) h on true
  where live_watch and b.created_at < asof and b.service_type in ('tricycle','motorcycle','ride','takeout','errand')
    and (lower(coalesce(b.status,'')) not in ('completed','cancelled','canceled') or c.issue_open);
  select coalesce(jsonb_agg(to_jsonb(a) order by recorded_at desc,id desc),'[]'::jsonb) into actions
    from operations_shift_actions a where a.day=p_day and a.duty=p_duty;
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'actor',e.actor,'note',e.note,'recorded_at',e.created_at) order by e.created_at desc,e.id desc),'[]'::jsonb)
    into task_actions from operations_schedule_events e where e.created_at>=begins and e.created_at<asof
      and e.action in ('complete_task','reopen_task');
  return jsonb_build_object(
    'day',p_day,'duty',p_duty,'actor_id',me,'admin',p_admin,'server_time',statement_timestamp(),
    'window',jsonb_build_object('start',begins,'end',ends,'as_of',asof,'phase',phase,'tracking_since',since_at,'full_history',full_history),
    'run',jsonb_build_object('version',coalesce(r.version,0),'scheduled_owner',case when r.created_at is null then planned else r.scheduled_owner end,'current_saved_owner',planned,'monitor_id',r.monitor_id,
      'acknowledged_at',r.acknowledged_at,'first_ack_id',r.first_ack_id,'cover_to',r.cover_to,'cover_reason',r.cover_reason,
      'snapshot_at',r.created_at,'assignment_basis',case when r.created_at is null then 'Current saved schedule; actual coverage not recorded' else 'Schedule snapshot at first recorded action; actual coverage is in the activity log' end),
    'metrics',operations_shift_metrics_v1(begins,asof,full_history),
    'presence',case when p_presence then operations_shift_presence_v1(begins,asof) end,
    'watch',watch,'live_watch',live_watch,'actions',actions,'task_actions',task_actions,
    'employees',coalesce(s->'employees','[]'::jsonb),'teams',coalesce(s->'teams','{}'::jsonb)
  );
end $$;
revoke all on function public.operations_shift_read_v1(text,boolean,date,text,boolean) from public,anon,authenticated;
grant execute on function public.operations_shift_read_v1(text,boolean,date,text,boolean) to service_role;

create function public.operations_shift_apply_v1(
  p_email text,p_admin boolean,p_day date,p_duty text,p_version integer,
  p_action text,p_booking uuid,p_note text,p_target text,p_request uuid
) returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare s jsonb; me text; planned text; r operations_shift_runs%rowtype;
  prior operations_shift_actions%rowtype; b public.bookings%rowtype;
  c operations_shift_cases%rowtype; n timestamptz := clock_timestamp();
  begins timestamptz; ends timestamptz; live boolean; after_hours boolean;
  before_monitor text; note_text text := trim(coalesce(p_note,''));
begin
  if p_email is null or trim(p_email)='' or p_admin is null or p_request is null
    or p_day is null or p_duty is null or p_version is null or p_version<0
    or p_duty not in ('primary','evening') then
    raise exception 'Invalid shift action.' using errcode='22023'; end if;
  if p_action is null or p_action not in ('start','admin_takeover','request_cover','accept_cover','ack_trip',
    'flag_issue','ack_issue','contact_driver','contact_vendor','escalate','resolve_issue','handover') then
    raise exception 'Choose a valid action.' using errcode='22023'; end if;
  if length(note_text)>500 or note_text ~ '[^\x20-\x7e\r\n]' then
    raise exception 'Use ASCII text, up to 500 characters.' using errcode='22023'; end if;
  select state into strict s from operations_schedule_state where id=1 for share;
  if p_admin then me := 'admin:'||lower(trim(p_email));
  else select e->>'id' into me from jsonb_array_elements(s->'employees') e where lower(e->>'email')=lower(trim(p_email)); end if;
  if me is null then raise exception 'Coordinator identity is not linked.' using errcode='42501'; end if;
  select * into prior from operations_shift_actions where request_id=p_request;
  if found then
    if prior.actor_id<>me or prior.day<>p_day or prior.duty<>p_duty or prior.action<>p_action
      or prior.booking_id is distinct from p_booking or prior.note<>note_text or prior.target is distinct from nullif(p_target,'') then
      raise exception 'Request identifier was already used for a different action.' using errcode='23505'; end if;
    return jsonb_build_object('ok',true,'replayed',true);
  end if;
  if p_booking is not null and p_action in ('start','admin_takeover','request_cover','accept_cover') then
    raise exception 'Shift control actions must not specify a booking.' using errcode='22023'; end if;
  if nullif(p_target,'') is not null and p_action<>'request_cover' then
    raise exception 'Only a coverage request may specify a replacement.' using errcode='22023'; end if;
  begins := (p_day+case p_duty when 'primary' then time '10:00' else time '15:00' end) at time zone 'Asia/Manila';
  ends := (p_day+case p_duty when 'primary' then time '15:00' else time '19:00' end) at time zone 'Asia/Manila';
  live := n>=begins and n<ends;
  after_hours := p_admin and p_duty='evening' and n>=ends and n<(((p_day+1)+time '10:00') at time zone 'Asia/Manila');
  if p_day<>(n at time zone 'Asia/Manila')::date and not after_hours then
    raise exception 'Past and future shifts are read-only. Actions use the actual server time.' using errcode='22023'; end if;
  if not live and not after_hours and not (p_action='handover' and n>=ends) then
    raise exception 'This shift is not active. Open the current shift; unfinished trips remain visible.' using errcode='22023'; end if;
  if not p_admin and s->'rests'->>p_day::text=me then
    raise exception 'You are on a rest day. Ask Admin to arrange coverage.' using errcode='42501'; end if;
  planned := s->'slots'->(p_day::text||'/'||p_duty)->>'owner';
  select * into r from operations_shift_runs where day=p_day and duty=p_duty for update;
  if not found then
    if p_action not in ('start','admin_takeover') or (not p_admin and me is distinct from planned) then
      raise exception 'The assigned coordinator must acknowledge this shift, or Admin must take over first.' using errcode='42501'; end if;
    insert into operations_shift_runs(day,duty,scheduled_owner) values(p_day,p_duty,planned)
      on conflict (day,duty) do nothing;
    select * into strict r from operations_shift_runs where day=p_day and duty=p_duty for update;
  end if;
  if r.version<>p_version then
    raise exception 'Shift changed. Refresh before retrying; another action was saved first.' using errcode='40001'; end if;
  before_monitor := r.monitor_id;
  if p_action='start' then
    if r.monitor_id is not null or (not p_admin and me is distinct from planned) then
      raise exception 'This shift already has a monitor. Request and accept coverage instead.' using errcode='42501'; end if;
    if p_admin and length(note_text)<8 then raise exception 'Give the reason for Admin coverage.' using errcode='22023'; end if;
    r.monitor_id:=me; r.acknowledged_at:=n; r.first_ack_id:=me;
  elsif p_action='admin_takeover' then
    if not p_admin then raise exception 'Only Admin can take over directly.' using errcode='42501'; end if;
    if length(note_text)<8 then raise exception 'Give a reason for Admin takeover.' using errcode='22023'; end if;
    r.monitor_id:=me; r.cover_to:=null; r.cover_reason:=null;
    r.acknowledged_at:=coalesce(r.acknowledged_at,n); r.first_ack_id:=coalesce(r.first_ack_id,me);
  elsif p_action='request_cover' then
    if not live or (not p_admin and me is distinct from r.monitor_id) then raise exception 'Only the current monitor or Admin may request active-shift coverage.' using errcode='42501'; end if;
    if length(note_text)<8 or p_target is null or p_target=me or
      (p_target<>'admin' and not exists(select 1 from jsonb_array_elements(s->'employees') e where e->>'id'=p_target and coalesce(e->>'email','')<>'')) then
      raise exception 'Choose a different linked coordinator or Admin and give a reason.' using errcode='22023'; end if;
    if s->'rests'->>p_day::text=p_target then raise exception 'The replacement is on a rest day.' using errcode='22023'; end if;
    r.cover_to:=p_target; r.cover_reason:=note_text;
  elsif p_action='accept_cover' then
    if not live or (me is distinct from r.cover_to and not (p_admin and r.cover_to='admin')) then
      raise exception 'Only the requested replacement can accept this coverage.' using errcode='42501'; end if;
    r.monitor_id:=me; r.cover_to:=null; r.cover_reason:=null;
    r.acknowledged_at:=coalesce(r.acknowledged_at,n); r.first_ack_id:=coalesce(r.first_ack_id,me);
  else
    if me is distinct from r.monitor_id then
      raise exception 'Only the acknowledged monitor may record assistance. Admin can take over with a reason.' using errcode='42501'; end if;
    if p_booking is null then raise exception 'Select the booking concerned.' using errcode='22023'; end if;
    select * into b from public.bookings where id=p_booking for share;
    if not found or b.service_type not in ('tricycle','motorcycle','ride','takeout','errand')
      or not exists(select 1 from analytics_v3_bookings_v1 where id=p_booking) then
      raise exception 'This booking is unavailable or excluded from operational reporting.' using errcode='22023'; end if;
    if b.created_at>=ends then raise exception 'This booking belongs to a later shift.' using errcode='22023'; end if;
    if p_action not in ('ack_trip','ack_issue') and length(note_text)<8 then
      raise exception 'Add a brief reason or outcome of at least 8 characters.' using errcode='22023'; end if;
    insert into operations_shift_cases(booking_id) values(p_booking) on conflict (booking_id) do nothing;
    select * into strict c from operations_shift_cases where booking_id=p_booking for update;
    if lower(coalesce(b.status,'')) in ('completed','cancelled','canceled') and not c.issue_open then
      raise exception 'This trip has ended and has no open issue. Refresh the report.' using errcode='22023'; end if;
    if p_action='ack_trip' then
      c.last_day:=p_day; c.last_duty:=p_duty; c.last_monitor_id:=me; c.handover_pending:=false;
      if c.issue_open then c.issue_ack_at:=coalesce(c.issue_ack_at,n); end if;
    elsif p_action='flag_issue' then
      if not c.issue_open then c.raised_at:=n; c.issue_ack_at:=null; c.resolved_at:=null; end if;
      c.issue_open:=true; c.issue_note:=note_text;
    elsif p_action='ack_issue' then
      if not c.issue_open then raise exception 'No open issue to acknowledge.' using errcode='22023'; end if;
      c.issue_ack_at:=coalesce(c.issue_ack_at,n);
    elsif p_action='resolve_issue' then
      if not c.issue_open then raise exception 'No open issue to resolve.' using errcode='22023'; end if;
      c.issue_open:=false; c.resolved_at:=n;
    elsif p_action='handover' then
      -- A late outgoing note must not undo the incoming coordinator's acknowledgement.
      if not (coalesce(c.last_day>p_day,false) or coalesce(c.last_day=p_day and c.last_duty='evening' and p_duty='primary',false)) then
        c.handover_pending:=true;
      end if;
      c.handover_note:=note_text;
    end if;
    c.last_reviewed_at:=n;
    update operations_shift_cases set issue_open=c.issue_open,raised_at=c.raised_at,issue_ack_at=c.issue_ack_at,
      resolved_at=c.resolved_at,issue_note=c.issue_note,handover_pending=c.handover_pending,handover_note=c.handover_note,
      last_reviewed_at=c.last_reviewed_at,last_monitor_id=c.last_monitor_id,last_day=c.last_day,last_duty=c.last_duty
      where booking_id=p_booking;
  end if;
  insert into operations_shift_actions(request_id,day,duty,actor_id,actor_email,action,booking_id,note,target,recorded_at,details)
    values(p_request,p_day,p_duty,me,lower(trim(p_email)),p_action,p_booking,note_text,nullif(p_target,''),n,
      jsonb_build_object('monitor_before',before_monitor,'monitor_after',r.monitor_id,'outside_shift',not live,
        'evidence',case when p_action in ('contact_driver','contact_vendor') then 'Employee-recorded contact, not an independently verified call' else 'Server-recorded action' end));
  update operations_shift_runs set version=r.version+1,monitor_id=r.monitor_id,acknowledged_at=r.acknowledged_at,
    first_ack_id=r.first_ack_id,cover_to=r.cover_to,cover_reason=r.cover_reason where day=p_day and duty=p_duty;
  return jsonb_build_object('ok',true,'version',r.version+1);
end $$;
revoke all on function public.operations_shift_apply_v1(text,boolean,date,text,integer,text,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.operations_shift_apply_v1(text,boolean,date,text,integer,text,uuid,text,text,uuid) to service_role;
