-- Farmer browser sessions are separate from passenger, driver and Takeout auth.
create table public.agrimarket_farmer_browser_sessions (
  token_hash text primary key check (token_hash ~ '^[a-f0-9]{64}$'),
  producer_id uuid not null references public.agrimarket_producers(id) on delete cascade,
  credential_version text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'
);
create index agrimarket_farmer_sessions_producer_idx on public.agrimarket_farmer_browser_sessions(producer_id,created_at);
alter table public.agrimarket_farmer_browser_sessions enable row level security;
revoke all on public.agrimarket_farmer_browser_sessions from public,anon,authenticated;
grant select,insert,delete on public.agrimarket_farmer_browser_sessions to service_role;

create function public.agrimarket_farmer_session_login_v1(p_access_code text,p_pin text,p_token_hash text)
returns jsonb language plpgsql security invoker set search_path = public,extensions as $$
declare v_producer uuid; v_version text; v_code text;
begin
  if p_token_hash is null or p_token_hash !~ '^[a-f0-9]{64}$' then raise exception 'INVALID_SESSION'; end if;
  -- The existing verifier locks the credential row, checks the PIN and retains
  -- its attempt limit. The lock lasts through session creation in this RPC.
  select v.producer_id,v.access_code into v_producer,v_code
    from public.agrimarket_verify_producer_credential_v1(p_access_code,p_pin,clock_timestamp()) v;
  if v_producer is null then return null; end if;
  select encode(extensions.digest(c.id::text || ':' || c.pin_hash,'sha256'),'hex') into v_version
    from public.agrimarket_producer_credentials c where c.producer_id=v_producer and c.status='active';
  delete from public.agrimarket_farmer_browser_sessions where producer_id=v_producer
    and (expires_at<=now() or credential_version<>v_version);
  -- Bound remembered devices without extending existing sessions indefinitely.
  delete from public.agrimarket_farmer_browser_sessions where token_hash in
    (select s.token_hash from public.agrimarket_farmer_browser_sessions s where s.producer_id=v_producer
      order by s.created_at desc,s.token_hash offset 9);
  insert into public.agrimarket_farmer_browser_sessions(token_hash,producer_id,credential_version)
    values(p_token_hash,v_producer,v_version);
  return jsonb_build_object('access_code',v_code,'producer_id',v_producer);
end;
$$;

create function public.agrimarket_farmer_session_read_v1(p_token_hash text)
returns jsonb language sql stable security invoker set search_path = public,extensions as $$
  select jsonb_build_object('access_code',c.access_code,'producer',jsonb_build_object(
    'id',p.id,'status',p.status,'accepting_orders',p.accepting_orders,'contact_name',p.contact_name,
    'vendor_name',p.vendor_name,'town',p.town,'barangay',p.barangay))
  from public.agrimarket_farmer_browser_sessions s
  join public.agrimarket_producer_credentials c on c.producer_id=s.producer_id
  join public.agrimarket_producers p on p.id=s.producer_id
  where s.token_hash=p_token_hash and s.expires_at>now() and c.status='active' and p.status='active'
    and (c.locked_until is null or c.locked_until<=now())
    and s.credential_version=encode(extensions.digest(c.id::text || ':' || c.pin_hash,'sha256'),'hex');
$$;

create function public.agrimarket_farmer_session_logout_v1(p_token_hash text,p_subscription_id uuid default null)
returns void language plpgsql security invoker set search_path = public as $$
declare v_producer uuid;
begin
  delete from public.agrimarket_farmer_browser_sessions where token_hash=p_token_hash returning producer_id into v_producer;
  if v_producer is not null and p_subscription_id is not null then
    update public.agrimarket_browser_subscriptions set status='disabled',updated_at=now()
      where id=p_subscription_id and producer_id=v_producer;
    update public.agrimarket_browser_alert_jobs set status='expired',last_error='DISABLED'
      where subscription_id=p_subscription_id and status in ('pending','sending')
        and exists(select 1 from public.agrimarket_browser_subscriptions s
          where s.id=p_subscription_id and s.producer_id=v_producer);
  end if;
end;
$$;
revoke all on function public.agrimarket_farmer_session_login_v1(text,text,text) from public,anon,authenticated;
revoke all on function public.agrimarket_farmer_session_read_v1(text) from public,anon,authenticated;
revoke all on function public.agrimarket_farmer_session_logout_v1(text,uuid) from public,anon,authenticated;
grant execute on function public.agrimarket_farmer_session_login_v1(text,text,text),
  public.agrimarket_farmer_session_read_v1(text),public.agrimarket_farmer_session_logout_v1(text,uuid) to service_role;
