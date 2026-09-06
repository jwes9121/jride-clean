do $tests$
declare driver uuid := '82000000-0000-4000-8000-000000000001'; first_id uuid := '82000000-0000-4000-8000-000000000011'; second_id uuid := '82000000-0000-4000-8000-000000000012'; r jsonb;
begin
  insert into drivers(id) values(driver); insert into driver_profiles(driver_id) values(driver);
  perform pg_temp.check_true(not has_table_privilege('anon','agrimarket_driver_devices','select') and not has_table_privilege('authenticated','agrimarket_driver_devices','select'),'driver credential table is server-only');
  perform pg_temp.check_true((select relrowsecurity from pg_class where oid='agrimarket_driver_devices'::regclass),'driver device table has RLS');
  perform pg_temp.check_true(not has_function_privilege('authenticated','agrimarket_request_driver_device_v1(uuid,uuid,text,text,text,timestamptz)','execute'),'driver enrollment RPC is service-only');
  r := agrimarket_request_driver_device_v1(first_id,driver,'1111111111111111',repeat('a',64),'local test');
  perform pg_temp.check_true(r->>'status'='pending','UUID enrollment cannot approve itself');
  r := agrimarket_request_driver_device_v1(first_id,driver,'1111111111111111',repeat('a',64),'local test');
  perform pg_temp.check_true((select count(*)=1 from agrimarket_driver_device_events where device_credential_id=first_id),'enrollment retry is idempotent');
  perform pg_temp.expect_error(format('select agrimarket_request_driver_device_v1(%L,%L,%L,%L)',first_id,driver,'1111111111111111',repeat('b',64)),'DRIVER_DEVICE_REQUEST_CONFLICT');
  perform pg_temp.expect_error(format('select agrimarket_review_driver_device_v1(%L,%L,%L,%L,%L)',first_id,'approve','Test dispatcher','dispatcher','Driver verified'),'AGRIMARKET_ADMIN_REQUIRED');
  r := agrimarket_review_driver_device_v1(first_id,'approve','Test admin','admin','Verified driver and request code');
  perform pg_temp.check_true(r->>'status'='approved','administrator approves the matched phone');
  r := agrimarket_request_driver_device_v1(second_id,driver,'2222222222222222',repeat('b',64),'local test');
  r := agrimarket_review_driver_device_v1(second_id,'approve','Test admin','admin','Verified replacement phone');
  perform pg_temp.check_true((select status='revoked' from agrimarket_driver_devices where id=first_id),'replacement approval revokes old phone');
  perform pg_temp.check_true((select count(*)=1 from agrimarket_driver_devices where driver_id=driver and status='approved'),'only one approved device per driver');
  r := agrimarket_review_driver_device_v1(second_id,'revoke','Test admin','admin','Testing revocation');
  perform pg_temp.check_true((select count(*)=0 from agrimarket_driver_devices where driver_id=driver and status='approved'),'revocation removes driver access');
  perform pg_temp.expect_error(format('select agrimarket_review_driver_device_v1(%L,%L,%L,%L,%L)',second_id,'approve','Test admin','admin','Cannot restore old credential'),'DRIVER_DEVICE_REVOKED');
  r := agrimarket_request_driver_device_v1('82000000-0000-4000-8000-000000000013',driver,'3333333333333333',repeat('c',64),'local test');
  perform pg_temp.expect_error(format('select agrimarket_request_driver_device_v1(%L,%L,%L,%L)','82000000-0000-4000-8000-000000000014',driver,'4444444444444444',repeat('d',64)),'DRIVER_DEVICE_REQUEST_LIMIT');
  update agrimarket_driver_devices set created_at=clock_timestamp()-interval '25 hours' where id='82000000-0000-4000-8000-000000000013';
  perform pg_temp.expect_error('select agrimarket_review_driver_device_v1(''82000000-0000-4000-8000-000000000013'',''approve'',''Test admin'',''admin'',''Expired request code'')','DRIVER_DEVICE_REQUEST_EXPIRED');
  perform pg_temp.check_true(not exists(select 1 from agrimarket_driver_device_events where note like '%'||repeat('a',64)||'%'),'device review audit contains no credential hash');
end;
$tests$;
