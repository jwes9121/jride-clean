-- Shared staff planning. Only the authenticated server API may read or write.
create table public.operations_schedule_state (
  id integer primary key check (id = 1),
  version integer not null default 0 check (version >= 0),
  state jsonb not null,
  updated_at timestamptz not null default clock_timestamp()
);
create table public.operations_schedule_events (
  id bigint generated always as identity primary key,
  version integer not null unique,
  actor text not null,
  action text not null,
  note text not null default '',
  day text not null default '',
  duty text not null default '',
  changes jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.operations_schedule_state enable row level security;
alter table public.operations_schedule_events enable row level security;
revoke all on public.operations_schedule_state,public.operations_schedule_events from public,anon,authenticated,service_role;
revoke all on sequence public.operations_schedule_events_id_seq from public,anon,authenticated;
grant select,update on public.operations_schedule_state to service_role;
grant select,insert on public.operations_schedule_events to service_role;
grant usage,select on sequence public.operations_schedule_events_id_seq to service_role;
insert into public.operations_schedule_state(id,state)
values(1,'{"employees":[],"slots":{},"rests":{},"months":{},"teams":{}}'::jsonb);

create function public.operations_schedule_commit_v1(p_version integer,p_state jsonb,p_event jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare previous jsonb; current_version integer;
begin
  select state,version into previous,current_version from public.operations_schedule_state where id=1 for update;
  if current_version is distinct from p_version then return false; end if;
  if jsonb_typeof(p_state) is distinct from 'object'
     or jsonb_typeof(p_state->'employees') is distinct from 'array'
     or jsonb_typeof(p_state->'slots') is distinct from 'object'
     or jsonb_typeof(p_state->'rests') is distinct from 'object'
     or jsonb_typeof(p_state->'months') is distinct from 'object'
     or jsonb_typeof(p_state->'teams') is distinct from 'object'
     or nullif(p_event->>'actor','') is null or nullif(p_event->>'action','') is null
     then raise exception 'Invalid schedule commit'; end if;
  update public.operations_schedule_state set state=p_state,version=version+1,updated_at=clock_timestamp() where id=1;
  insert into public.operations_schedule_events(version,actor,action,note,day,duty,changes)
  values(p_version+1,p_event->>'actor',p_event->>'action',coalesce(p_event->>'note',''),coalesce(p_event->>'day',''),coalesce(p_event->>'duty',''),
    jsonb_build_object('before',previous,'after',p_state));
  return true;
end;
$$;
revoke all on function public.operations_schedule_commit_v1(integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.operations_schedule_commit_v1(integer,jsonb,jsonb) to service_role;
