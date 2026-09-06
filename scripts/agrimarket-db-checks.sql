-- Fixtures are fictitious and exist only inside the runner's rolled-back transaction.
create function pg_temp.check_true(value boolean, label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end; $$;
create function pg_temp.expect_error(statement text, expected text) returns void language plpgsql as $$
begin
  begin execute statement; exception when others then
    if sqlerrm like '%'||expected||'%' then return; end if;
    raise;
  end;
  raise exception 'FAIL: expected %',expected;
end; $$;
insert into drivers(id) values('10000000-0000-4000-8000-000000000001');
insert into agrimarket_producers(id,contact_name,town,pickup_label,pickup_lat,pickup_lng,status,accepting_orders,
  pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions)
values('20000000-0000-4000-8000-000000000001','Test farmer','Lagawe','Verified handoff',16.8,121.1,'active',true,true,true,true,'Use the test roadside pickup point.');
insert into agrimarket_products(id,producer_id,name,product_group,selling_unit,cargo_class,unit_price,listed_quantity,reserved_quantity)
values('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Test produce','produce','kg','standard_produce',100,10,3);
insert into agrimarket_orders(id,order_code,customer_user_id,delivery_label,delivery_lat,delivery_lng,producer_id,status,preferred_vehicle_type,
  product_subtotal,delivery_fee,delivery_company_cut,assigned_driver_id,cash_collection_required,cash_collection_amount,route_plan)
select ('40000000-0000-4000-8000-00000000000'||n)::uuid,'TEST-'||n,'50000000-0000-4000-8000-000000000001',
  'Test delivery',16.9,121.2,'20000000-0000-4000-8000-000000000001','driver_assigned','motorcycle',
  case when n=2 then 600 else 100 end,115,20,'10000000-0000-4000-8000-000000000001',n=2,
  case when n=2 then 600 else 0 end,case when n=2 then 'customer_cash_first' else 'farmer_first' end
from generate_series(1,3) n;
insert into agrimarket_order_items(id,order_id,product_id,product_name,product_group,selling_unit,cargo_class,condition_required,quantity,unit_price)
select ('60000000-0000-4000-8000-00000000000'||n)::uuid,('40000000-0000-4000-8000-00000000000'||n)::uuid,
  '30000000-0000-4000-8000-000000000001','Test produce','produce','kg','standard_produce','normal',1,100 from generate_series(1,3) n;
insert into agrimarket_inventory_reservations(order_id,order_item_id,product_id,quantity)
select ('40000000-0000-4000-8000-00000000000'||n)::uuid,('60000000-0000-4000-8000-00000000000'||n)::uuid,
  '30000000-0000-4000-8000-000000000001',1 from generate_series(1,3) n;

select pg_temp.check_true(not has_function_privilege('authenticated','agrimarket_driver_execute_v2(text,uuid,text,jsonb,timestamptz)','execute'),'driver RPC private');
select pg_temp.check_true(not has_function_privilege('anon','agrimarket_admin_resolve_pickup_issue_v1(text,text,text,text,timestamptz)','execute'),'admin RPC private');
select pg_temp.check_true(agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000099','pay_farmer','{"amount":100}')->>'error'='AGRIMARKET_ORDER_NOT_ASSIGNED_TO_DRIVER','foreign driver denied');
select pg_temp.check_true(agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','set_handling_fee','{"amount":20}')->>'error'='AGRIMARKET_FARMER_CONFIRMED_HANDLING_ONLY','arbitrary handling rejected');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','pay_farmer','{"amount":100}')->>'ok')::boolean,'farmer payment');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','verify_item','{"order_item_id":"60000000-0000-4000-8000-000000000001","check_type":"quantity","result":"mismatch"}')->>'ok')::boolean,'item mismatch opens issue');
select pg_temp.check_true(agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','confirm_pickup')->>'error'='AGRIMARKET_PICKUP_ISSUE_OPEN','pickup paused');
select pg_temp.expect_error($q$select agrimarket_driver_execute_v1('TEST-1','10000000-0000-4000-8000-000000000001','verify_item','{"order_item_id":"60000000-0000-4000-8000-000000000001","check_type":"quantity","result":"pass"}')$q$,'AGRIMARKET_PICKUP_ISSUE_OPEN');
select pg_temp.expect_error($q$update agrimarket_orders set status='picked_up' where order_code='TEST-1'$q$,'AGRIMARKET_PICKUP_ISSUE_OPEN');
select pg_temp.check_true(agrimarket_admin_resolve_pickup_issue_v1('TEST-1','cancel','Test admin','Changed load')->>'error'='AGRIMARKET_CASH_RETURNS_REQUIRED','cancel requires farmer refund');
select pg_temp.check_true((agrimarket_admin_resolve_pickup_issue_v1('TEST-1','restored_to_booking','Test admin','Original load restored with no price or vehicle change')->>'ok')::boolean,'staff restoration');
select pg_temp.check_true(not exists(select 1 from agrimarket_pickup_checks where order_id='40000000-0000-4000-8000-000000000001'),'fresh physical checks required');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','verify_item','{"order_item_id":"60000000-0000-4000-8000-000000000001","check_type":"quantity","result":"pass"}')->>'ok')::boolean,'recheck');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','confirm_pickup')->>'ok')::boolean,'pickup after resolution');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','start_delivery')->>'ok')::boolean,'start delivery');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-1','10000000-0000-4000-8000-000000000001','confirm_delivery','{"amount":215}')->>'ok')::boolean,'delivery and settlement');
select pg_temp.check_true((select status='completed' from agrimarket_orders where order_code='TEST-1'),'settlement completed');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','collect_customer_cash','{"amount":600}')->>'ok')::boolean,'cash-first collection');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','pay_farmer','{"amount":600}')->>'ok')::boolean,'cash-first farmer payment');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','report_load_mismatch','{"reason":"Load cannot fit the approved vehicle"}')->>'ok')::boolean,'load report before pickup');
select pg_temp.check_true(agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','confirm_customer_refund','{"amount":600}')->>'error'='AGRIMARKET_FARMER_REFUND_REQUIRED','refund sequence enforced');
select pg_temp.check_true(agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','confirm_farmer_refund','{"amount":599}')->>'error'='AGRIMARKET_REFUND_AMOUNT_MISMATCH','partial refund rejected');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','confirm_farmer_refund','{"amount":600}')->>'ok')::boolean,'farmer refund receipt');
select pg_temp.check_true(agrimarket_admin_resolve_pickup_issue_v1('TEST-2','restored_to_booking','Test admin','Restore')->>'error'='AGRIMARKET_REFUNDED_ORDER_MUST_CANCEL','cannot resume after cash returned');
select pg_temp.check_true(agrimarket_admin_resolve_pickup_issue_v1('TEST-2','cancel','Test admin','Cancel')->>'error'='AGRIMARKET_CASH_RETURNS_REQUIRED','customer refund still required');
select pg_temp.check_true((agrimarket_driver_execute_v2('TEST-2','10000000-0000-4000-8000-000000000001','confirm_customer_refund','{"amount":600}')->>'ok')::boolean,'customer refund receipt');
select pg_temp.check_true((agrimarket_admin_resolve_pickup_issue_v1('TEST-2','cancel','Test admin','Cash fully returned; new vehicle needs new booking')->>'ok')::boolean,'cancel after refunds');
select pg_temp.check_true((agrimarket_admin_resolve_pickup_issue_v1('TEST-2','cancel','Test admin','Retry')->>'already_done')::boolean,'cancel retry idempotent');
select pg_temp.check_true((select reserved_quantity=1 and sold_quantity=1 from agrimarket_products where id='30000000-0000-4000-8000-000000000001'),'inventory consumed/released exactly once');
select pg_temp.check_true((select wallet_balance=980 from drivers where id='10000000-0000-4000-8000-000000000001'),'only completed delivery charges company cut');
update agrimarket_producers set pickup_motorcycle_accessible=false where id='20000000-0000-4000-8000-000000000001';
select pg_temp.expect_error($q$update agrimarket_orders set status='driver_assigned' where order_code='TEST-3'$q$,'AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE');
