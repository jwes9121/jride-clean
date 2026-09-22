-- Set session settings jfleet.test_owner_id and jfleet.test_passenger_id to
-- dedicated test auth identities before running. Mock route geometry only.
begin;
set local role service_role;
do $test$
#variable_conflict use_variable
declare
  owner_id uuid:=current_setting('jfleet.test_owner_id')::uuid;
  passenger_id uuid:=current_setting('jfleet.test_passenger_id')::uuid;
  partner_id uuid; plan_id uuid; inquiry_id uuid; itinerary_id uuid; review_id uuid; old_review_id uuid; quote_id uuid; booking_id uuid;
  pts jsonb:='[{"label":"TEST pickup","lat":16.8,"lng":121.1,"notes":"Pickup instructions"},{"label":"TEST stop","lat":16.9,"lng":121.2,"notes":""},{"label":"TEST return","lat":16.8,"lng":121.1,"notes":""}]';
  details jsonb; context jsonb; out jsonb; commands jsonb; cmd jsonb; passed jsonb:='[]'; got text;
  start_at timestamptz:=clock_timestamp()+interval '30 days'; expiry timestamptz:=clock_timestamp()+interval '1 day';
begin
  insert into public.jfleet_partners(partner_code,legal_name,display_name,owner_user_id,status,is_priority_pilot)
    values('REVIEW-TEST-'||gen_random_uuid(),'TEST ONLY','TEST ONLY',owner_id,'active',true) returning id into partner_id;
  details:=jsonb_build_object('purpose','family','requested_vehicle_type','van','trip_mode','round_trip','scheduled_start_at',start_at,'scheduled_end_at',start_at+interval '1 day','passenger_count',4,'cargo_weight_kg',null,'cargo_description',null,'luggage_notes','Two bags','special_notes','Test fixture');
  out:=public.jfleet_begin_route_plan_v1(passenger_id,pts); plan_id:=(out->>'id')::uuid;
  update public.jfleet_route_plans set status='ready',route='{"provider":"mapbox","profile":"driving","geometry":{"type":"LineString","coordinates":[[121.1,16.8],[121.2,16.9],[121.1,16.8]]},"distance_m":24000,"duration_s":1800,"snapped_points":[]}' where id=plan_id;
  out:=public.jfleet_submit_route_plan_v1(plan_id,passenger_id,pts,details); inquiry_id:=(out->>'inquiry_id')::uuid;
  context:=public.jfleet_owner_route_context_v1(inquiry_id,owner_id); itinerary_id:=(context#>>'{snapshot,itinerary_id}')::uuid;
  assert context#>'{snapshot,points}'=pts,'saved route/pickup notes changed';
  passed:=passed||jsonb_build_array('saved route and pickup notes retained');
  commands:=jsonb_build_array(
    jsonb_build_object('name','foreign owner read rejected','sql',format('select public.jfleet_owner_route_context_v1(%L,%L)',inquiry_id,passenger_id),'error','JFLEET_OWNER_INQUIRY_NOT_FOUND'),
    jsonb_build_object('name','foreign owner approval rejected','sql',format('select public.jfleet_owner_review_route_v1(%L,%L,%L,''approved'','''',true)',inquiry_id,passenger_id,context->>'snapshot_hash'),'error','JFLEET_OWNER_INQUIRY_NOT_FOUND'),
    jsonb_build_object('name','stale screen fingerprint rejected','sql',format('select public.jfleet_owner_review_route_v1(%L,%L,%L,''approved'','''',true)',inquiry_id,owner_id,repeat('0',64)),'error','JFLEET_ROUTE_REVIEW_STALE'),
    jsonb_build_object('name','missing acknowledgment rejected','sql',format('select public.jfleet_owner_review_route_v1(%L,%L,%L,''approved'','''',false)',inquiry_id,owner_id,context->>'snapshot_hash'),'error','JFLEET_ROUTE_REVIEW_INPUT_INVALID'),
    jsonb_build_object('name','unexplained change request rejected','sql',format('select public.jfleet_owner_review_route_v1(%L,%L,%L,''changes_requested'','''',false)',inquiry_id,owner_id,context->>'snapshot_hash'),'error','JFLEET_ROUTE_REVIEW_INPUT_INVALID'),
    jsonb_build_object('name','legacy quotation cannot skip review','sql',format('select public.jfleet_owner_send_quote_v1(%L,%L,10000,%L,null,null,null,null)',inquiry_id,owner_id,expiry),'error','JFLEET_ROUTE_REVIEW_REQUIRED'),
    jsonb_build_object('name','submitted route mutation rejected','sql',format('update public.jfleet_route_plans set route=''{}'' where id=%L',plan_id),'error','JFLEET_SUBMITTED_ROUTE_IMMUTABLE'),
    jsonb_build_object('name','pinned stop mutation rejected','sql',format('update public.jfleet_itinerary_stops set lat=15 where itinerary_id=%L',itinerary_id),'error','JFLEET_PINNED_STOPS_IMMUTABLE'),
    jsonb_build_object('name','pinned itinerary unlink rejected','sql',format('update public.jfleet_itineraries set route_plan_id=null where id=%L',itinerary_id),'error','JFLEET_PINNED_ITINERARY_IMMUTABLE')
  );
  for cmd in select value from jsonb_array_elements(commands) loop
    got:=null;
    begin execute cmd->>'sql'; exception when others then got:=sqlerrm; end;
    if got is distinct from cmd->>'error' then raise exception 'TEST %: expected %, received %',cmd->>'name',cmd->>'error',got; end if;
    passed:=passed||jsonb_build_array(cmd->>'name');
  end loop;
  out:=public.jfleet_owner_review_route_v1(inquiry_id,owner_id,context->>'snapshot_hash','approved','Checked',true); review_id:=(out->>'review_id')::uuid;
  out:=public.jfleet_owner_review_route_v1(inquiry_id,owner_id,context->>'snapshot_hash','approved','Checked',true);
  assert (out->>'already_recorded')::boolean and (out->>'review_id')::uuid=review_id,'approval retry not idempotent';
  passed:=passed||jsonb_build_array('same review retry returns original approval');
  perform set_config('TimeZone','America/New_York',true);
  out:=public.jfleet_owner_route_context_v1(inquiry_id,owner_id);
  assert out->>'snapshot_hash'=context->>'snapshot_hash','timezone changed fingerprint';
  perform set_config('TimeZone','UTC',true);
  passed:=passed||jsonb_build_array('snapshot stable across session timezones');
  out:=public.jfleet_owner_send_reviewed_quote_v1(inquiry_id,owner_id,review_id,10000,expiry,'Vehicle and fuel','Tolls',null,null);
  quote_id:=(out->>'quote_id')::uuid;
  assert (select q.route_review_id=review_id from public.jfleet_quotes q where q.id=quote_id),'quote review binding missing';
  passed:=passed||jsonb_build_array('quotation bound to exact approval');
  commands:=jsonb_build_array(
    jsonb_build_object('name','review history mutation rejected','sql',format('update public.jfleet_route_reviews set notes=''replacement'' where id=%L',review_id),'error','JFLEET_ROUTE_REVIEW_IMMUTABLE'),
    jsonb_build_object('name','quoted terms cannot be overwritten','sql',format('update public.jfleet_quotes set total_amount=9000 where id=%L',quote_id),'error','JFLEET_QUOTE_IMMUTABLE_CREATE_REVISION'),
    jsonb_build_object('name','missing quote review token rejected','sql',format('select public.jfleet_owner_send_reviewed_quote_v1(%L,%L,null,10000,%L,null,null,null,null)',inquiry_id,owner_id,expiry),'error','JFLEET_ROUTE_REVIEW_REQUIRED')
  );
  for cmd in select value from jsonb_array_elements(commands) loop
    got:=null; begin execute cmd->>'sql'; exception when others then got:=sqlerrm; end;
    if got is distinct from cmd->>'error' then raise exception 'TEST %: expected %, received %',cmd->>'name',cmd->>'error',got; end if;
    passed:=passed||jsonb_build_array(cmd->>'name');
  end loop;
  update public.jfleet_inquiries set special_notes='Changed on another device' where id=inquiry_id;
  got:=null;
  begin perform public.jfleet_accept_quote_v1(inquiry_id,quote_id,passenger_id,'REVIEW-BOOKING-'||gen_random_uuid()); exception when others then got:=sqlerrm; end;
  assert got='JFLEET_ROUTE_REVIEW_STALE','changed details accepted';
  assert not exists(select 1 from public.jfleet_bookings b where b.inquiry_id=inquiry_id and b.accepted_quote_id=quote_id),'failed acceptance created booking';
  passed:=passed||jsonb_build_array('changed trip details block acceptance with no booking');
  old_review_id:=review_id;
  context:=public.jfleet_owner_route_context_v1(inquiry_id,owner_id);
  assert context->>'approved_review_id' is null,'stale approval still displayed';
  out:=public.jfleet_owner_review_route_v1(inquiry_id,owner_id,context->>'snapshot_hash','changes_requested','Confirm the additional requirements',false);
  assert (select q.status='withdrawn' from public.jfleet_quotes q where q.id=quote_id),'old quotation not withdrawn';
  got:=null; begin perform public.jfleet_owner_send_reviewed_quote_v1(inquiry_id,owner_id,old_review_id,10000,expiry,null,null,null,null); exception when others then got:=sqlerrm; end;
  assert got='JFLEET_ROUTE_REVIEW_REQUIRED','changes_requested still quotable';
  passed:=passed||jsonb_build_array('request changes withdraws unaccepted quote and blocks quoting');
  out:=public.jfleet_owner_review_route_v1(inquiry_id,owner_id,context->>'snapshot_hash','approved','New details reviewed',true); review_id:=(out->>'review_id')::uuid;
  got:=null; begin perform public.jfleet_owner_send_reviewed_quote_v1(inquiry_id,owner_id,old_review_id,10000,expiry,null,null,null,null); exception when others then got:=sqlerrm; end;
  assert got='JFLEET_ROUTE_REVIEW_STALE','old approval token accepted';
  passed:=passed||jsonb_build_array('superseded approval token rejected');
  out:=public.jfleet_owner_send_reviewed_quote_v1(inquiry_id,owner_id,review_id,10000,expiry,'Vehicle and fuel','Tolls',null,null); quote_id:=(out->>'quote_id')::uuid;
  out:=public.jfleet_accept_quote_v1(inquiry_id,quote_id,passenger_id,'REVIEW-BOOKING-'||gen_random_uuid()); booking_id:=(out->>'booking_id')::uuid;
  assert (select b.route_review_id=review_id and b.quoted_route_plan_id=plan_id and b.reservation_required_amount=2000 and b.status='reservation_pending' from public.jfleet_bookings b where b.id=booking_id),'booking binding or deposit wrong';
  passed:=passed||jsonb_build_array('accepted booking retains reviewed route and 20 percent deposit');
  got:=null; begin update public.jfleet_bookings set quoted_route_plan_id=null where id=booking_id; exception when others then got:=sqlerrm; end;
  assert got='JFLEET_BOOKED_ROUTE_REFERENCE_IMMUTABLE','booked route could be erased';
  passed:=passed||jsonb_build_array('booked route evidence cannot be erased');
  got:=null; begin perform public.jfleet_owner_review_route_v1(inquiry_id,owner_id,context->>'snapshot_hash','approved','New',true); exception when others then got:=sqlerrm; end;
  assert got='JFLEET_ROUTE_REVIEW_CLOSED','converted inquiry accepted new approval';
  passed:=passed||jsonb_build_array('converted inquiry cannot receive a new approval');
  perform set_config('jfleet.review_test_results',jsonb_build_object('role',current_user,'passed',jsonb_array_length(passed),'checks',passed,'rollback',true)::text,true);
end;
$test$;
select current_setting('jfleet.review_test_results')::jsonb as result;
rollback;
