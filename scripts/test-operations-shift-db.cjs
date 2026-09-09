// Disposable in-memory PostgreSQL only. No connection URL or production credentials.
// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite package.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
let passed = 0;
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const at = value => query('update test_clock set at=$1', [value]);
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const day = '2026-09-10';
const read = async (email='one@example.test',admin=false,duty='primary') => (await query('select operations_shift_read_v1($1,$2,$3,$4,true) as r',[email,admin,day,duty]))[0].r;
const outreach = async (email='one@example.test',admin=false,duty='primary') => (await query('select operations_shift_outreach_read_v1($1,$2,$3,$4) as r',[email,admin,day,duty]))[0].r;
const action = async (kind, version, booking=null, target=null, email='one@example.test', duty='primary', n=100) =>
  (await query('select operations_shift_apply_v1($1,false,$2,$3,$4,$5,$6,$7,$8,$9) as r',[email,day,duty,version,kind,booking,'A verified test action.',target,id(n)]))[0].r;
const contact = async (n, driver=1, outcome='no_answer', previous=null, email='one@example.test',duty='primary') =>
  (await query('select operations_shift_outreach_apply_v1($1,false,$2,$3,$4,$5,$6,$7,$8,$9) as r',[email,day,duty,id(driver),'call',outcome,'Called driver for availability.',id(n),previous]))[0].r;
async function test(name, fn) { await fn(); passed++; console.log('PASS '+name); }
async function rejects(fn, code) { await assert.rejects(fn, error => error.code === code); }

(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create table test_clock(at timestamptz); insert into test_clock values('2026-09-09T12:57:00Z');
    create function test_now() returns timestamptz language sql stable as 'select at from test_clock';
    create table drivers(id uuid primary key,driver_name text,driver_status text,roster_status text,wallet_balance numeric,min_wallet_required numeric,wallet_locked boolean);
    create table driver_profiles(driver_id uuid primary key,full_name text,phone text,municipality text);
    create table driver_locations(id uuid primary key,driver_id uuid,status text,updated_at timestamptz,home_town text);
    create table driver_presence_minutes(driver_id uuid,minute_started_at timestamptz,last_seen_at timestamptz,town text,primary key(driver_id,minute_started_at));
    create table driver_presence_sessions(driver_id uuid,login_at timestamptz,logout_at timestamptz,last_seen_at timestamptz);
    create table driver_duty_check_v2_exclusion_intervals_v1(driver_id uuid,ineligible_start timestamptz,ineligible_end timestamptz);
    create table analytics_test_identities(entity_type text,entity_id uuid,active boolean);
    create table analytics_booking_exclusions(booking_id uuid,active boolean);
    create table bookings(id uuid primary key,status text,driver_status text,vendor_status text,assigned_driver_id uuid,driver_id uuid,completed_at timestamptz,cancel_reason text,vendor_cancel_reason text,town text,service_type text,created_by_user_id uuid,booking_code text,created_at timestamptz);
    create view analytics_v3_bookings_v1 as select * from bookings b where not exists(select 1 from analytics_booking_exclusions x where x.booking_id=b.id and x.active)
      and not exists(select 1 from analytics_test_identities t where t.active and ((t.entity_type='driver' and t.entity_id=coalesce(b.assigned_driver_id,b.driver_id)) or (t.entity_type='passenger' and t.entity_id=b.created_by_user_id)));
    create table booking_lifecycle_events(booking_id uuid,created_at timestamptz,status_before text,status_after text,event_type text);
    create table operations_schedule_state(id integer primary key,state jsonb);
    create table operations_schedule_events(id bigint,action text,actor text,note text,created_at timestamptz);
  `);
  const base = fs.readFileSync('supabase/migrations/20260909125500_operations_shift_report_v1.sql','utf8');
  const extra = fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_operations_shift_outreach_v1.sql')),'utf8');
  // Only the disposable test database has a controllable clock.
  const withClock = sql => sql.replace(/\b(clock_timestamp|statement_timestamp|transaction_timestamp)\(\)/g,'public.test_now()');
  await db.exec(withClock(base)); await db.exec(withClock(extra));
  await db.exec(fs.readFileSync('supabase/migrations/'+fs.readdirSync('supabase/migrations').find(x=>x.endsWith('_operations_shift_audit_privileges_v1.sql')),'utf8'));
  const state = { employees:[{id:'one',email:'one@example.test',name:'One'},{id:'two',email:'two@example.test',name:'Two'},{id:'rest',email:'rest@example.test',name:'Rest'}],
    rests:{[day]:'rest'}, slots:{[day+'/primary']:{owner:'one'},[day+'/evening']:{owner:'two'}},teams:{[id(1)]:'one'} };
  await query('insert into operations_schedule_state values(1,$1)',[state]);
  for(let n=1;n<=7;n++) {
    await query('insert into drivers values($1,$2,$3,$4,300,250,false)',[id(n),'Driver '+n,'offline',n===4?'terminated':'active']);
    await query('insert into driver_profiles values($1,$2,$3,$4)',[id(n),'Driver '+n,'09123456789','Lagawe']);
    await query('insert into driver_locations values($1,$1,$2,$3,$4)',[id(n),n===3?'online':'offline',n===6?'2026-09-09T00:00Z':'2026-09-10T02:14:55Z','Lagawe']);
  }
  await query('insert into analytics_test_identities values($1,$2,true)',['driver',id(5)]);
  await at('2026-09-10T01:50:00Z');
  await query('insert into bookings(id,status,driver_id,town,service_type,booking_code,created_at) values($1,$2,$3,$4,$5,$6,$7)',[id(20),'on_trip',id(2),'Lagawe','ride','TEST-TRIP','2026-09-10T01:50Z']);
  await at('2026-09-10T02:15:20Z');

  await test('unlinked staff and another coordinator cannot view a shift',async()=>{
    await rejects(()=>read('unknown@example.test'),'42501'); await rejects(()=>read('two@example.test'),'42501');
    await rejects(()=>outreach('two@example.test'),'42501');
  });
  await test('trip carry-in is based on history and unacknowledged monitor cannot log contact',async()=>{
    const r=await read(); assert.equal(r.metrics.carry_in,1); assert.equal(r.watch.length,1);
    await rejects(()=>contact(101),'42501');
  });
  await action('start',0,null,null,'one@example.test','primary',102);
  await test('roster excludes online, active-trip, terminated and test drivers; stale remains labeled',async()=>{
    const r=await outreach(); assert.deepEqual(r.candidates.map(d=>d.driver_id).sort(),[id(1),id(6),id(7)]);
    assert.equal(r.candidates.find(d=>d.driver_id===id(6)).signal,'stale');
    await rejects(()=>contact(103,2),'40001'); await rejects(()=>contact(104,3),'40001'); await rejects(()=>contact(105,4),'22023');
  });
  await test('same request replays once and mismatched reuse is rejected',async()=>{
    await contact(106); assert.equal((await contact(106)).replayed,true);
    await rejects(()=>contact(106,6),'23505'); assert.equal((await outreach()).contacts.length,1);
  });
  await test('stale contact state and new online status block another reminder',async()=>{
    await rejects(()=>contact(107,1),'40001');
    await query('update driver_locations set status=$2,updated_at=public.test_now() where driver_id=$1',[id(1),'online']);
    await rejects(()=>contact(107,1,'will_go_online',id(106)),'40001');
    await query('update driver_locations set status=$2 where driver_id=$1',[id(1),'offline']);
    await contact(107,1,'will_go_online',id(106));
  });
  await test('a pre-contact part of a minute does not count as returning online',async()=>{
    await query('insert into driver_presence_minutes values($1,$2,$3,$4)',[id(1),'2026-09-10T02:15Z','2026-09-10T02:15:10Z','Lagawe']);
    assert((await outreach()).contacts.every(c=>c.online_after_contact_at===null));
    await at('2026-09-10T02:17Z');
    await query('insert into driver_presence_minutes values($1,$2,$3,$4)',[id(1),'2026-09-10T02:16Z','2026-09-10T02:16:40Z','Lagawe']);
    assert((await outreach()).contacts.every(c=>Date.parse(c.online_after_contact_at)===Date.parse('2026-09-10T02:16Z')));
  });
  await test('unavailable today suppresses repeat reminders',async()=>{
    await contact(108,6,'unavailable_today'); await rejects(()=>contact(109,6,'reminded',id(108)),'22023');
  });
  await test('overlapping security intervals are deducted once',async()=>{
    await query('insert into driver_duty_check_v2_exclusion_intervals_v1 values($1,$2,$3),($1,$4,$5)',[id(1),'2026-09-10T02:15:15Z','2026-09-10T02:15:45Z','2026-09-10T02:15:30Z','2026-09-10T02:16:00Z']);
    const p=(await query("select operations_shift_presence_v1('2026-09-10T02:15Z','2026-09-10T02:17Z') as p"))[0].p;
    assert.equal(p.raw_seconds,120); assert.equal(p.excluded_seconds,45); assert.equal(p.net_seconds,75);
  });
  if (process.env.SHIFT_FIXTURES_DIR) {
    fs.mkdirSync(process.env.SHIFT_FIXTURES_DIR,{recursive:true});
    fs.writeFileSync(path.join(process.env.SHIFT_FIXTURES_DIR,'report.json'),JSON.stringify(await read()));
    fs.writeFileSync(path.join(process.env.SHIFT_FIXTURES_DIR,'outreach.json'),JSON.stringify(await outreach()));
  }
  await test('issue resolution does not complete the trip and explicit coverage retains responsibility',async()=>{
    await action('ack_trip',1,id(20),null,'one@example.test','primary',110);
    await action('flag_issue',2,id(20),null,'one@example.test','primary',111);
    await action('resolve_issue',3,id(20),null,'one@example.test','primary',112);
    assert.equal((await read()).watch[0].status,'on_trip');
    await action('request_cover',4,null,'two','one@example.test','primary',113);
    assert.equal((await read()).run.monitor_id,'one');
    await action('accept_cover',5,null,null,'two@example.test','primary',114);
    await rejects(()=>contact(115,7),'42501'); await contact(116,7,'needs_help',null,'two@example.test');
    await rejects(()=>action('ack_trip',6,id(20),null,'one@example.test','primary',117),'42501');
  });
  await test('offer expiration is not a cancellation',async()=>{
    await query('insert into booking_lifecycle_events values($1,public.test_now(),$2,$3,$4)',[id(20),'assigned','searching','assignment_expired']);
    await at('2026-09-10T02:17:01Z');
    const r=await read(); assert.equal(r.metrics.offer_expiries,1); assert.equal(r.metrics.cancelled_trips,0);
  });
  await at('2026-09-10T07:00:00Z');
  await test('shift boundary is half-open, reports become read-only, incoming staff acknowledge carry-over',async()=>{
    await rejects(()=>contact(118,7,'reminded',id(116),'two@example.test'),'22023');
    assert.equal((await outreach()).candidates.length,0);
    await action('start',0,null,null,'two@example.test','evening',119);
    const r=await read('two@example.test',false,'evening'); assert.equal(r.watch[0].needs_ack,true); assert.equal(r.metrics.carry_in,1);
    await rejects(()=>contact(120,6,'reminded',id(108),'two@example.test','evening'),'22023');
  });
  await at('2026-09-10T07:05:00Z');
  await test('completed trip is counted in the receiving shift, not the outgoing shift',async()=>{
    await query("update bookings set status='completed',completed_at=public.test_now() where id=$1",[id(20)]);
    await at('2026-09-10T07:05:01Z');
    assert.equal((await read()).metrics.completed_trips,0);
    const r=await read('two@example.test',false,'evening'); assert.equal(r.metrics.completed_trips,1); assert.equal(r.watch.length,0);
  });
  await test('service-only RPCs and immutable outreach / action records',async()=>{
    const rows=await query("select proname,has_function_privilege('anon',oid,'execute') as anon,has_function_privilege('authenticated',oid,'execute') as authenticated from pg_proc where proname like 'operations_shift_%'");
    assert(rows.every(x=>!x.anon&&!x.authenticated));
    const rows2=await query("select t,p,has_table_privilege('service_role',t,p) as allowed from unnest(array['operations_shift_outreach','operations_shift_actions','operations_shift_booking_history']) t cross join unnest(array['UPDATE','DELETE','TRUNCATE']) p");
    assert(rows2.every(x=>!x.allowed));
  });
  console.log(`${passed} PostgreSQL behavior checks passed.`); await db.close();
})().catch(async error=>{console.error(error); await db.close(); process.exitCode=1;});
