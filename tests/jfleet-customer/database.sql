-- Run only as a transaction on the dormant JFleet schema. All fixtures roll back.
-- Reuses two existing auth references without modifying users, profiles or logins.
begin;
do $setup$
declare users uuid[];
begin
  select array_agg(user_id) into users from (select user_id from public.passenger_profiles where user_id is not null order by user_id limit 2) x;
  if array_length(users,1)<>2 then raise exception 'Two existing test references required'; end if;
  perform set_config('jfleet.test.customer',users[1]::text,true);
  perform set_config('jfleet.test.owner',users[2]::text,true);
end;
$setup$;
set local role service_role;
do $test$
declare
  u uuid:=current_setting('jfleet.test.customer')::uuid; o uuid:=current_setting('jfleet.test.owner')::uuid;
  partner uuid; iq uuid; other_iq uuid; p0 uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; foreign_plan uuid;
  q0 uuid; q1 uuid; rid uuid; result jsonb; ctx jsonb; owner_ctx jsonb; original_snapshot jsonb;
  token0 text; token1 text; token2 text; d jsonb; d1 jsonb; d2 jsonb;
  points jsonb:='[{"label":"TEST Pickup","lat":16.8,"lng":121.1,"notes":"Pickup instructions"},{"label":"TEST Destination","lat":16.4,"lng":120.6,"notes":"Stop here"},{"label":"TEST Pickup","lat":16.8,"lng":121.1,"notes":"Return to pickup"}]';
  changed_points jsonb;
  road jsonb:='{"provider":"mapbox","profile":"driving","geometry":{"type":"LineString","coordinates":[[121.1,16.8],[120.6,16.4],[121.1,16.8]]},"distance_m":120000,"duration_s":10800,"snapped_points":[]}';
  checks text[]:=array[]::text[];
begin
  insert into public.jfleet_partners(partner_code,legal_name,display_name,owner_user_id,status,quote_tat_minutes)
    values('CUSTOMER-REVISION-TEST','TEST ONLY','TEST ONLY',o,'active',180) returning id into partner;
  d:=jsonb_build_object('purpose','family','requested_vehicle_type','van','trip_mode','round_trip',
    'scheduled_start_at',clock_timestamp()+interval '10 days','scheduled_end_at',clock_timestamp()+interval '11 days',
    'passenger_count',8,'cargo_weight_kg',null,'cargo_description',null,'luggage_notes','8 bags','special_notes','Original request');
  p0:=(public.jfleet_begin_route_plan_v1(u,points)->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route=road where id=p0;
  iq:=(public.jfleet_submit_route_plan_v1(p0,u,points,d)->>'inquiry_id')::uuid;
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);token0:=ctx->>'context_token';
  if not (ctx->>'can_revise')::boolean or ctx->>'actionable_quote_id' is not null then raise exception 'initial context';end if;
  checks:=array_append(checks,'initial inquiry readable with no invented quote');
  begin perform public.jfleet_customer_inquiry_v1(iq,o);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND' then raise;end if;end;
  checks:=array_append(checks,'foreign customer cannot read inquiry');
  owner_ctx:=public.jfleet_owner_route_context_v1(iq,o);
  rid:=(public.jfleet_owner_review_route_v1(iq,o,owner_ctx->>'snapshot_hash','approved','Initial owner review',true)->>'review_id')::uuid;
  original_snapshot:=public.jfleet_route_snapshot_v1(iq);
  q0:=(public.jfleet_owner_send_reviewed_quote_v1(iq,o,rid,10000,clock_timestamp()+interval '1 day','Vehicle driver and fuel','Parking and tolls','Original price note','Quoted fuel basis',
    '[{"item_type":"vehicle_hire","label":"Vehicle","amount":6000,"included":true},{"item_type":"fuel","label":"Fuel","amount":4000,"included":true},{"item_type":"toll_parking","label":"Parking estimate","amount":200,"included":false}]')->>'quote_id')::uuid;
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);token1:=ctx->>'context_token';
  if ctx#>>'{quotes,0,inclusions}'<>'Vehicle driver and fuel' or ctx#>>'{quotes,0,exclusions}'<>'Parking and tolls'
     or jsonb_array_length(ctx#>'{quotes,0,items}')<>3 or (ctx#>>'{quotes,0,reservation_required_amount}')::numeric<>2000
     or (ctx->>'actionable_quote_id')::uuid<>q0 or ctx#>>'{quotes,0,fuel_basis_note}'<>'Quoted fuel basis' then raise exception 'full quotation';end if;
  checks:=array_append(checks,'full quotation items exclusions fuel notes and 20 percent deposit shown');
  if ctx#>'{snapshot,passenger_user_id}' is not null or ctx#>'{quotes,0,snapshot,partner_id}' is not null then raise exception 'unnecessary identity exposure';end if;
  checks:=array_append(checks,'customer snapshots omit internal account identities');
  changed_points:=jsonb_set(points,'{1,label}','"TEST Revised Destination"');
  d1:=d||jsonb_build_object('passenger_count',10,'luggage_notes','10 bags');
  p1:=(public.jfleet_begin_route_plan_v1(u,changed_points)->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route=road where id=p1;
  begin perform public.jfleet_resubmit_inquiry_v1(iq,o,p1,changed_points,d1,token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND' then raise;end if;end;
  checks:=array_append(checks,'foreign customer cannot revise inquiry');
  foreign_plan:=(public.jfleet_begin_route_plan_v1(o,changed_points)->>'id')::uuid;
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,foreign_plan,changed_points,d1,token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_ROUTE_PLAN_NOT_FOUND' then raise;end if;end;
  checks:=array_append(checks,'foreign route preview rejected');
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token0,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_CONTEXT_STALE' then raise;end if;end;
  checks:=array_append(checks,'new owner quotation invalidates stale revision screen');
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,points,d1,token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_ROUTE_PLAN_CHANGED' then raise;end if;end;
  checks:=array_append(checks,'edited pins require matching preview');
  update public.jfleet_route_plans set expires_at=clock_timestamp()-interval '1 minute' where id=p1;
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_ROUTE_PLAN_EXPIRED' then raise;end if;end;
  update public.jfleet_route_plans set expires_at=clock_timestamp()+interval '20 minutes',status='building' where id=p1;
  checks:=array_append(checks,'expired preview rejected');
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_ROUTE_NOT_READY' then raise;end if;end;
  update public.jfleet_route_plans set status='ready' where id=p1;
  checks:=array_append(checks,'unfinished route preview rejected');
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token1,' ');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_REVISION_INPUT_INVALID' then raise;end if;end;
  checks:=array_append(checks,'revision reason required');
  begin perform public.jfleet_customer_accept_quote_v2(iq,q0,u,token1,false);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_TERMS_REQUIRED' then raise;end if;end;
  checks:=array_append(checks,'quote acceptance requires explicit terms acknowledgment');
  result:=public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token1,'Changed group');
  if (result->>'inquiry_id')::uuid<>iq or (result->>'itinerary_version')::int<>2
     or (select count(*) from public.jfleet_inquiries where id=iq)<>1
     or (select count(*) from public.jfleet_bookings where inquiry_id=iq)<>0 then raise exception 'same inquiry';end if;
  checks:=array_append(checks,'revision keeps one inquiry and creates no booking');
  if (select status from public.jfleet_quotes where id=q0)<>'superseded'
     or (select snapshot from public.jfleet_route_reviews where id=rid) is distinct from original_snapshot
     or (select rp.points from public.jfleet_route_plans rp where rp.id=p0) is distinct from points then raise exception 'history damaged';end if;
  checks:=array_append(checks,'old quotation superseded and original review and pins retained');
  if abs(extract(epoch from (result->>'quote_due_at')::timestamptz-clock_timestamp())-10800)>10 then raise exception 'wrong turnaround';end if;
  checks:=array_append(checks,'three-hour response window restarted on revision');
  result:=public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1,token1,'Changed group');
  if not (result->>'already_submitted')::boolean or (select count(*) from public.jfleet_inquiry_revisions where inquiry_id=iq)<>1 then raise exception 'duplicate retry';end if;
  checks:=array_append(checks,'lost-response retry returns original revision without duplicates');
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p1,changed_points,d1||'{"passenger_count":11}',token1,'Changed group');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_REVISION_RETRY_CONFLICT' then raise;end if;end;
  checks:=array_append(checks,'changed retry payload rejected');
  begin perform public.jfleet_require_route_review_v1(iq,rid);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_ROUTE_REVIEW_STALE' then raise;end if;end;
  checks:=array_append(checks,'new itinerary requires fresh owner approval');
  begin perform public.jfleet_accept_quote_v1(iq,q0,u,'TEST-OLD',clock_timestamp());raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_QUOTE_NOT_ACCEPTABLE' then raise;end if;end;
  checks:=array_append(checks,'legacy acceptance cannot accept superseded quote');
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);token2:=ctx->>'context_token';
  owner_ctx:=public.jfleet_owner_route_context_v1(iq,o);
  perform public.jfleet_owner_review_route_v1(iq,o,owner_ctx->>'snapshot_hash','changes_requested','Clarify luggage and departure',false);
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);
  if ctx#>>'{reviews,0,notes}'<>'Clarify luggage and departure' or not (ctx->>'can_revise')::boolean then raise exception 'feedback missing';end if;
  checks:=array_append(checks,'owner change request and explanation visible to customer');
  p2:=(public.jfleet_begin_route_plan_v1(u,changed_points)->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route=road where id=p2;
  d2:=d1||'{"luggage_notes":"10 small bags","special_notes":"Confirmed departure details"}';
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p2,changed_points,d2,token2,'Clarified luggage');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_CONTEXT_STALE' then raise;end if;end;
  checks:=array_append(checks,'owner change request invalidates another open editing screen');
  result:=public.jfleet_resubmit_inquiry_v1(iq,u,p2,changed_points,d2,ctx->>'context_token','Clarified luggage');
  if (result->>'itinerary_version')::int<>3 or (select count(*) from public.jfleet_route_plans where inquiry_id=iq)<>3 then raise exception 'third version';end if;
  checks:=array_append(checks,'multiple revision rounds preserve all three route plans');
  begin delete from public.jfleet_inquiry_revisions where inquiry_id=iq;raise exception 'MUST_FAIL';exception when others then if sqlerrm not like '%permission denied%' and sqlerrm<>'JFLEET_REVISION_IMMUTABLE' then raise;end if;end;
  checks:=array_append(checks,'revision audit cannot be erased by server role');
  owner_ctx:=public.jfleet_owner_route_context_v1(iq,o);
  rid:=(public.jfleet_owner_review_route_v1(iq,o,owner_ctx->>'snapshot_hash','approved','Revised route approved',true)->>'review_id')::uuid;
  q1:=(public.jfleet_owner_send_reviewed_quote_v1(iq,o,rid,18000,clock_timestamp()+interval '1 day','Vehicle driver fuel','Tolls','Revised price','New fuel basis','[]')->>'quote_id')::uuid;
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);token2:=ctx->>'context_token';
  update public.jfleet_partners set reservation_percent=30 where id=partner;
  begin perform public.jfleet_customer_accept_quote_v2(iq,q1,u,token2,true);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_CONTEXT_STALE' then raise;end if;end;
  update public.jfleet_partners set reservation_percent=20 where id=partner;
  checks:=array_append(checks,'changed payment terms invalidate stale customer consent');
  perform set_config('TimeZone','UTC',true);token2:=public.jfleet_customer_state_token_v1(iq);
  perform set_config('TimeZone','Asia/Manila',true);
  if token2<>public.jfleet_customer_state_token_v1(iq) then raise exception 'timezone token drift';end if;
  checks:=array_append(checks,'context token stable across database timezones');
  result:=public.jfleet_customer_accept_quote_v2(iq,q1,u,token2,true);
  if result->>'status'<>'reservation_pending' or (result->>'reservation_required_amount')::numeric<>3600
     or (select quoted_route_plan_id from public.jfleet_bookings where inquiry_id=iq)<>p2 then raise exception 'acceptance binding';end if;
  checks:=array_append(checks,'accepted revised quotation retains route v3 and 20 percent minimum');
  result:=public.jfleet_customer_accept_quote_v2(iq,q1,u,token2,true);
  if not (result->>'already_converted')::boolean or (select count(*) from public.jfleet_bookings where inquiry_id=iq)<>1
     or (select count(*) from public.jfleet_events where inquiry_id=iq and event_type='quote_terms_acknowledged')<>1 then raise exception 'accept duplicate';end if;
  checks:=array_append(checks,'acceptance retry creates one booking and one consent event');
  begin perform public.jfleet_customer_accept_quote_v2(iq,q0,u,token2,true);raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_ACCEPT_CONFLICT' then raise;end if;end;
  checks:=array_append(checks,'different quote cannot masquerade as already accepted');
  p3:=(public.jfleet_begin_route_plan_v1(u,changed_points)->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route=road where id=p3;
  begin perform public.jfleet_resubmit_inquiry_v1(iq,u,p3,changed_points,d2,token2,'After accepted');raise exception 'MUST_FAIL';exception when others then if sqlerrm<>'JFLEET_CUSTOMER_REVISION_CLOSED' then raise;end if;end;
  checks:=array_append(checks,'accepted booking cannot be edited through inquiry revision');
  ctx:=public.jfleet_customer_inquiry_v1(iq,u);
  if (ctx->>'can_revise')::boolean or ctx->>'actionable_quote_id' is not null or jsonb_array_length(ctx->'quotes')<>2 then raise exception 'accepted view';end if;
  checks:=array_append(checks,'full quotation history remains visible after acceptance');
  other_iq:=(public.jfleet_submit_route_plan_v1(p3,u,changed_points,d2)->>'inquiry_id')::uuid;
  if other_iq=iq then raise exception 'independent inquiry conflict';end if;
  checks:=array_append(checks,'customer may keep another independent canvassing inquiry');
  perform set_config('jfleet.test.results',jsonb_build_object('role',current_user,'passed',array_length(checks,1),'checks',to_jsonb(checks),'fixtures','rollback','map_provider','mocked')::text,true);
end;
$test$;
select current_setting('jfleet.test.results')::jsonb as result;
rollback;
