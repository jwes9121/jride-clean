-- Run ONLY inside BEGIN/ROLLBACK after the migration, against the named demo account.
-- No real orders, sends, payments or driver assignments are created by these checks.
do $tests$
declare
  v_owner uuid := '7219cecb-073f-42db-b9d9-8a4e23c0c79a';
  v_other uuid := 'cc0c4ae4-68ec-482b-8a2d-4848d2a91bc5';
  v_sub uuid; v_job uuid; v_lease uuid; v_count integer; v_blocked boolean;
begin
  if not exists(select 1 from public.agrimarket_producers where id=v_owner and contact_name='DEMO ONLY - AgriMarket Test Farm')
    then raise exception 'Demo account identity mismatch'; end if;
  if has_function_privilege('anon','public.agrimarket_browser_config_v1()','execute')
    or has_function_privilege('authenticated','public.agrimarket_browser_claim_v1(uuid,integer)','execute')
    or has_table_privilege('anon','public.agrimarket_browser_alert_jobs','insert')
    then raise exception 'Public access not blocked'; end if;
  update agrimarket_alerts_private.settings set enabled=true where id;
  v_sub := (public.agrimarket_browser_subscribe_v1(v_owner,
    'https://fcm.googleapis.com/fcm/send/AGRIMARKET-TRANSACTION-TEST','B'||repeat('A',86),repeat('A',22))->>'id')::uuid;
  if not (public.agrimarket_browser_status_v1(v_owner,v_sub)->>'active')::boolean then raise exception 'Subscription not active'; end if;
  if public.agrimarket_browser_status_v1(v_other,v_sub) is not null then raise exception 'Cross-farm status exposed'; end if;
  v_blocked:=false;
  begin perform public.agrimarket_browser_action_v1(v_other,v_sub,'test'); exception when others then v_blocked:=true; end;
  if not v_blocked then raise exception 'Cross-farm test allowed'; end if;
  v_job := (public.agrimarket_browser_action_v1(v_owner,v_sub,'test')->>'test_id')::uuid;
  if (select order_id is not null from public.agrimarket_browser_alert_jobs where id=v_job) then raise exception 'Test linked to order'; end if;
  v_blocked:=false;
  begin perform public.agrimarket_browser_action_v1(v_owner,v_sub,'test'); exception when others then v_blocked:=true; end;
  if not v_blocked then raise exception 'Test rate limit missing'; end if;
  update public.agrimarket_browser_alert_jobs set not_before=now()-interval '1 second' where id=v_job;
  select lease_id into v_lease from public.agrimarket_browser_claim_v1(v_owner,10) where id=v_job;
  if v_lease is null then raise exception 'No job lease'; end if;
  if public.agrimarket_browser_validate_v1(v_job,v_lease) is null then raise exception 'Valid job rejected'; end if;
  select count(*) into v_count from public.agrimarket_browser_claim_v1(v_owner,10) where id=v_job;
  if v_count<>0 then raise exception 'Duplicate lease'; end if;
  update public.agrimarket_browser_subscriptions set credential_version='old-pin-version' where id=v_sub;
  if public.agrimarket_browser_validate_v1(v_job,v_lease) is not null then raise exception 'Old PIN version accepted'; end if;
  perform public.agrimarket_browser_finish_v1(v_job,v_lease,'STALE');
  if (select status from public.agrimarket_browser_alert_jobs where id=v_job)<>'expired' then raise exception 'Stale job not expired'; end if;
  perform public.agrimarket_browser_action_v1(v_owner,v_sub,'unsubscribe');
  if (public.agrimarket_browser_status_v1(v_owner,v_sub)->>'active')::boolean then raise exception 'Unsubscribe failed'; end if;
end;
$tests$;
