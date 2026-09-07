-- Drivers keep their existing UUID entry. A staff-approved device credential
-- replaces mandatory email/password sign-in for AgriMarket only.
create table public.agrimarket_driver_devices (
  id uuid primary key,
  driver_id uuid not null references public.drivers(id),
  device_id text not null check (device_id ~ '^[0-9a-f]{16}$'),
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending' check(status in ('pending','approved','revoked')),
  client_version text not null default '' check(length(client_version)<=60),
  created_at timestamptz not null default clock_timestamp(),
  reviewed_at timestamptz,
  reviewed_by text,
  review_note text
);
create unique index agrimarket_driver_devices_one_approved on public.agrimarket_driver_devices(driver_id) where status='approved';
create index agrimarket_driver_devices_driver_created on public.agrimarket_driver_devices(driver_id,created_at desc);
create table public.agrimarket_driver_device_events (
  id uuid primary key default gen_random_uuid(),
  device_credential_id uuid not null references public.agrimarket_driver_devices(id),
  event_type text not null check(event_type in ('requested','approved','revoked')),
  actor text not null,
  note text,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.agrimarket_driver_devices enable row level security;
alter table public.agrimarket_driver_device_events enable row level security;
revoke all on public.agrimarket_driver_devices, public.agrimarket_driver_device_events from public,anon,authenticated;
grant all on public.agrimarket_driver_devices, public.agrimarket_driver_device_events to service_role;

create function public.agrimarket_request_driver_device_v1(
  p_id uuid,p_driver_id uuid,p_device_id text,p_token_sha256 text,p_client_version text default '',p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare d agrimarket_driver_devices%rowtype;
begin
  if p_id is null or p_driver_id is null or coalesce(p_device_id,'') !~ '^[0-9a-f]{16}$' or coalesce(p_token_sha256,'') !~ '^[0-9a-f]{64}$' or length(coalesce(p_client_version,''))>60 then raise exception 'DRIVER_DEVICE_REQUEST_INVALID'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_device:'||p_driver_id::text,0));
  if not exists(select 1 from drivers where id=p_driver_id) or not exists(select 1 from driver_profiles where driver_id=p_driver_id) then raise exception 'DRIVER_NOT_FOUND'; end if;
  select * into d from agrimarket_driver_devices where id=p_id for update;
  if d.id is not null then
    if d.driver_id<>p_driver_id or d.device_id<>p_device_id or d.token_sha256<>p_token_sha256 then raise exception 'DRIVER_DEVICE_REQUEST_CONFLICT'; end if;
  else
    if (select count(*) from agrimarket_driver_devices where driver_id=p_driver_id and created_at>p_now-interval '24 hours')>=3 then raise exception 'DRIVER_DEVICE_REQUEST_LIMIT'; end if;
    insert into agrimarket_driver_devices(id,driver_id,device_id,token_sha256,client_version,created_at)
      values(p_id,p_driver_id,p_device_id,p_token_sha256,coalesce(p_client_version,''),p_now) returning * into d;
    insert into agrimarket_driver_device_events(device_credential_id,event_type,actor,created_at) values(p_id,'requested','device:'||p_device_id,p_now);
  end if;
  return jsonb_build_object('id',d.id,'status',case when d.status='pending' and d.created_at<p_now-interval '24 hours' then 'expired' else d.status end);
end; $$;
revoke all on function public.agrimarket_request_driver_device_v1(uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_request_driver_device_v1(uuid,uuid,text,text,text,timestamptz) to service_role;

create function public.agrimarket_review_driver_device_v1(
  p_id uuid,p_decision text,p_actor text,p_actor_role text,p_note text,p_now timestamptz default clock_timestamp()
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare d agrimarket_driver_devices%rowtype; old_id uuid;
begin
  if p_actor_role is distinct from 'admin' or length(trim(coalesce(p_actor,'')))<2 then raise exception 'AGRIMARKET_ADMIN_REQUIRED'; end if;
  if coalesce(p_decision,'') not in ('approve','revoke') or length(trim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'DRIVER_DEVICE_REVIEW_INVALID'; end if;
  select * into d from agrimarket_driver_devices where id=p_id;
  if d.id is null then raise exception 'DRIVER_DEVICE_NOT_FOUND'; end if;
  perform pg_advisory_xact_lock(hashtextextended('agrimarket_device:'||d.driver_id::text,0));
  select * into d from agrimarket_driver_devices where id=p_id for update;
  if p_decision='approve' then
    if d.status='revoked' then raise exception 'DRIVER_DEVICE_REVOKED'; end if;
    if d.status='pending' and d.created_at<p_now-interval '24 hours' then raise exception 'DRIVER_DEVICE_REQUEST_EXPIRED'; end if;
    if d.status='approved' then return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status','approved'); end if;
    for old_id in update agrimarket_driver_devices set status='revoked',reviewed_at=p_now,reviewed_by=p_actor,review_note='Replaced by another approved phone' where driver_id=d.driver_id and status='approved' returning id loop
      insert into agrimarket_driver_device_events(device_credential_id,event_type,actor,note,created_at) values(old_id,'revoked',p_actor,'Replaced by another approved phone',p_now);
    end loop;
  elsif d.status='revoked' then return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status','revoked');
  end if;
  update agrimarket_driver_devices set status=case p_decision when 'approve' then 'approved' else 'revoked' end,reviewed_at=p_now,reviewed_by=p_actor,review_note=trim(p_note) where id=d.id;
  insert into agrimarket_driver_device_events(device_credential_id,event_type,actor,note,created_at) values(d.id,case p_decision when 'approve' then 'approved' else 'revoked' end,p_actor,trim(p_note),p_now);
  return jsonb_build_object('id',d.id,'driver_id',d.driver_id,'status',case p_decision when 'approve' then 'approved' else 'revoked' end);
end; $$;
revoke all on function public.agrimarket_review_driver_device_v1(uuid,text,text,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.agrimarket_review_driver_device_v1(uuid,text,text,text,text,timestamptz) to service_role;
