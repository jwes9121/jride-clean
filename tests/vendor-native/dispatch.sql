-- Executed against temporary booking/credential fixtures inside a rolled-back transaction.
insert into pg_temp.vendor_test_credentials values('10000000-0000-0000-0000-000000000001','active');
insert into pg_temp.vendor_test_bookings values
('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','takeout',now()-interval '10 seconds','vendor_pending','requested'),
('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','takeout',now()-interval '5 minutes','vendor_pending','requested'),
('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','ride',now(),'vendor_pending','requested'),
('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000001','takeout',now(),'vendor_accepted','requested'),
('20000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000001','takeout',now(),'vendor_pending','cancelled'),
('20000000-0000-0000-0000-000000000006','10000000-0000-0000-0000-000000000002','takeout',now(),'vendor_pending','requested');
update vendor_native_private.settings set enabled=true;
do $$
declare
  vendor uuid := '10000000-0000-0000-0000-000000000001';
  device uuid := '30000000-0000-0000-0000-000000000001';
  lease uuid;
  n integer;
  p jsonb;
begin
  if cardinality((select ids from public.vendor_native_pending(vendor)))<>1 then raise exception 'Pending filters failed'; end if;
  if not public.vendor_native_register(device,vendor,repeat('t',40),repeat('s',64),repeat('h',64),now()+interval '1 hour',true,true) then raise exception 'Register failed'; end if;
  if public.vendor_native_register(device,vendor,repeat('u',40),repeat('x',64),repeat('h',64),now()+interval '1 hour',true,true) then raise exception 'Device takeover allowed'; end if;
  select c.lease_id into lease from public.vendor_native_claim() c;
  if lease is null then raise exception 'Initial claim failed'; end if;
  select count(*) into n from public.vendor_native_claim();
  if n<>0 then raise exception 'Duplicate lease allowed'; end if;
  p:=public.vendor_native_validate_claim(device,lease);
  if p->>'type'<>'order' or (p->>'pending_count')::integer<>1 then raise exception 'Payload invalid'; end if;
  perform public.vendor_native_finish(device,lease,true,null);
  select count(*) into n from public.vendor_native_claim();
  if n<>0 then raise exception 'Early repeat allowed'; end if;
  update public.vendor_native_devices set next_alert_at=now()-interval '1 second';
  select c.lease_id into lease from public.vendor_native_claim() c;
  if lease is null then raise exception 'Due reminder missing'; end if;
  update pg_temp.vendor_test_bookings set vendor_status='vendor_accepted' where id='20000000-0000-0000-0000-000000000001';
  p:=public.vendor_native_validate_claim(device,lease);
  if p->>'type'<>'clear' then raise exception 'Accepted order still rings'; end if;
  perform public.vendor_native_finish(device,lease,true,null);
  update pg_temp.vendor_test_bookings set vendor_status='vendor_pending' where id='20000000-0000-0000-0000-000000000001';
  update public.vendor_native_devices set next_alert_at=now()-interval '1 second';
  select c.lease_id into lease from public.vendor_native_claim() c;
  update pg_temp.vendor_test_credentials set status='suspended';
  if public.vendor_native_validate_claim(device,lease) is not null then raise exception 'Suspended vendor accepted'; end if;
  update pg_temp.vendor_test_credentials set status='active';
  update public.vendor_native_devices set expires_at=now();
  if public.vendor_native_validate_claim(device,lease) is not null then raise exception 'Expired session accepted'; end if;
  update public.vendor_native_devices set expires_at=now()+interval '1 hour';
  perform public.vendor_native_finish(device,lease,false,'UNREGISTERED');
  if (select notifications_enabled from public.vendor_native_devices where installation_id=device) then raise exception 'Invalid token not disabled'; end if;
  if has_table_privilege('anon','public.vendor_native_devices','select') or has_table_privilege('authenticated','public.vendor_native_devices','select') then raise exception 'Devices publicly readable'; end if;
  if has_function_privilege('anon','public.vendor_native_worker_config()','execute') or has_function_privilege('authenticated','public.vendor_native_claim()','execute') then raise exception 'Worker publicly callable'; end if;
  if not (select relrowsecurity from pg_class where oid='public.vendor_native_devices'::regclass) then raise exception 'RLS missing'; end if;
end $$;
