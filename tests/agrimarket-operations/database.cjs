// Local PostgreSQL execution using PGlite; no production data or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.AGRIMARKET_TEST_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const oid = '00000000-0000-4000-8000-000000000001';
const uid = '00000000-0000-4000-8000-000000000002';
const pid = '00000000-0000-4000-8000-000000000003';
const driver = '00000000-0000-4000-8000-000000000004';
const offer = '00000000-0000-4000-8000-000000000005';
async function main() {
  const db = new PGlite();
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  try {
    await db.exec(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));
    for (const file of ['20260920140000_agrimarket_reapproval_deadline_v1.sql','20260920141000_agrimarket_admin_order_controls_v1.sql','20260920142000_agrimarket_store_name_required_v1.sql','20260920143000_agrimarket_activate_reapproval_deadline_v1.sql']) await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',file),'utf8'));
    await db.exec(`insert into agrimarket_producers values('${pid}','Test Farm',true);
      insert into agrimarket_products(id,producer_id,is_active,reserved_quantity) values('${pid}','${pid}',true,2);`);
    const reset = async (status='awaiting_customer_reapproval') => {
      await db.exec(`delete from agrimarket_driver_offers; delete from agrimarket_order_events; delete from agrimarket_inventory_reservations; delete from agrimarket_orders;
        insert into agrimarket_orders(id,order_code,customer_user_id,producer_id,status,product_subtotal,delivery_fee,customer_approved_total,customer_approved_vehicle_type,required_vehicle_type,customer_reapproval_proposed_total,customer_reapproval_proposed_vehicle_type,customer_reapproval_resume_status,preparation_minutes,ready_at)
        values('${oid}','AG-FIXTURE','${uid}','${pid}','${status}',100,40,120,'motorcycle','tricycle',140,'tricycle','preparing',15,now()-interval '1 hour');
        update agrimarket_products set reserved_quantity=2;
        insert into agrimarket_inventory_reservations values('${oid}','${pid}',2,'active',null);`);
    };
    const respond = async (who=uid,response='accept') => (await one('select agrimarket_customer_respond_reapproval_v1($1,$2,$3) as v',['AG-FIXTURE',who,response])).v;
    const expireDeadline = async () => {
      // Fixture-only time travel; production never disables the trigger.
      await db.exec("alter table agrimarket_orders disable trigger agrimarket_reapproval_deadline_trg; update agrimarket_orders set customer_reapproval_expires_at=clock_timestamp()-interval '1 second'; alter table agrimarket_orders enable trigger agrimarket_reapproval_deadline_trg;");
    };
    await reset();
    const initial=(await one('select customer_reapproval_expires_at,extract(epoch from (customer_reapproval_expires_at-clock_timestamp())) as seconds from agrimarket_orders'));
    assert(Number(initial.seconds)>298 && Number(initial.seconds)<=300);
    await db.exec("update agrimarket_orders set customer_reapproval_expires_at=now()+interval '1 day', status='awaiting_customer_reapproval'");
    assert.equal(String((await one('select customer_reapproval_expires_at from agrimarket_orders')).customer_reapproval_expires_at),String(initial.customer_reapproval_expires_at));
    assert.equal((await respond(pid)).error,'AGRIMARKET_ORDER_NOT_FOUND');
    assert.equal((await respond()).status,'preparing');
    const prep=await one("select extract(epoch from (ready_at-clock_timestamp())) as seconds from agrimarket_orders");
    assert(Number(prep.seconds)>898 && Number(prep.seconds)<=900);
    assert.equal((await respond()).error,'AGRIMARKET_REAPPROVAL_WRONG_STATUS');
    console.log('PASS five-minute deadline cannot extend; ownership, one-time approval and preparation restart');
    await reset();
    assert.equal((await one("select agrimarket_customer_respond_reapproval_v2('AG-FIXTURE',$1,'accept',999,'tricycle',now()) as v",[uid])).v.error,'AGRIMARKET_REAPPROVAL_PROPOSAL_STALE');
    await expireDeadline();
    assert.equal((await respond()).error,'AGRIMARKET_REAPPROVAL_EXPIRED');
    assert.equal((await one('select status,cancel_reason from agrimarket_orders')).cancel_reason,'customer_reapproval_timeout');
    assert.equal(Number((await one('select reserved_quantity from agrimarket_products')).reserved_quantity),0);
    assert.equal((await one('select agrimarket_expire_customer_reapproval_v1() as n')).n,0);
    assert.equal(Number((await one('select count(*) as n from agrimarket_order_events')).n),1);
    console.log('PASS stale proposal and late acceptance rejected; expiry releases inventory exactly once');
    await reset();
    assert.equal((await respond(uid,'reject')).status,'cancelled');
    assert.equal(Number((await one('select reserved_quantity from agrimarket_products')).reserved_quantity),0);
    await reset('ready_for_dispatch');
    const act=async(action,status='ready_for_dispatch',expectedDriver=null,expectedOffer=null,note='Customer requested change') => (await one('select agrimarket_admin_order_action_v1($1,$2,$3,$4,$5,$6,$7) as v',['AG-FIXTURE',action,'ops@example.test',note,status,expectedDriver,expectedOffer])).v;
    assert.equal((await act('cancel','ready_for_dispatch',null,null,'')).error,'AGRIMARKET_ADMIN_REASON_REQUIRED');
    assert.equal((await act('cancel','preparing')).error,'AGRIMARKET_ORDER_CHANGED');
    assert.equal((await act('reassign')).error,'AGRIMARKET_ACTIVE_ASSIGNMENT_REQUIRED');
    await db.exec(`insert into agrimarket_driver_offers(id,order_id,driver_id,offer_rank,status,offered_at,expires_at) values('${offer}','${oid}','${driver}',1,'offered',now(),now()+interval '1 minute')`);
    assert.equal((await act('reassign','ready_for_dispatch',null,offer)).status,'ready_for_dispatch');
    assert.equal((await one('select status from agrimarket_driver_offers')).status,'cancelled');
    assert.equal(Number((await one('select reserved_quantity from agrimarket_products')).reserved_quantity),2);
    assert.equal((await one("select details->>'actor' as actor from agrimarket_order_events")).actor,'ops@example.test');
    assert.equal((await act('cancel')).status,'cancelled');
    await assert.rejects(()=>db.exec(`insert into agrimarket_driver_offers(order_id,driver_id,status) values('${oid}','${driver}','offered')`),/NOT_DRIVER_ASSIGNABLE/);
    assert.equal((await one("select agrimarket_driver_decide_offer_v1($1,$2,'accept') as v",[offer,driver])).v.status,'cancelled');
    console.log('PASS audited cancellation/reassignment, stale Admin protection and cancelled offers cannot assign');
    await reset('driver_assigned');
    await db.exec(`alter table agrimarket_orders disable trigger agrimarket_apply_driver_approach_order_trg;
      update agrimarket_orders set assigned_driver_id='${driver}',selected_vehicle_type='tricycle',driver_to_first_pickup_km=3,pickup_distance_fee=60,pickup_fee_locked_at=now(),ready_at=now()+interval '10 minutes';
      alter table agrimarket_orders enable trigger agrimarket_apply_driver_approach_order_trg;
      insert into agrimarket_driver_offers(id,order_id,driver_id,status) values('${offer}','${oid}','${driver}','accepted');`);
    assert.equal((await act('reassign','driver_assigned',driver)).status,'preparing');
    const released=await one('select assigned_driver_id,selected_vehicle_type,pickup_distance_fee,pickup_fee_locked_at,total_payable from agrimarket_orders');
    assert.equal(released.assigned_driver_id,null);assert.equal(released.selected_vehicle_type,null);
    assert.equal(released.pickup_fee_locked_at,null);assert.equal(Number(released.pickup_distance_fee),0);assert.equal(Number(released.total_payable),140);
    console.log('PASS assigned driver reassignment clears the old approach charge and preserves preparation');

    for (const field of ['customer_cash_collected_at','producer_paid_at','picked_up_at','final_cash_collected_at']) {
      await reset('driver_assigned');
      await db.exec(`update agrimarket_orders set ${field}=now()`);
      assert.equal((await act('cancel','driver_assigned')).error,'AGRIMARKET_RECOVERY_REQUIRED',field);
      assert.equal((await act('reassign','driver_assigned')).error,'AGRIMARKET_RECOVERY_REQUIRED',field);
    }
    for (const status of ['picked_up','delivering','delivered','completed']) {
      await reset(status); assert.equal((await act('cancel',status)).error,'AGRIMARKET_ADMIN_ACTION_WRONG_STATUS');
    }
    console.log('PASS cash, pickup and completed orders cannot use administrative shortcuts');
    await assert.rejects(()=>db.exec("update agrimarket_producers set vendor_name=null"),/store_name_required/);
    await db.exec("update agrimarket_producers set accepting_orders=false,vendor_name=null");
    await assert.rejects(()=>db.exec("update agrimarket_products set is_active=true"),/STORE_NAME_REQUIRED/);
    await db.exec('set role authenticated');
    await assert.rejects(()=>db.query('select agrimarket_expire_customer_reapproval_v1()'),/permission denied/);
    await assert.rejects(()=>act('cancel'),/permission denied/);
    console.log('PASS mandatory store name and private RPC permissions');
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error.message,error.where || "");process.exitCode=1;});
