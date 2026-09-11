-- JRide vendor native alerts. Starts DISABLED. No Firebase key is stored in source.
create schema if not exists vendor_native_private;
revoke all on schema vendor_native_private from public, anon, authenticated;
grant usage on schema vendor_native_private to service_role;

create table public.vendor_native_devices (
  installation_id uuid primary key,
  vendor_id uuid not null,
  token text not null unique check (length(token) between 32 and 4096),
  secret_hash text not null check (length(secret_hash) = 64),
  session_hash text not null check (length(session_hash) = 64),
  expires_at timestamptz not null,
  notifications_enabled boolean not null default false,
  sound_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  next_alert_at timestamptz not null default now(),
  lease_until timestamptz not null default '-infinity',
  lease_id uuid,
  last_order_ids uuid[] not null default '{}',
  claimed_order_ids uuid[] not null default '{}',
  last_sent_at timestamptz,
  last_error text
);
alter table public.vendor_native_devices enable row level security;
revoke all on public.vendor_native_devices from public, anon, authenticated;
grant select, insert, update, delete on public.vendor_native_devices to service_role;
create index vendor_native_devices_vendor_idx on public.vendor_native_devices(vendor_id, expires_at)
  where notifications_enabled;

create table vendor_native_private.settings (
  id boolean primary key default true check (id),
  enabled boolean not null default false
);
alter table vendor_native_private.settings enable row level security;
insert into vendor_native_private.settings(id,enabled) values(true,false);
revoke all on vendor_native_private.settings from public, anon, authenticated;
grant select on vendor_native_private.settings to service_role;

create function public.vendor_native_register(
  p_installation uuid, p_vendor uuid, p_token text, p_secret text, p_session text,
  p_expires timestamptz, p_notifications boolean, p_sound boolean
) returns boolean language plpgsql security invoker set search_path = '' as $$
declare changed integer;
begin
  insert into public.vendor_native_devices as d
    (installation_id,vendor_id,token,secret_hash,session_hash,expires_at,notifications_enabled,sound_enabled)
  values(p_installation,p_vendor,p_token,p_secret,p_session,p_expires,p_notifications,p_sound)
  on conflict (installation_id) do update set
    vendor_id=excluded.vendor_id, token=excluded.token, session_hash=excluded.session_hash,
    expires_at=excluded.expires_at, notifications_enabled=excluded.notifications_enabled,
    sound_enabled=excluded.sound_enabled, updated_at=now(), last_error=null,
    last_order_ids=case when d.session_hash=excluded.session_hash then d.last_order_ids else '{}'::uuid[] end,
    lease_until=case when d.session_hash=excluded.session_hash then d.lease_until else '-infinity'::timestamptz end,
    lease_id=case when d.session_hash=excluded.session_hash then d.lease_id else null end,
    next_alert_at=case when d.session_hash=excluded.session_hash then d.next_alert_at else now() end
  where d.secret_hash=excluded.secret_hash;
  get diagnostics changed = row_count;
  return changed=1;
end $$;
revoke all on function public.vendor_native_register(uuid,uuid,text,text,text,timestamptz,boolean,boolean) from public,anon,authenticated;
grant execute on function public.vendor_native_register(uuid,uuid,text,text,text,timestamptz,boolean,boolean) to service_role;

-- Machine-only Vault reader. This private function cannot be reached via the Data API.
-- Only service_role can call the public SECURITY INVOKER wrapper; no end-user auth is used.
create function vendor_native_private.worker_config() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object(
    'enabled',s.enabled,
    'hook_secret',(select decrypted_secret from vault.decrypted_secrets where name='vendor_native_hook_secret' limit 1),
    'firebase',(select decrypted_secret::jsonb from vault.decrypted_secrets where name='vendor_native_firebase_service_account' limit 1)
  ) from vendor_native_private.settings s where id;
$$;
revoke all on function vendor_native_private.worker_config() from public,anon,authenticated;
grant execute on function vendor_native_private.worker_config() to service_role;
create function public.vendor_native_worker_config() returns jsonb
language sql security invoker set search_path = '' as $$ select vendor_native_private.worker_config(); $$;
revoke all on function public.vendor_native_worker_config() from public,anon,authenticated;
grant execute on function public.vendor_native_worker_config() to service_role;
create function public.vendor_native_ready() returns boolean
language sql security invoker set search_path = '' as $$
  select enabled from vendor_native_private.settings where id;
$$;
revoke all on function public.vendor_native_ready() from public,anon,authenticated;
grant execute on function public.vendor_native_ready() to service_role;

-- Only pending takeout orders inside the original five-minute window qualify.
create function public.vendor_native_pending(p_vendor uuid)
returns table(ids uuid[], expires_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select coalesce(array_agg(b.id order by b.created_at,b.id),'{}'::uuid[]), min(b.created_at+interval '5 minutes')
  from public.bookings b
  where b.vendor_id=p_vendor and b.service_type='takeout'
    and b.created_at > now()-interval '5 minutes' and b.created_at <= now()
    and lower(trim(coalesce(b.vendor_status,''))) in ('','requested','vendor_pending')
    and lower(trim(coalesce(b.status,''))) not in ('cancelled','canceled','completed','vendor_timeout','expired');
$$;
revoke all on function public.vendor_native_pending(uuid) from public,anon,authenticated;
grant execute on function public.vendor_native_pending(uuid) to service_role;

create function public.vendor_native_claim()
returns table(installation_id uuid, lease_id uuid)
language sql security invoker set search_path = '' as $$
  with candidates as (
    select d.installation_id,p.ids
    from public.vendor_native_devices d
    cross join lateral public.vendor_native_pending(d.vendor_id) p
    where (select enabled from vendor_native_private.settings where id)
      and d.notifications_enabled and d.expires_at>now() and d.lease_until<=now()
      and exists (select 1 from public.vendor_onboarding_credentials c where c.vendor_id=d.vendor_id and lower(trim(c.status)) in ('pilot','pilot_lagawe','active'))
      and ((cardinality(p.ids)>0 and (d.next_alert_at<=now() or not p.ids <@ d.last_order_ids))
        or (cardinality(p.ids)=0 and cardinality(d.last_order_ids)>0))
    order by d.next_alert_at
    limit 24 for update of d skip locked
  )
  update public.vendor_native_devices d set lease_id=gen_random_uuid(), lease_until=now()+interval '45 seconds', claimed_order_ids=c.ids
  from candidates c where d.installation_id=c.installation_id
  returning d.installation_id,d.lease_id;
$$;
revoke all on function public.vendor_native_claim() from public,anon,authenticated;
grant execute on function public.vendor_native_claim() to service_role;

-- Re-read live order/session state immediately before sending, including resolution.
create function public.vendor_native_validate_claim(p_installation uuid,p_lease uuid)
returns jsonb language sql security invoker set search_path = '' as $$
  select jsonb_build_object('token',d.token,'vendor_id',d.vendor_id,'session_hash',d.session_hash,
    'event_id',d.lease_id,'pending_count',cardinality(p.ids),'type',case when cardinality(p.ids)=0 then 'clear' else 'order' end,
    'sent_at',floor(extract(epoch from now())*1000),
    'expires_at',floor(extract(epoch from least(d.expires_at,coalesce(p.expires_at,now()+interval '30 seconds')))*1000),
    'sound_enabled',d.sound_enabled)
  from public.vendor_native_devices d cross join lateral public.vendor_native_pending(d.vendor_id) p
  where d.installation_id=p_installation and d.lease_id=p_lease and d.lease_until>now()
    and d.expires_at>now() and d.notifications_enabled
    and (select enabled from vendor_native_private.settings where id)
    and exists(select 1 from public.vendor_onboarding_credentials c where c.vendor_id=d.vendor_id and lower(trim(c.status)) in ('pilot','pilot_lagawe','active'));
$$;
revoke all on function public.vendor_native_validate_claim(uuid,uuid) from public,anon,authenticated;
grant execute on function public.vendor_native_validate_claim(uuid,uuid) to service_role;

create function public.vendor_native_finish(p_installation uuid,p_lease uuid,p_ok boolean,p_error text default null)
returns void language sql security invoker set search_path = '' as $$
  update public.vendor_native_devices set
    last_order_ids=case when p_ok then claimed_order_ids else last_order_ids end,
    last_sent_at=case when p_ok then now() else last_sent_at end,
    next_alert_at=now()+case when p_ok then interval '30 seconds' else interval '15 seconds' end,
    lease_until=case when p_ok then '-infinity'::timestamptz else now()+interval '15 seconds' end,
    lease_id=null, last_error=left(p_error,120),
    notifications_enabled=notifications_enabled and coalesce(p_error,'')<>'UNREGISTERED'
  where installation_id=p_installation and lease_id=p_lease;
$$;
revoke all on function public.vendor_native_finish(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.vendor_native_finish(uuid,uuid,boolean,text) to service_role;
