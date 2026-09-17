const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const root = require('node:path').resolve(__dirname, '../..');

function load(file, mocks={}) {
 const module={exports:{}};
 const code=ts.transpileModule(fs.readFileSync(root+'/'+file,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(code,{module,exports:module.exports,require:n=>mocks[n]||require(n),Date,setTimeout,clearTimeout,console,process:{env:{SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only'}}},{filename:file});
 return module.exports;
}

const {fareProposal,mergeConfirmedOrder,startFareReminders,expectedFare}=load('app/takeout/fareProposal.ts');
const start=Date.now();
const OWNER='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
const order={service_type:'takeout',id:'test-only',booking_code:'TO-FIXTURE',created_by_user_id:OWNER,takeout_pricing_status:'driver_fee_proposed',takeout_fee_proposed_at:new Date(start).toISOString(),takeout_fee_expires_at:new Date(start+300000).toISOString(),takeout_total_payable:130,takeout_delivery_fee:25,takeout_service_fee:15,takeout_items_subtotal:90,driver_name:'Test driver',takeout_fee_proposed_by_driver_id:'driver-test',vendor_status:'driver_accepted',customer_status:'driver_accepted',status:'assigned'};
let passed=0;
async function test(name, fn) { await fn(); console.log('PASS: '+name); ++passed; }

function clock(at=start) {
 let now=at,id=0;const tasks=new Map();
 return {now:()=>now,set:(fn,ms)=>{tasks.set(++id,{fn,due:now+ms});return id;},clear:id=>tasks.delete(id),advance:ms=>{const target=now+ms;while(true){const entry=[...tasks].filter(([,t])=>t.due<=target).sort((a,b)=>a[1].due-b[1].due)[0];if(!entry)break;now=entry[1].due;tasks.delete(entry[0]);entry[1].fn();}now=target;},jump:ms=>{now+=ms;},tasks};
}

function apiHarness(changes={},race,auth={}) {
 let row={...order,...changes};
 let writes=0,inventory=0,bookingReads=0,bearerReads=0,cookieReads=0,deviceChecks=0;
 const bearerUserId=Object.prototype.hasOwnProperty.call(auth,'bearerUserId')?auth.bearerUserId:OWNER;
 const cookieUserId=Object.prototype.hasOwnProperty.call(auth,'cookieUserId')?auth.cookieUserId:null;
 const deviceOk=Object.prototype.hasOwnProperty.call(auth,'deviceOk')?auth.deviceOk:true;
 const deviceError=auth.deviceError||null;
 const defaultHeaders={authorization:'Bearer owner-token','x-device-id':'device-test'};
 const requestHeaders=Object.prototype.hasOwnProperty.call(auth,'headers')?auth.headers:defaultHeaders;

 const db={
  auth:{getUser:async()=>{bearerReads++;return bearerUserId?{data:{user:{id:bearerUserId}},error:null}:{data:{user:null},error:{message:'invalid bearer'}};}},
  rpc:async(name)=>{if(name!=='jride_passenger_validate_device_session')return {data:null,error:{message:'unexpected rpc'}};deviceChecks++;return deviceError?{data:null,error:{message:deviceError}}:{data:deviceOk?{ok:true}:{ok:false,error:'ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE'},error:null};},
  from(table){let mode='read',patch={},checks=[];const q={
   select(){return q;},limit(){return q;},eq(k,v){checks.push(r=>String(r[k])===String(v));return q;},is(k,v){checks.push(r=>r[k]==v);return q;},gt(k,v){checks.push(r=>Date.parse(r[k])>Date.parse(v));return q;},update(v){mode='write';patch=v;return q;},maybeSingle(){return finish();},single(){return finish();},then(a,b){return finish().then(a,b);}};
   async function finish(){if(table!=='bookings'){inventory++;return {data:[],error:null};}if(mode==='read')bookingReads++;if(mode==='write'&&race){const fn=race;race=null;fn(row);}if(!checks.every(f=>f(row)))return {data:null,error:null};if(mode==='write'){writes++;Object.assign(row,patch);}return {data:{...row},error:null};}return q;
  }
 };
 const cookieDb={auth:{getUser:async()=>{cookieReads++;return cookieUserId?{data:{user:{id:cookieUserId}},error:null}:{data:{user:null},error:null};}}};
 const api=load('app/api/takeout/confirm-fee/route.ts',{
  'next/server':{NextResponse:{json:(body,o)=>({body,status:o?.status||200})}},
  '@supabase/supabase-js':{createClient:()=>db},
  '@/utils/supabase/server':{createClient:()=>cookieDb},
 });
 const headers={get:name=>String(requestHeaders?.[String(name).toLowerCase()]||'')};
 return {
  call:(extra={})=>api.POST({headers,json:async()=>({order_id:order.id,confirm:true,expected_proposal:expectedFare(order),...extra})}),
  stats:()=>({row,writes,inventory,bookingReads,bearerReads,cookieReads,deviceChecks}),
 };
}

(async()=>{
 await test('valid proposal; cancelled, completed, confirmed, invalid and expired deadlines cannot confirm',()=>{
  assert(fareProposal(order,start));
  for(const state of ['cancelled','completed','vendor_timeout'])for(const field of ['status','customer_status','vendor_status'])assert.equal(fareProposal({...order,[field]:state},start),null);
  for(const expiry of [null,'bad',new Date(start).toISOString()])assert.equal(fareProposal({...order,takeout_fee_expires_at:expiry},start),null);
  assert.equal(fareProposal({...order,takeout_customer_confirmed_at:new Date(start).toISOString()},start),null);
  assert.equal(fareProposal({...order,takeout_pricing_status:'customer_confirmed'},start),null);
  assert.equal(fareProposal({...order,takeout_fee_expires_at:new Date(start+600000).toISOString()},start).deadline,start+300000);
 });

 await test('sound plays on arrival and at 30..270 seconds; stops at 300 without an extra sound',()=>{
  const c=clock(),times=[];let expired=0;startFareReminders(start+300000,()=>times.push(c.now()-start),()=>expired++,c);c.advance(600000);
  assert.deepEqual(times,[0,30000,60000,90000,120000,150000,180000,210000,240000,270000]);assert.equal(expired,1);assert.equal(c.tasks.size,0);
 });

 await test('late open keeps original expiry; cancellation/unmount/replacement stops the previous timer',()=>{
  const c=clock(start+275000),times=[];let expired=0;const x=startFareReminders(start+300000,()=>times.push(c.now()),()=>expired++,c);c.advance(25000);assert.equal(times.length,1);assert.equal(expired,1);x.stop();
  const d=clock(),events=[];const a=startFareReminders(start+300000,()=>events.push('old'),()=>{},d);d.advance(10000);a.stop();const b=startFareReminders(start+310000,()=>events.push('new'),()=>{},d);d.advance(30000);b.stop();d.advance(500000);assert.deepEqual(events,['old','new','new']);assert.equal(d.tasks.size,0);
 });

 await test('suspended page does not play missed alerts after expiry or burst on resume',()=>{
  const c=clock();let plays=0,expired=0;const a=startFareReminders(start+300000,()=>plays++,()=>expired++,c);c.jump(125000);a.check();assert.equal(plays,2);c.jump(200000);a.check();assert.equal(plays,2);assert.equal(expired,1);assert.equal(c.tasks.size,0);
 });

 await test('confirmation preserves PHP 90 food, PHP 130 total and driver identity; never mixes orders',()=>{
  const updated=mergeConfirmedOrder(order,{id:order.id,takeout_pricing_status:'customer_confirmed'});assert.equal(updated.takeout_items_subtotal,90);assert.equal(updated.driver_name,'Test driver');assert.equal(updated.takeout_total_payable,130);assert.equal(updated.takeout_pricing_status,'customer_confirmed');assert.equal(mergeConfirmedOrder(order,{id:'different'}),order);
 });

 await test('server rejects a changed total or expired quote and preserves replacement during expiry',async()=>{
  const changed=apiHarness({takeout_total_payable:160});assert.equal((await changed.call()).status,409);assert.equal(changed.stats().writes,0);
  const expired=apiHarness({takeout_fee_expires_at:new Date(start-1).toISOString()},r=>{r.takeout_fee_expires_at=new Date(start+400000).toISOString();});assert.equal((await expired.call()).status,409);assert.equal(expired.stats().writes,0);
 });

 await test('atomic confirmation loses safely to cancellation, expiry, quote replacement, ownership change and duplicate acceptance',async()=>{
  for(const mutation of [r=>r.status='cancelled',r=>r.vendor_status='completed',r=>r.takeout_pricing_status='customer_confirmed',r=>r.takeout_total_payable=200,r=>r.takeout_fee_proposed_by_driver_id='another',r=>r.takeout_fee_expires_at=new Date(start-1).toISOString(),r=>r.created_by_user_id=OTHER]){const h=apiHarness({},mutation);assert.equal((await h.call()).status,409);assert.equal(h.stats().writes,0);assert.equal(h.stats().inventory,0);}
 });

 await test('valid authenticated owner confirms once and older payloads remain compatible',async()=>{
  for(const extra of [{},{expected_proposal:undefined}]){const h=apiHarness();assert.equal((await h.call(extra)).status,200);assert.equal(h.stats().writes,1);assert.equal(h.stats().row.vendor_status,'driver_accepted');assert.equal((await h.call(extra)).status,409);assert.equal(h.stats().writes,1);}
 });

 await test('unauthenticated confirmation is rejected before booking or inventory access',async()=>{
  const h=apiHarness({},null,{headers:{},bearerUserId:null,cookieUserId:null});
  const r=await h.call();assert.equal(r.status,401);assert.equal(r.body.error,'TAKEOUT_CONFIRM_AUTH_REQUIRED');assert.equal(h.stats().bookingReads,0);assert.equal(h.stats().writes,0);assert.equal(h.stats().inventory,0);
 });

 await test('invalid native bearer cannot fall back to a browser cookie',async()=>{
  const h=apiHarness({},null,{headers:{authorization:'Bearer bad-token','x-device-id':'device-test'},bearerUserId:null,cookieUserId:OWNER});
  const r=await h.call();assert.equal(r.status,401);assert.equal(h.stats().bearerReads,1);assert.equal(h.stats().cookieReads,0);assert.equal(h.stats().bookingReads,0);
 });

 await test('invalid native device session is rejected before booking access',async()=>{
  const h=apiHarness({},null,{deviceOk:false});
  const r=await h.call();assert.equal(r.status,401);assert.equal(h.stats().deviceChecks,1);assert.equal(h.stats().bookingReads,0);assert.equal(h.stats().writes,0);
 });

 await test('authenticated passenger cannot confirm another passenger Takeout order',async()=>{
  const h=apiHarness({},null,{bearerUserId:OTHER});
  const r=await h.call();assert.equal(r.status,403);assert.equal(r.body.error,'TAKEOUT_CONFIRM_FORBIDDEN');assert.equal(h.stats().writes,0);assert.equal(h.stats().inventory,0);
 });

 await test('browser cookie owner remains supported without native headers',async()=>{
  const h=apiHarness({},null,{headers:{},bearerUserId:null,cookieUserId:OWNER});
  const r=await h.call({expected_proposal:undefined});assert.equal(r.status,200);assert.equal(h.stats().cookieReads,1);assert.equal(h.stats().writes,1);
 });

 const trackSource=fs.readFileSync(root+'/app/takeout/track/[bookingCode]/page.tsx','utf8');
 await test('tracking-page confirmation forwards passenger bearer and native device headers',()=>{
  assert.match(trackSource,/function currentPassengerAuthHeaders\(\)/);
  assert.match(trackSource,/jride_passenger_token/);
  assert.match(trackSource,/jride_native_device_id/);
  assert.match(trackSource,/\.\.\.currentPassengerAuthHeaders\(\)/);
 });

 console.log(passed+' confirmation checks passed. No network or live data used.');
})().catch(e=>{console.error(e);process.exitCode=1;});
