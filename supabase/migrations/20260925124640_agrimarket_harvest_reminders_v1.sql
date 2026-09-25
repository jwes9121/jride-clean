-- Apply only after the new vendor APK is installed on the pilot phones and the
-- agrimarket-native-alerts Edge Function has been upgraded. No order state changes.
-- A separate queue keeps five-minute new-order offers independent of reminders.

alter table public.agrimarket_native_devices
  add column harvest_alerts_enabled boolean not null default false;

create table public.agrimarket_harvest_alert_jobs (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.agrimarket_native_devices(installation_id) on delete cascade,
  order_id uuid not null references public.agrimarket_orders(id) on delete cascade,
  stage text not null check (stage in ('due_soon','in_window','overdue')),
  window_start_at timestamptz not null,
  window_end_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sending','sent','expired','failed')),
  attempts integer not null default 0,
  not_before timestamptz not null default now(),
  expires_at timestamptz not null,
  lease_id uuid,
  lease_until timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  unique(installation_id,order_id,stage,window_start_at,window_end_at)
);
create index agrimarket_harvest_alert_due_idx on public.agrimarket_harvest_alert_jobs(not_before)
  where status in ('pending','sending');
create index agrimarket_harvest_order_window_idx on public.agrimarket_orders(harvest_expected_start_at,harvest_expected_end_at)
  where fulfillment_mode='scheduled_harvest' and status='awaiting_harvest' and harvest_ready_at is null;
alter table public.agrimarket_harvest_alert_jobs enable row level security;
revoke all on public.agrimarket_harvest_alert_jobs from public,anon,authenticated;
grant select,insert,update on public.agrimarket_harvest_alert_jobs to service_role;

create function public.agrimarket_harvest_alert_stage_v1(p_start timestamptz,p_end timestamptz,p_now timestamptz)
returns text language sql immutable set search_path='' as $fn$
  select case
    when p_start is null or p_end is null or p_end<p_start then null
    when p_now>=p_end and p_now<p_end+interval '24 hours' then 'overdue'
    when p_now>=p_start and p_now<p_end then 'in_window'
    when p_now>=p_start-interval '30 minutes' and p_now<p_start then 'due_soon'
    else null end;
$fn$;

-- Only a validated native device, accepted reservation and unpaused harvest
-- can enter the queue. Pending customer decisions stop reminders.
create function public.agrimarket_harvest_alert_due_v1() returns boolean
language sql stable set search_path='' as $fn$
  select exists (
    select 1 from public.agrimarket_harvest_alert_jobs j
    where j.status in ('pending','sending') and j.not_before<=now() and j.expires_at>now()
      and (j.lease_until is null or j.lease_until<=now()) and j.attempts<4
  ) or exists (
    select 1 from public.agrimarket_orders o
    join public.agrimarket_native_devices d on d.producer_id=o.producer_id
    join public.agrimarket_producers p on p.id=o.producer_id and p.status='active'
    cross join lateral (select public.agrimarket_harvest_alert_stage_v1(
      o.harvest_expected_start_at,o.harvest_expected_end_at,now()) as stage) s
    where o.fulfillment_mode='scheduled_harvest' and o.status='awaiting_harvest'
      and o.harvest_ready_at is null and s.stage is not null
      and d.notifications_enabled and d.harvest_alerts_enabled and d.expires_at>now()
      and exists (select 1 from public.agrimarket_farmer_browser_sessions b
        where b.token_hash=d.session_hash and b.producer_id=d.producer_id and b.expires_at>now())
      and not exists (select 1 from public.agrimarket_harvest_proposals h
        where h.order_id=o.id and h.status='pending_customer')
      and not exists (select 1 from public.agrimarket_harvest_alert_jobs j
        where j.installation_id=d.installation_id and j.order_id=o.id and j.stage=s.stage
          and j.window_start_at=o.harvest_expected_start_at and j.window_end_at=o.harvest_expected_end_at)
    limit 1
  );
$fn$;

create function public.agrimarket_harvest_alert_claim_v1()
returns table(installation_id uuid,lease_id uuid)
language plpgsql set search_path='' as $fn$
begin
  if not coalesce((select enabled from agrimarket_native_alerts_private.settings where id),false) then return; end if;
  insert into public.agrimarket_harvest_alert_jobs
    (installation_id,order_id,stage,window_start_at,window_end_at,expires_at)
  select d.installation_id,o.id,s.stage,o.harvest_expected_start_at,o.harvest_expected_end_at,
    least(now()+interval '2 minutes',d.expires_at,
      case s.stage when 'due_soon' then o.harvest_expected_start_at
        when 'in_window' then o.harvest_expected_end_at
        else o.harvest_expected_end_at+interval '24 hours' end)
  from public.agrimarket_orders o
  join public.agrimarket_native_devices d on d.producer_id=o.producer_id
  join public.agrimarket_producers p on p.id=o.producer_id and p.status='active'
  cross join lateral (select public.agrimarket_harvest_alert_stage_v1(
    o.harvest_expected_start_at,o.harvest_expected_end_at,now()) as stage) s
  where o.fulfillment_mode='scheduled_harvest' and o.status='awaiting_harvest'
    and o.harvest_ready_at is null and s.stage is not null
    and d.notifications_enabled and d.harvest_alerts_enabled and d.expires_at>now()
    and exists (select 1 from public.agrimarket_farmer_browser_sessions b
      where b.token_hash=d.session_hash and b.producer_id=d.producer_id and b.expires_at>now())
    and not exists (select 1 from public.agrimarket_harvest_proposals h
      where h.order_id=o.id and h.status='pending_customer')
  on conflict (installation_id,order_id,stage,window_start_at,window_end_at) do nothing;
  update public.agrimarket_harvest_alert_jobs j set status='expired',last_error='DEADLINE_PASSED'
    where j.status in ('pending','sending') and j.expires_at<=now();
  return query
    with picked as (
      select j.id from public.agrimarket_harvest_alert_jobs j
      where j.status in ('pending','sending') and j.not_before<=now() and j.expires_at>now()
        and (j.lease_until is null or j.lease_until<=now()) and j.attempts<4
      order by j.not_before,j.id limit 16 for update of j skip locked
    )
    update public.agrimarket_harvest_alert_jobs j set
      status='sending',attempts=j.attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '45 seconds'
    from picked where j.id=picked.id returning j.installation_id,j.lease_id;
end;
$fn$;

create function public.agrimarket_harvest_alert_validate_v1(p_installation uuid,p_lease uuid)
returns jsonb language sql stable set search_path='' as $fn$
  select jsonb_build_object(
    'token',d.token,'producer_id',d.producer_id,'session_hash',d.session_hash,
    'event_id',j.lease_id,'pending_count',0,'type','harvest',
    'harvest_stage',j.stage,'order_code',o.order_code,
    'sent_at',floor(extract(epoch from now())*1000),
    'expires_at',floor(extract(epoch from least(j.expires_at,d.expires_at))*1000),
    'sound_enabled',d.sound_enabled)
  from public.agrimarket_harvest_alert_jobs j
  join public.agrimarket_native_devices d on d.installation_id=j.installation_id
  join public.agrimarket_orders o on o.id=j.order_id and o.producer_id=d.producer_id
  join public.agrimarket_producers p on p.id=d.producer_id
  where j.installation_id=p_installation and j.lease_id=p_lease
    and j.status='sending' and j.lease_until>now() and j.expires_at>now()
    and d.expires_at>now() and d.notifications_enabled and d.harvest_alerts_enabled and p.status='active'
    and (select enabled from agrimarket_native_alerts_private.settings where id)
    and exists (select 1 from public.agrimarket_farmer_browser_sessions b
      where b.token_hash=d.session_hash and b.producer_id=d.producer_id and b.expires_at>now())
    and o.fulfillment_mode='scheduled_harvest' and o.status='awaiting_harvest'
    and o.harvest_ready_at is null and o.harvest_expected_start_at=j.window_start_at
    and o.harvest_expected_end_at=j.window_end_at
    and j.stage=public.agrimarket_harvest_alert_stage_v1(
      o.harvest_expected_start_at,o.harvest_expected_end_at,now())
    and not exists (select 1 from public.agrimarket_harvest_proposals h
      where h.order_id=o.id and h.status='pending_customer');
$fn$;

create function public.agrimarket_harvest_alert_finish_v1(
  p_installation uuid,p_lease uuid,p_ok boolean,p_error text default null)
returns void language plpgsql set search_path='' as $fn$
begin
  update public.agrimarket_harvest_alert_jobs j set
    status=case when p_ok then 'sent'
      when p_error in ('STALE_ALERT','UNREGISTERED') or j.expires_at<=now() then 'expired'
      when j.attempts>=4 then 'failed' else 'pending' end,
    sent_at=case when p_ok then now() else j.sent_at end,
    not_before=now()+interval '15 seconds',lease_id=null,lease_until=null,
    last_error=left(p_error,120)
    where j.installation_id=p_installation and j.lease_id=p_lease and j.status='sending';
end;
$fn$;

-- Existing new-order cron remains unchanged. This one wakes the same Edge
-- sender only when a harvest job needs creation or delivery.
create function agrimarket_native_alerts_private.invoke_harvest_if_due()
returns void language plpgsql security definer set search_path='' as $fn$
declare secret text;
begin
  if not coalesce((select enabled from agrimarket_native_alerts_private.settings where id),false)
    or not public.agrimarket_harvest_alert_due_v1() then return; end if;
  select decrypted_secret into secret from vault.decrypted_secrets
    where name='agrimarket_native_hook_secret' limit 1;
  if secret is null then return; end if;
  perform net.http_post(
    url:='https://gxaullwnxbkbjqbjotsr.supabase.co/functions/v1/agrimarket-native-alerts',
    headers:=jsonb_build_object('Content-Type','application/json','x-agrimarket-native-hook',secret),
    body:='{}'::jsonb,timeout_milliseconds:=40000);
end;
$fn$;

revoke all on function public.agrimarket_harvest_alert_stage_v1(timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
revoke all on function public.agrimarket_harvest_alert_due_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_harvest_alert_claim_v1() from public,anon,authenticated;
revoke all on function public.agrimarket_harvest_alert_validate_v1(uuid,uuid) from public,anon,authenticated;
revoke all on function public.agrimarket_harvest_alert_finish_v1(uuid,uuid,boolean,text) from public,anon,authenticated;
revoke all on function agrimarket_native_alerts_private.invoke_harvest_if_due() from public,anon,authenticated;
grant execute on function public.agrimarket_harvest_alert_stage_v1(timestamptz,timestamptz,timestamptz),
  public.agrimarket_harvest_alert_due_v1(),public.agrimarket_harvest_alert_claim_v1(),
  public.agrimarket_harvest_alert_validate_v1(uuid,uuid),
  public.agrimarket_harvest_alert_finish_v1(uuid,uuid,boolean,text) to service_role;

select cron.schedule('agrimarket-harvest-reminders','* * * * *',
  'select agrimarket_native_alerts_private.invoke_harvest_if_due()');
