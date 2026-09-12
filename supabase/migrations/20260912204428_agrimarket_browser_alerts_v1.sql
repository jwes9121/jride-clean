-- Isolated AgriMarket Web Push. No changes to Takeout, driver sessions or order state.
-- Key material is provisioned separately, never committed. Disabled until rollout verification.
create schema if not exists agrimarket_alerts_private;
revoke all on schema agrimarket_alerts_private from public, anon, authenticated;
grant usage on schema agrimarket_alerts_private to service_role;

create table agrimarket_alerts_private.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false,
  public_key text,
  private_key text
);
alter table agrimarket_alerts_private.settings enable row level security;
revoke all on agrimarket_alerts_private.settings from public, anon, authenticated;
grant select on agrimarket_alerts_private.settings to service_role;
insert into agrimarket_alerts_private.settings(id) values (true);

create table public.agrimarket_browser_subscriptions (
  id uuid primary key default gen_random_uuid(),
  producer_id uuid not null references public.agrimarket_producers(id),
  endpoint text not null unique check (length(endpoint) between 10 and 2048),
  p256dh text not null,
  auth_key text not null,
  credential_version text not null,
  status text not null default 'active' check (status in ('active','disabled','expired')),
  expires_at timestamptz not null default now() + interval '30 days',
  last_test_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agrimarket_browser_subscriptions_producer_idx on public.agrimarket_browser_subscriptions(producer_id);
alter table public.agrimarket_browser_subscriptions enable row level security;
revoke all on public.agrimarket_browser_subscriptions from public, anon, authenticated;
grant select, insert, update on public.agrimarket_browser_subscriptions to service_role;

create table public.agrimarket_browser_alert_jobs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.agrimarket_browser_subscriptions(id),
  order_id uuid references public.agrimarket_orders(id),
  kind text not null check (kind in ('order','test')),
  status text not null default 'pending' check (status in ('pending','sending','sent','expired','failed')),
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_id uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  check ((kind='order' and order_id is not null) or (kind='test' and order_id is null))
);
create unique index agrimarket_browser_order_once_idx on public.agrimarket_browser_alert_jobs(subscription_id,order_id) where order_id is not null;
create index agrimarket_browser_jobs_due_idx on public.agrimarket_browser_alert_jobs(not_before) where status in ('pending','sending');
create index agrimarket_browser_jobs_subscription_idx on public.agrimarket_browser_alert_jobs(subscription_id,created_at desc);
create index agrimarket_browser_jobs_order_idx on public.agrimarket_browser_alert_jobs(order_id) where order_id is not null;
alter table public.agrimarket_browser_alert_jobs enable row level security;
revoke all on public.agrimarket_browser_alert_jobs from public, anon, authenticated;
grant select, insert, update on public.agrimarket_browser_alert_jobs to service_role;

create function public.agrimarket_browser_config_v1() returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('enabled',enabled,'public_key',public_key,'private_key',private_key)
  from agrimarket_alerts_private.settings where id;
$$;

create function public.agrimarket_browser_subscribe_v1(p_producer_id uuid,p_endpoint text,p_p256dh text,p_auth text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v_version text;
  v_sub public.agrimarket_browser_subscriptions%rowtype;
begin
  -- The API supplies producer identity from verified AgriMarket credentials, never from the body.
  perform 1 from public.agrimarket_producers where id=p_producer_id and status='active' for update;
  if not found then raise exception 'PRODUCER_NOT_ACTIVE'; end if;
  select encode(extensions.digest(c.pin_hash,'sha256'),'hex') into v_version
  from public.agrimarket_producer_credentials c where c.producer_id=p_producer_id and c.status='active';
  if v_version is null then raise exception 'CREDENTIAL_NOT_ACTIVE'; end if;
  if p_endpoint !~ '^https://' or length(p_endpoint)>2048
    or p_p256dh !~ '^[A-Za-z0-9_-]{87}=?$' or p_auth !~ '^[A-Za-z0-9_-]{22}={0,2}$'
    then raise exception 'INVALID_SUBSCRIPTION'; end if;
  select * into v_sub from public.agrimarket_browser_subscriptions where endpoint=p_endpoint for update;
  if found and v_sub.producer_id<>p_producer_id then raise exception 'BROWSER_LINKED_TO_ANOTHER_FARM'; end if;
  if (v_sub.id is null or v_sub.status<>'active' or v_sub.expires_at<=now()) and
    (select count(*) from public.agrimarket_browser_subscriptions where producer_id=p_producer_id and status='active' and expires_at>now())>=5
    then raise exception 'BROWSER_LIMIT_REACHED'; end if;
  insert into public.agrimarket_browser_subscriptions(producer_id,endpoint,p256dh,auth_key,credential_version)
    values(p_producer_id,p_endpoint,p_p256dh,p_auth,v_version)
  on conflict(endpoint) do update set p256dh=excluded.p256dh,auth_key=excluded.auth_key,
    credential_version=excluded.credential_version,status='active',expires_at=now()+interval '30 days',updated_at=now()
  where public.agrimarket_browser_subscriptions.producer_id=p_producer_id
  returning * into v_sub;
  if v_sub.id is null then raise exception 'BROWSER_LINKED_TO_ANOTHER_FARM'; end if;
  return jsonb_build_object('id',v_sub.id,'active',true,'expires_at',v_sub.expires_at);
end;
$$;

create function public.agrimarket_browser_status_v1(p_producer_id uuid,p_subscription_id uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('id',s.id,'active',s.status='active' and s.expires_at>now()
    and c.status='active' and p.status='active'
    and s.credential_version=encode(extensions.digest(c.pin_hash,'sha256'),'hex'),
    'expires_at',s.expires_at,'last_test',(select jsonb_build_object('status',j.status,'last_error',j.last_error)
      from public.agrimarket_browser_alert_jobs j where j.subscription_id=s.id and j.kind='test'
      order by j.created_at desc limit 1))
  from public.agrimarket_browser_subscriptions s
  join public.agrimarket_producers p on p.id=s.producer_id
  join public.agrimarket_producer_credentials c on c.producer_id=p.id
  where s.id=p_subscription_id and s.producer_id=p_producer_id;
$$;

create function public.agrimarket_browser_action_v1(p_producer_id uuid,p_subscription_id uuid,p_action text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v_sub public.agrimarket_browser_subscriptions%rowtype; v_job uuid;
begin
  select * into v_sub from public.agrimarket_browser_subscriptions
    where id=p_subscription_id and producer_id=p_producer_id for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if p_action='unsubscribe' then
    update public.agrimarket_browser_subscriptions set status='disabled',updated_at=now() where id=v_sub.id;
    update public.agrimarket_browser_alert_jobs set status='expired',last_error='DISABLED'
      where subscription_id=v_sub.id and status in ('pending','sending');
    return jsonb_build_object('disabled',true);
  end if;
  if p_action<>'test' or v_sub.status<>'active' or v_sub.expires_at<=now()
    or not coalesce((select enabled from agrimarket_alerts_private.settings where id),false)
    or not coalesce((public.agrimarket_browser_status_v1(p_producer_id,p_subscription_id)->>'active')::boolean,false)
    then raise exception 'TEST_NOT_AVAILABLE'; end if;
  if v_sub.last_test_at>now()-interval '1 minute' then raise exception 'TEST_RATE_LIMITED'; end if;
  update public.agrimarket_browser_subscriptions set last_test_at=now() where id=v_sub.id;
  insert into public.agrimarket_browser_alert_jobs(subscription_id,kind,not_before,expires_at)
    values(v_sub.id,'test',now()+interval '15 seconds',now()+interval '3 minutes') returning id into v_job;
  return jsonb_build_object('test_id',v_job,'queued',true);
end;
$$;

create function public.agrimarket_browser_claim_v1(p_producer_id uuid default null,p_limit integer default 10)
returns table(id uuid,lease_id uuid) language plpgsql security invoker set search_path='' as $$
begin
  if not coalesce((select enabled from agrimarket_alerts_private.settings where settings.id),false) then return; end if;
  -- Durable catch-up: scans committed pending orders. No trigger can break checkout.
  insert into public.agrimarket_browser_alert_jobs(subscription_id,order_id,kind,expires_at)
    select s.id,o.id,'order',o.producer_confirm_expires_at
    from public.agrimarket_orders o join public.agrimarket_browser_subscriptions s on s.producer_id=o.producer_id
    join public.agrimarket_producers p on p.id=o.producer_id
    join public.agrimarket_producer_credentials c on c.producer_id=p.id
    where o.status='awaiting_producer' and o.producer_confirm_expires_at>now()
      and (p_producer_id is null or p.id=p_producer_id)
      and p.status='active' and s.status='active' and s.expires_at>now() and c.status='active'
      and s.credential_version=encode(extensions.digest(c.pin_hash,'sha256'),'hex')
    on conflict(subscription_id,order_id) where order_id is not null do nothing;
  update public.agrimarket_browser_alert_jobs j set status='expired',last_error='DEADLINE_PASSED'
    where j.status in ('pending','sending') and j.expires_at<=now();
  return query
    with picked as (
      select j.id from public.agrimarket_browser_alert_jobs j
      join public.agrimarket_browser_subscriptions s on s.id=j.subscription_id
      where j.status in ('pending','sending') and j.not_before<=now() and j.expires_at>now()
        and (j.lease_until is null or j.lease_until<=now()) and j.attempts<5
        and (p_producer_id is null or s.producer_id=p_producer_id)
      order by j.not_before,j.id limit greatest(1,least(coalesce(p_limit,10),25)) for update of j skip locked
    )
    update public.agrimarket_browser_alert_jobs j set status='sending',attempts=j.attempts+1,
      lease_id=gen_random_uuid(),lease_until=now()+interval '45 seconds'
    from picked where j.id=picked.id returning j.id,j.lease_id;
end;
$$;

create function public.agrimarket_browser_validate_v1(p_id uuid,p_lease uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth_key),
    'kind',j.kind,'order_code',o.order_code,'expires_at',j.expires_at)
  from public.agrimarket_browser_alert_jobs j
  join public.agrimarket_browser_subscriptions s on s.id=j.subscription_id
  join public.agrimarket_producers p on p.id=s.producer_id
  join public.agrimarket_producer_credentials c on c.producer_id=p.id
  left join public.agrimarket_orders o on o.id=j.order_id and o.producer_id=p.id
  where j.id=p_id and j.lease_id=p_lease and j.lease_until>now() and j.status='sending' and j.expires_at>now()
    and s.status='active' and s.expires_at>now() and p.status='active' and c.status='active'
    and s.credential_version=encode(extensions.digest(c.pin_hash,'sha256'),'hex')
    and (select enabled from agrimarket_alerts_private.settings where settings.id)
    and (j.kind='test' or (o.status='awaiting_producer' and o.producer_confirm_expires_at>now()));
$$;

create function public.agrimarket_browser_finish_v1(p_id uuid,p_lease uuid,p_result text)
returns void language plpgsql security invoker set search_path='' as $$
declare v_sub uuid;
begin
  update public.agrimarket_browser_alert_jobs j set
    status=case when p_result='SENT' then 'sent'
      when p_result in ('STALE','SUBSCRIPTION_GONE','INVALID_SUBSCRIPTION') or j.expires_at<=now() then 'expired'
      when j.attempts>=5 then 'failed' else 'pending' end,
    sent_at=case when p_result='SENT' then now() else null end,
    last_error=case when p_result='SENT' then null when p_result in ('STALE','SUBSCRIPTION_GONE','INVALID_SUBSCRIPTION') then p_result else 'SEND_FAILED' end,
    not_before=now()+interval '30 seconds',lease_until=null,lease_id=null
    where j.id=p_id and j.lease_id=p_lease and j.status='sending' returning subscription_id into v_sub;
  if v_sub is not null and p_result in ('SUBSCRIPTION_GONE','INVALID_SUBSCRIPTION') then
    update public.agrimarket_browser_subscriptions set status='expired',updated_at=now() where id=v_sub;
  end if;
end;
$$;

-- No browser/user role can call internal RPCs or read endpoints/key material directly.
revoke all on function public.agrimarket_browser_config_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_browser_subscribe_v1(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.agrimarket_browser_status_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.agrimarket_browser_action_v1(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.agrimarket_browser_claim_v1(uuid,integer) from public,anon,authenticated;
revoke all on function public.agrimarket_browser_validate_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.agrimarket_browser_finish_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.agrimarket_browser_config_v1(),public.agrimarket_browser_subscribe_v1(uuid,text,text,text),
  public.agrimarket_browser_status_v1(uuid,uuid),public.agrimarket_browser_action_v1(uuid,uuid,text),
  public.agrimarket_browser_claim_v1(uuid,integer),public.agrimarket_browser_validate_v1(uuid,uuid),
  public.agrimarket_browser_finish_v1(uuid,uuid,text) to service_role;
