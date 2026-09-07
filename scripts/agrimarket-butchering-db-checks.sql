-- Fictitious cuts and orders; the surrounding runner rolls everything back.
do $test$
declare
  producer uuid := '91000000-0000-4000-8000-000000000003';
  request_id uuid := '91000000-0000-4000-8000-000000000001';
  customer uuid := '50000000-0000-4000-8000-000000000001';
  address uuid := '91000000-0000-4000-8000-000000000002';
  payload jsonb; result jsonb; retry jsonb; ids uuid[]; created record; before_count integer;
begin
  insert into agrimarket_producers(id,contact_name,town,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,
    pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions)
  values(producer,'Butchering test farmer','Lagawe','Verified test handoff',16.8,121.1,'active',true,true,true,true,'Use the local test roadside pickup point.');
  payload := jsonb_build_object('species','Pig','breed',null,'description','Local test only','butcher_start_at',clock_timestamp()+interval '2 days','butcher_end_at',clock_timestamp()+interval '2 days 4 hours','order_cutoff_at',clock_timestamp()+interval '1 day','condition','fresh','vehicle_requirement','either','default_prep_minutes',15,'is_active',true,'cuts','[{"name":"Belly","price_per_kg":300,"available_kg":10},{"name":"Leg","price_per_kg":250,"available_kg":8},{"name":"Liver","price_per_kg":150,"available_kg":4}]'::jsonb);
  perform pg_temp.check_true(not has_function_privilege('authenticated','agrimarket_create_butchering_batch_v1(uuid,uuid,jsonb)','execute') and not has_table_privilege('anon','agrimarket_butchering_batches','select'),'butchering receipt and RPC are service-only');
  result := agrimarket_create_butchering_batch_v1(producer,request_id,payload);
  select array_agg(value::uuid) into ids from jsonb_array_elements_text(result->'product_ids');
  perform pg_temp.check_true(cardinality(ids)=3 and (select count(*)=3 from agrimarket_products where id=any(ids) and product_group='meat' and selling_unit='kg' and unit_weight_kg=1 and cargo_class='fresh_meat' and vehicle_requirement='either' and availability_mode='scheduled_harvest'),'three separately priced meat cuts use kg and meat vehicle rules');
  retry := agrimarket_create_butchering_batch_v1(producer,request_id,payload);
  perform pg_temp.check_true(retry->'product_ids'=result->'product_ids' and (retry->>'replayed')::boolean,'retry creates no duplicate meat inventory');
  perform pg_temp.expect_error(format('select agrimarket_create_butchering_batch_v1(%L,%L,%L::jsonb)',producer,request_id,jsonb_set(payload,'{species}','"Goat"')),'BUTCHERING_REQUEST_CONFLICT');
  select count(*) into before_count from agrimarket_products;
  perform pg_temp.expect_error(format('select agrimarket_create_butchering_batch_v1(%L,%L,%L::jsonb)',producer,gen_random_uuid(),jsonb_set(payload,'{cuts,1,available_kg}','-1')),'BUTCHERING_INPUT_INVALID');
  perform pg_temp.check_true((select count(*)=before_count from agrimarket_products),'invalid later cut rolls back the entire batch');
  perform pg_temp.expect_error(format('select agrimarket_create_butchering_batch_v1(%L,%L,%L::jsonb)',producer,gen_random_uuid(),jsonb_set(payload,'{order_cutoff_at}',to_jsonb(clock_timestamp()-interval '1 minute'))),'BUTCHERING_SCHEDULE_INVALID');
  insert into passenger_addresses(id,created_by_user_id,lat,lng,address_text,label) values(address,customer,16.81,121.11,'Butchering test','Butchering test');
  select * into created from agrimarket_create_reserved_order_v4(customer,gen_random_uuid(),address,jsonb_build_array(jsonb_build_object('product_id',ids[1],'quantity',2),jsonb_build_object('product_id',ids[2],'quantity',1.5)),5,600,5,600,'motorcycle');
  perform pg_temp.check_true(created.product_subtotal=975 and created.cash_collection_required and created.fulfillment_mode='scheduled_harvest','mixed cuts subtotal uses each per-kilo price and existing cash rule');
  perform pg_temp.check_true((select estimated_cargo_weight_kg=3.5 from agrimarket_orders where id=created.order_id),'meat weight is ordered kilos, not live-animal weight');
  perform pg_temp.check_true((select reserved_quantity=2 from agrimarket_products where id=ids[1]) and (select reserved_quantity=1.5 from agrimarket_products where id=ids[2]) and (select reserved_quantity=0 from agrimarket_products where id=ids[3]),'each cut reserves only its own kilos');
  perform pg_temp.check_true((select bool_and(product_group='meat' and meat_cut is not null and harvest_start_at is not null) from agrimarket_order_items where order_id=created.order_id),'order snapshots preserve cut identity and butchering schedule');
  result := agrimarket_producer_decide_order_v6(created.order_code,producer,'accept');
  perform pg_temp.check_true((result->>'ok')::boolean and (select status='awaiting_harvest' and assigned_driver_id is null from agrimarket_orders where id=created.order_id),'accepting butchering reservation waits for ready before dispatch');
  result := agrimarket_producer_harvest_action_v3(p_order_code=>created.order_code,p_producer_id=>producer,p_action=>'ready',p_preparation_minutes=>15,p_confirmed_cargo_weight_basis=>'exact',p_confirmed_cargo_weight_kg=>3.5,p_confirmed_handling_tier=>'standard');
  perform pg_temp.check_true((result->>'ok')::boolean and (select harvest_ready_at is not null and confirmed_cargo_weight_kg=3.5 from agrimarket_orders where id=created.order_id),'meat-ready confirmation preserves the existing load confirmation flow');
end; $test$;
