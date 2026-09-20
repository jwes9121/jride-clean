const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname,'../..');
function load(file,mocks={}) {
  const module={exports:{}};
  const js=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js,{module,exports:module.exports,Date,console,require(name){
    if(name in mocks)return mocks[name];
    if(name.startsWith('@/'))return load(name.slice(2)+'.ts',mocks);
    if(name.startsWith('.')) { const base=path.join(path.dirname(file),name);return load(fs.existsSync(path.join(root,base+'.tsx'))?base+'.tsx':base+'.ts',mocks); }
    return require(name);
  }});return module.exports;
}
async function main() {
  const {agrimarketAdminActions}=load('lib/agrimarket/adminActions.ts');
  assert.equal(agrimarketAdminActions({status:'awaiting_customer_reapproval'},null).can_cancel,true);
  assert.equal(agrimarketAdminActions({status:'awaiting_customer_reapproval'},null).can_reassign,false);
  assert.equal(agrimarketAdminActions({status:'dispatching'},'offer').can_reassign,true);
  assert.equal(agrimarketAdminActions({status:'driver_assigned',assigned_driver_id:'driver',customer_cash_collected_amount:1},null).can_reassign,false);
  assert.equal(agrimarketAdminActions({status:'completed'},null).can_cancel,false);
  console.log('PASS Admin controls respect approval, assignment, cash and terminal states');
  let role='dispatcher',calls=[],dispatchFails=false;
  const server={agrimarketEnabled:()=>true,jsonNoStore:(status,body)=>({status,body}),requireAgrimarketStaff:async adminOnly=>adminOnly&&role!=='admin'?{ok:false,response:{status:403}}:{ok:true,role,actor:'actual-admin'},createServiceSupabase:()=>({rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,action:args.p_action,order_id:'order'},error:null};}})};
  const admin=load('app/api/agrimarket/admin/dispatch/route.ts',{'next/server':{},'../../_lib/server':server,'@/lib/agrimarket/dispatch':{offerAgrimarketDriver:async()=>{if(dispatchFails)throw new Error('offline');return{offered:true};}}});
  const action=async(body)=>admin.POST({json:async()=>body});
  const body={action:'cancel',order_code:'AG-X',expected_status:'awaiting_customer_reapproval',note:'Customer asked to cancel',actor:'forged'};
  assert.equal((await action(body)).status,403);assert.equal(calls.length,0);
  role='admin';assert.equal((await action({...body,note:'x'})).status,400);assert.equal(calls.length,0);
  assert.equal((await action(body)).status,200);assert.equal(calls[0].args.p_actor,'actual-admin');
  dispatchFails=true;const result=await action({...body,action:'reassign'});assert.equal(result.status,200);assert.equal(result.body.ok,true);assert.equal(result.body.dispatch.ok,false);
  console.log('PASS authenticated Admin action, required reason, trusted actor and honest matching-failure result');
  const privateStore={vendor_name:'Test Farm Store',town:'Lamut',contact_name:'PRIVATE OWNER',contact_phone:'PRIVATE PHONE',pickup_lat:16.7,pickup_lng:121.1};
  let denied=false,missing=false;const reads=[];
  const storeServer={agrimarketEnabled:()=>true,jsonNoStore:server.jsonNoStore,requireAgrimarketPassenger:async()=>denied?{ok:false,response:{status:401}}:{ok:true},createServiceSupabase:()=>({from(table){let columns=[];const q={select(c){columns=c.split(',');reads.push(c);return q;},eq(){return q;},async maybeSingle(){const raw=table==='agrimarket_products'?{producer_id:'private-id'}:privateStore;return {error:null,data:missing?null:Object.fromEntries(columns.map(k=>[k,raw[k]]))};}};return q;}})};
  const store=load('app/api/agrimarket/store/route.ts',{'next/server':{},'../_lib/server':storeServer});
  const req={nextUrl:new URL('https://test.invalid/?product_id=00000000-0000-4000-8000-000000000001')};
  denied=true;assert.equal((await store.GET(req)).status,401);assert.equal(reads.length,0);
  denied=false;const profile=await store.GET(req);assert.equal(profile.status,200);assert.equal(profile.body.store.name,'Test Farm Store');
  for(const field of ['PRIVATE','pickup_lat','contact_phone','producer_id','private-id'])assert(!JSON.stringify(profile.body).includes(field));
  missing=true;assert.equal((await store.GET(req)).status,404);
  console.log('PASS store profile reveals the store name and town only, with authentication and availability checks');
  let writes=0;
  const incomplete=load('app/api/agrimarket/producer/products/route.ts',{'next/server':{},'../../_lib/server':{
    agrimarketFarmerPortalEnabled:()=>true,jsonNoStore:server.jsonNoStore,
    requireAgrimarketProducer:async()=>({ok:true,producer:{id:'farm',vendor_name:null}}),
    createServiceSupabase:()=>({from(){writes++;throw new Error('Must not write');}}),
  }});
  for(const action of [{action:'create'},{action:'set_active',is_active:true}]) {
    const blocked=await incomplete.POST({json:async()=>action});
    assert.equal(blocked.status,400);assert.equal(blocked.body.error,'AGRIMARKET_STORE_NAME_REQUIRED');
  }
  assert.equal(writes,0);
  console.log('PASS missing store name blocks product publication before any write');
  const countdown=load('components/agrimarket/ReapprovalCountdown.tsx');
  assert.equal(countdown.reapprovalSeconds('2026-09-20T00:05:00Z',Date.parse('2026-09-20T00:00:00Z')),300);
  assert.equal(countdown.reapprovalSeconds('2026-09-20T00:05:00Z',Date.parse('2026-09-20T00:05:00Z')),0);
  assert.equal(countdown.reapprovalSeconds(null,Date.now()),null);
  const dialog=load('components/agrimarket/CustomerReapprovalDialog.tsx').default;
  const html=renderToStaticMarkup(React.createElement(dialog,{proposal:{approved_total:100,revised_total:140,increase_amount:40,approved_vehicle_type:'tricycle',revised_vehicle_type:'kolong_kolong',vehicle_escalated:true,expires_at:'2026-09-20T00:05:00Z'},serverNow:'2026-09-20T00:00:00Z',onRespond(){},onExpire(){},busy:false,error:''}));
  for(const value of ['5:00 remaining','Kolong-Kolong','PHP 140.00','Accept revised charges','Cancel order','<dialog'])assert(html.includes(value),value);
  assert(!html.includes('disabled=""'));
  const expired=renderToStaticMarkup(React.createElement(dialog,{proposal:{expires_at:'2026-09-20T00:00:00Z'},serverNow:'2026-09-20T00:05:00Z',onRespond(){},onExpire(){},busy:false,error:''}));
  assert(expired.includes('disabled=""'));assert(expired.includes('Approval time expired'));
  console.log('PASS approval dialog shows deadline, accurate vehicle escalation, visible actions and expiry blocking');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
