// Execute the real migration locally; no production credentials or records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {PGlite}=require(process.env.AGRIMARKET_TEST_PGLITE_PATH || '@electric-sql/pglite');
async function main(){
  const db=new PGlite();
  try{
    await db.exec(`create role anon; create role authenticated;
      create table agrimarket_producers(id uuid primary key,accepting_orders boolean not null);
      create table agrimarket_orders(id int primary key,producer_id uuid references agrimarket_producers(id),status text);
      insert into agrimarket_producers values('00000000-0000-4000-8000-000000000001',true);`);
    await db.exec(fs.readFileSync(path.resolve(__dirname,'../../supabase/migrations/20260920185710_agrimarket_farmer_store_open_v1.sql'),'utf8'));
    const read=async sql=>(await db.query(sql)).rows[0];
    assert.equal((await read('select store_open from agrimarket_producers')).store_open,true);
    await db.exec(`insert into agrimarket_orders values(1,'00000000-0000-4000-8000-000000000001','awaiting_producer');
      update agrimarket_producers set store_open=false;`);
    await assert.rejects(()=>db.exec(`insert into agrimarket_orders values(2,'00000000-0000-4000-8000-000000000001','awaiting_producer')`),/STORE_CLOSED/);
    await db.exec(`update agrimarket_orders set status='driver_assigned' where id=1;`);
    assert.equal((await read('select status from agrimarket_orders where id=1')).status,'driver_assigned');
    assert.equal((await read('select accepting_orders from agrimarket_producers')).accepting_orders,true);
    await db.exec(`update agrimarket_producers set store_open=true; insert into agrimarket_orders values(3,'00000000-0000-4000-8000-000000000001','awaiting_producer');`);
    for(const role of ['anon','authenticated'])assert.equal((await read(`select has_function_privilege('${role}','agrimarket_guard_store_open_v1()','execute') as permitted`)).permitted,false);
    console.log('PASS default availability preserved, closed store rejects checkout, existing orders continue, reopening works and trigger is private');
  }finally{await db.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
