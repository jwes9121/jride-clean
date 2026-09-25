-- An omitted finish means a one-hour estimated preparation window. New
-- listings persist the end time; this also covers reservations made earlier.
-- Keep native reminder jobs distinct from the five-minute new-order alerts.
create or replace function public.agrimarket_harvest_alert_stage_v1(
  p_start timestamptz,p_end timestamptz,p_now timestamptz
) returns text language sql immutable set search_path='' as $fn$
  select case
    when p_start is null or coalesce(p_end,p_start+interval '1 hour')<p_start then null
    when p_now>=coalesce(p_end,p_start+interval '1 hour')
      and p_now<coalesce(p_end,p_start+interval '1 hour')+interval '24 hours' then 'overdue'
    when p_now>=p_start and p_now<coalesce(p_end,p_start+interval '1 hour') then 'in_window'
    when p_now>=p_start-interval '30 minutes' and p_now<p_start then 'due_soon'
    else null end;
$fn$;

create or replace function public.agrimarket_harvest_alert_due_v1()
returns boolean language sql stable set search_path='' as $fn$
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
          and j.window_start_at=o.harvest_expected_start_at
          and j.window_end_at=coalesce(o.harvest_expected_end_at,o.harvest_expected_start_at+interval '1 hour'))
    limit 1
  );
$fn$;

create or replace function public.agrimarket_harvest_alert_claim_v1()
returns table(installation_id uuid,lease_id uuid)
language plpgsql set search_path='' as $fn$
begin
  if not coalesce((select enabled from agrimarket_native_alerts_private.settings where id),false) then return; end if;
  insert into public.agrimarket_harvest_alert_jobs
    (installation_id,order_id,stage,window_start_at,window_end_at,expires_at)
  select d.installation_id,o.id,s.stage,o.harvest_expected_start_at,
    coalesce(o.harvest_expected_end_at,o.harvest_expected_start_at+interval '1 hour'),
    least(now()+interval '2 minutes',d.expires_at,
      case s.stage when 'due_soon' then o.harvest_expected_start_at
        when 'in_window' then coalesce(o.harvest_expected_end_at,o.harvest_expected_start_at+interval '1 hour')
        else coalesce(o.harvest_expected_end_at,o.harvest_expected_start_at+interval '1 hour')+interval '24 hours' end)
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

create or replace function public.agrimarket_harvest_alert_validate_v1(p_installation uuid,p_lease uuid)
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
    and coalesce(o.harvest_expected_end_at,o.harvest_expected_start_at+interval '1 hour')=j.window_end_at
    and j.stage=public.agrimarket_harvest_alert_stage_v1(
      o.harvest_expected_start_at,o.harvest_expected_end_at,now())
    and not exists (select 1 from public.agrimarket_harvest_proposals h
      where h.order_id=o.id and h.status='pending_customer');
$fn$;
