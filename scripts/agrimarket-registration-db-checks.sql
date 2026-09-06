-- These fictitious registration records are rolled back by the local runner.
do $tests$
declare
  payload jsonb := '{"applicant_name":"Registration test farmer","phone_normalized":"+639000000002","phone_display":"09000000002","town":"Lagawe","barangay":"Test barangay","pickup_label":"Test roadside pickup","pickup_lat":16.8,"pickup_lng":121.1,"pickup_motorcycle_accessible":true,"pickup_tricycle_accessible":true,"pickup_roadside_handoff_required":true,"pickup_driver_directions":"Use the marked test pickup point.","intended_products":["Vegetables"],"application_details":{"request_id":"81000000-0000-4000-8000-000000000001","submitted_by":"family","helper_name":"Test family helper","farmer_consent":true,"pin_confirmed":true,"resolved_town":"Lagawe"}}';
  a agrimarket_farmer_applications%rowtype; retry agrimarket_farmer_applications%rowtype;
  code text := 'AGAPP-260906-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  r jsonb; producer uuid;
begin
  perform pg_temp.check_true(not has_function_privilege('authenticated','agrimarket_submit_farmer_application_v2(text,jsonb,text,text,text,timestamptz)','execute'),'registration RPC service-only');
  perform pg_temp.check_true(not has_function_privilege('service_role','agrimarket_review_farmer_application_v1(uuid,text,text,text,text,text,timestamptz)','execute'),'legacy immediate-order approval disabled');
  perform pg_temp.expect_error(format('select agrimarket_submit_farmer_application_v2(%L,%L::jsonb,%L,%L)',code,jsonb_set(payload,'{application_details,farmer_consent}','false'),'+639000000002','applicant'),'AGRIMARKET_FARMER_CONSENT_AND_PIN_REQUIRED');
  perform pg_temp.expect_error(format('select agrimarket_submit_farmer_application_v2(%L,%L::jsonb,%L,%L)',code,jsonb_set(payload,'{application_details,resolved_town}','"Banaue"'),'+639000000002','applicant'),'AGRIMARKET_PICKUP_TOWN_MISMATCH');
  a := agrimarket_submit_farmer_application_v2(code,payload,'+639000000002','applicant');
  perform pg_temp.check_true(a.status='submitted' and a.application_details->>'version'='2','application saved with consent and verified town');
  retry := agrimarket_submit_farmer_application_v2('AGAPP-260906-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',payload,'+639000000002','applicant');
  perform pg_temp.check_true(retry.id=a.id,'application network retry returns same record');
  perform pg_temp.check_true((select count(*)=1 from agrimarket_farmer_application_events where application_id=a.id),'submission audit written exactly once');
  perform pg_temp.expect_error(format('select agrimarket_submit_farmer_application_v2(%L,%L::jsonb,%L,%L)',code,jsonb_set(payload,'{application_details,request_id}','"81000000-0000-4000-8000-000000000099"'),'+639000000002','applicant'),'AGRIMARKET_FARMER_PHONE_ALREADY_REGISTERED');
  r := agrimarket_review_farmer_application_v2(a.id,'under_review','Test dispatcher','dispatcher','Contacted the farmer');
  perform pg_temp.check_true(r->>'status'='under_review','dispatcher may mark under review');
  perform pg_temp.expect_error(format('select agrimarket_review_farmer_application_v2(%L,%L,%L,%L,%L)',a.id,'approve','Test dispatcher','dispatcher','Identity checked'),'AGRIMARKET_ADMIN_REQUIRED');
  r := agrimarket_review_farmer_application_v2(a.id,'request_correction','Test admin','admin','Move the pin to the agreed roadside handoff');
  perform pg_temp.check_true(r->>'status'='correction_requested','administrator requests correction');
  perform pg_temp.expect_error(format('select agrimarket_review_farmer_application_v2(%L,%L,%L,%L,%L)',a.id,'approve','Test admin','admin','Identity checked'),'AGRIMARKET_CORRECTION_REQUIRED_BEFORE_APPROVAL');
  payload := jsonb_set(payload,'{application_details,request_id}','"81000000-0000-4000-8000-000000000002"');
  a := agrimarket_submit_farmer_application_v2(code,payload,'+639000000002','applicant',code);
  perform pg_temp.check_true(a.status='submitted','corrected application returns to review queue');
  r := agrimarket_review_farmer_application_v2(a.id,'approve','Test admin','admin','Identity, consent and pickup access checked','AGF-REGTEST01','123456','{"lat":16.8,"lng":121.1,"town":"Lagawe"}',true);
  producer := (r->>'producer_id')::uuid;
  perform pg_temp.check_true((select status='active' and accepting_orders=false and contact_phone='09000000002' from agrimarket_producers where id=producer),'approval creates setup-only producer with contact');
  perform pg_temp.check_true((select pin_hash<> '123456' and pin_hash=extensions.crypt('123456',pin_hash) from agrimarket_producer_credentials where producer_id=producer),'farmer PIN stored as working bcrypt hash');
  perform pg_temp.expect_error(format('select agrimarket_admin_set_verified_farmer_readiness_v1(%L,true,%L,%L,%L)',producer,'Test dispatcher','dispatcher','Ready for orders'),'AGRIMARKET_ADMIN_REQUIRED');
  perform pg_temp.expect_error(format('select agrimarket_admin_set_verified_farmer_readiness_v1(%L,true,%L,%L,%L)',producer,'Test admin','admin','Ready for orders'),'AGRIMARKET_FARMER_NO_ACTIVE_PRODUCT');
  insert into agrimarket_products(producer_id,name,product_group,selling_unit,cargo_class,unit_price,listed_quantity,is_active)
    values(producer,'Test vegetables','produce','kg','standard_produce',50,5,true);
  perform agrimarket_admin_set_verified_farmer_readiness_v1(producer,true,'Test admin','admin','Product stock, pickup access and training checked');
  perform pg_temp.check_true((select accepting_orders from agrimarket_producers where id=producer),'separate readiness opens ordering after products');
  perform agrimarket_admin_manage_farmer_access_v1(producer,'suspend_farmer','Test admin','Test suspension');
  perform agrimarket_admin_manage_farmer_access_v1(producer,'reactivate_farmer','Test admin','Test reactivation');
  perform pg_temp.check_true((select status='active' and not accepting_orders from agrimarket_producers where id=producer),'reactivation cannot bypass separate readiness');
  perform pg_temp.check_true(not exists(select 1 from agrimarket_farmer_application_events where application_id=a.id and details::text like '%123456%'),'approval audit excludes raw farmer PIN');
end;
$tests$;
