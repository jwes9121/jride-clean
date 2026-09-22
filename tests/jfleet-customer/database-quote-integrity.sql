-- Isolated quotation-integrity checks. No external provider or payment calls.
begin;
do $setup$
declare users uuid[];
begin
  select array_agg(user_id) into users from (select user_id from public.passenger_profiles where user_id is not null order by user_id limit 2) x;
  if array_length(users,1)<>2 then raise exception 'Two references required';end if;
  perform set_config('jfleet.test.customer',users[1]::text,true);perform set_config('jfleet.test.owner',users[2]::text,true);
end;
$setup$;
set local role service_role;
do $test$
declare
  u uuid:=current_setting('jfleet.test.customer')::uuid; o uuid:=current_setting('jfleet.test.owner')::uuid;
  p uuid; plan uuid; iq uuid; qr uuid; review uuid; ctx jsonb; old_token text; result jsonb; checks text[]:=array[]::text[];
  pts jsonb:='[{"label":"TEST pickup","lat":16.8,"lng":121.1,"notes":""},{"label":"TEST stop","lat":16.4,"lng":120.6,"notes":""}]';
  d jsonb; road jsonb:='{"provider":"mapbox","profile":"driving","geometry":{"type":"LineString","coordinates":[[121.1,16.8],[120.6,16.4]]},"distance_m":60000,"duration_s":5400}';
begin
  insert into public.jfleet_partners(partner_code,legal_name,display_name,owner_user_id,status)values('QUOTE-INTEGRITY-TEST','TEST','TEST',o,'active')returning id into p;
  d:=jsonb_build_object('purpose','family','requested_vehicle_type','van','trip_mode','one_way','scheduled_start_at',clock_timestamp()+interval '10 days','scheduled_end_at',clock_timestamp()+interval '11 days','passenger_count',4);
  plan:=(public.jfleet_begin_route_plan_v1(u,pts)->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route=road where id=plan;
  iq:=(public.jfleet_submit_route_plan_v1(plan,u,pts,d)->>'inquiry_id')::uuid;
  ctx:=public.jfleet_owner_route_context_v1(iq,o);
  review:=(public.jfleet_owner_review_route_v1(iq,o,ctx->>'snapshot_hash','approved','Test approval',true)->>'review_id')::uuid;
  qr:=(public.jfleet_owner_send_reviewed_quote_v1(iq,o,review,10000,clock_timestamp()+interval '2 seconds','Vehicle','Parking','None','Test fuel',
    '[{"label":"Vehicle","item_type":"vehicle_hire","amount":10000,"included":true}]')->>'quote_id')::uuid;
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);old_token:=ctx->>'context_token';
  insert into public.jfleet_quote_items(quote_id,sequence_no,item_type,label,amount,included)values(qr,1,'other','Clarification added',0,true);
  begin perform public.jfleet_customer_accept_quote_v2(iq,qr,u,old_token,true);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_CONTEXT_STALE' then raise;end if;end;
  checks:=array_append(checks,'line-item insertion invalidates earlier customer consent');
  begin update public.jfleet_quote_items set label='Mutated' where quote_id=qr;raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_QUOTE_ITEMS_IMMUTABLE' then raise;end if;end;
  checks:=array_append(checks,'existing quoted line items cannot be rewritten');
  perform pg_sleep(2.1);
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);
  if ctx->>'actionable_quote_id' is not null or ctx#>>'{quotes,0,display_status}'<>'expired' then raise exception 'expired UI';end if;
  begin perform public.jfleet_customer_accept_quote_v2(iq,qr,u,ctx->>'context_token',true);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_QUOTE_EXPIRED' then raise;end if;end;
  checks:=array_append(checks,'expired quotation cannot create a booking and displays expired');
  qr:=(public.jfleet_owner_send_reviewed_quote_v1(iq,o,review,12000,clock_timestamp()+interval '1 day','Vehicle driver fuel','Parking','New quote','Test fuel','[]')->>'quote_id')::uuid;
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);
  result:=public.jfleet_customer_accept_quote_v2(iq,qr,u,ctx->>'context_token',true);
  if (result->>'reservation_required_amount')::numeric<>2400 then raise exception 'minimum deposit';end if;
  begin insert into public.jfleet_quote_items(quote_id,sequence_no,item_type,label,amount,included)values(qr,1,'other','After acceptance',0,true);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_QUOTE_ITEMS_CLOSED' then raise;end if;end;
  checks:=array_append(checks,'accepted quotation breakdown cannot gain extra items');
  perform set_config('jfleet.test.results',jsonb_build_object('passed',array_length(checks,1),'checks',to_jsonb(checks),'role',current_user,'rollback',true)::text,true);
end;
$test$;
select current_setting('jfleet.test.results')::jsonb as result;
rollback;
