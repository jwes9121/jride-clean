-- Apply only after schema.sql and the authenticated edge function are verified.
-- Dispatch remains disabled until settings.enabled is explicitly set to true.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$ begin
  if not exists(select 1 from vault.secrets where name='vendor_native_hook_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'vendor_native_hook_secret');
  end if;
end $$;

create function vendor_native_private.invoke_if_due() returns void
language plpgsql security definer set search_path = '' as $$
declare secret text;
begin
  if not exists(select 1 from vendor_native_private.settings where id and enabled) then return; end if;
  if not exists(
    select 1 from public.vendor_native_devices d
    cross join lateral public.vendor_native_pending(d.vendor_id) p
    where d.notifications_enabled and d.expires_at>now() and d.lease_until<=now()
    and ((cardinality(p.ids)>0 and (d.next_alert_at<=now() or not p.ids <@ d.last_order_ids))
      or (cardinality(p.ids)=0 and cardinality(d.last_order_ids)>0))
  ) then return; end if;
  select decrypted_secret into secret from vault.decrypted_secrets where name='vendor_native_hook_secret' limit 1;
  if secret is null then return; end if;
  perform net.http_post(
    url:='https://gxaullwnxbkbjqbjotsr.supabase.co/functions/v1/vendor-native-alerts',
    headers:=jsonb_build_object('Content-Type','application/json','x-vendor-native-hook',secret),
    body:='{}'::jsonb, timeout_milliseconds:=40000);
end $$;
revoke all on function vendor_native_private.invoke_if_due() from public,anon,authenticated,service_role;

create function vendor_native_private.booking_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.service_type='takeout' and new.vendor_id is not null then
    perform vendor_native_private.invoke_if_due();
  end if;
  return new;
exception when others then
  -- Push must never roll back a customer order. The scheduled retry catches up.
  raise warning 'Vendor notification dispatch deferred';
  return new;
end $$;
revoke all on function vendor_native_private.booking_changed() from public,anon,authenticated,service_role;
create trigger vendor_native_booking_alert after insert or update of vendor_status,status on public.bookings
for each row execute function vendor_native_private.booking_changed();

select cron.schedule('vendor-native-alerts-due','5 seconds','select vendor_native_private.invoke_if_due()');
-- The due time is 30 seconds after sending. The five-second scheduler adds up to
-- five seconds of scheduling jitter; FCM/network/Android can add delivery delay.
