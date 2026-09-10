// node scripts/test-agrimarket-action-state.cjs
// Executes the real routes, state reader, auth resolver and Supabase query builder.
// All HTTP responses and write RPCs are local fixtures; no live data is changed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { createClient } = require('@supabase/supabase-js');
const DRIVER = '00000000-0000-4000-8000-000000000002';
const OTHER = '00000000-0000-4000-8000-000000000001';
const DEVICE = '0123456789abcdef';
const TOKEN_ID = '11111111-1111-4111-8111-111111111111';
const SECRET = 'a'.repeat(64);
const TOKEN = `agdev.${TOKEN_ID}.${SECRET}`;
const CODE = 'AG-STATE-TEST';
const NOW = new Date().toISOString();
const authRow = () => ({id:TOKEN_ID, token_sha256:crypto.createHash('sha256').update(SECRET).digest('hex'), device_id:DEVICE, driver_id:DRIVER, status:'approved', created_at:NOW});
const orderRow = () => ({id:'order-test',order_code:CODE,assigned_driver_id:DRIVER,producer_id:'producer-test',status:'driver_assigned',updated_at:NOW,
  product_subtotal:110,producer_product_net:110,cash_collection_required:false,cash_collection_amount:0,
  customer_cash_collected_at:null,customer_cash_collected_amount:0,producer_paid_at:null,producer_paid_amount:0,
  pickup_issue:null,route_plan:'farmer_first',assignment_anchor:'farmer',delivery_label:'Test meetup',delivery_lat:16.65,delivery_lng:121.21,
  delivery_fee:50,delivery_company_cut:20,pickup_distance_fee:0,heavy_load_fee:0,handling_fee:0,handling_reason:null,handling_locked_at:null,
  driver_delivery_payout:30,confirmed_cargo_weight_basis:'exact',confirmed_cargo_weight_kg:2,confirmed_handling_tier:'standard',
  total_payable:160,final_cash_collected_at:null,final_cash_collected_amount:0,wallet_settlement_status:'pending',wallet_settlement_amount:0,wallet_settlement_error:null,ready_at:NOW});
function fixtures() {return {
  agrimarket_driver_devices:[authRow()], agrimarket_driver_offers:[], agrimarket_orders:[orderRow()],
  agrimarket_producers:[{id:'producer-test',vendor_name:'Private farmer',contact_name:'Private name',contact_phone:'fixture-phone',town:'Lamut',pickup_lat:16.65,pickup_lng:121.21,pickup_label:'Private pin'}],
  agrimarket_order_items:[{id:'item-test',order_id:'order-test',product_name:'Demo tomatoes',quantity:2,condition_required:'fresh',cargo_class:'produce',handling_eligible:false}],
  agrimarket_pickup_checks:[]
};}
function harness(options={}) {
  const rows=fixtures(), calls=[], rpcs=[];
  const state={rows,calls,rpcs, rpcResult:{ok:true,status:'driver_assigned'}, mutation:()=>{rows.agrimarket_orders[0].producer_paid_at=NOW;rows.agrimarket_orders[0].producer_paid_amount=110;}};
  async function fakeFetch(input,init={}) {
    const url=new URL(String(input)), table=url.pathname.split('/').pop(), method=init.method||'GET';
    calls.push({table,method,url,cache:init.cache,signal:init.signal});
    if (url.pathname.includes('/rpc/')) {
      rpcs.push({name:table,args:JSON.parse(init.body)});
      if (options.rpcError) return Response.json({message:'fixture RPC failure'},{status:400});
      if (state.rpcResult.ok!==false) state.mutation();
      return Response.json(state.rpcResult);
    }
    assert.ok(Object.hasOwn(rows,table),`Unexpected table ${table}`);
    if (options.hangTable===table) await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('fixture failed to abort')),6500);
      const abort=()=>{clearTimeout(timer);reject(init.signal.reason);};
      if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
    });
    if (options.throwTable===table) throw Error('fixture transport failure');
    if (options.failTable===table) return Response.json({message:'fixture read failure'},{status:400});
    let selected=rows[table].filter(row=>[...url.searchParams].every(([key,value])=>{
      if(['select','order','limit','offset'].includes(key))return true;
      const dot=value.indexOf('.'), op=value.slice(0,dot), val=value.slice(dot+1);
      if(op==='eq')return String(row[key])===val;
      if(op==='in')return val.slice(1,-1).split(',').includes(String(row[key]));
      if(op==='gt')return row[key]>val;
      if(op==='lte')return row[key]<=val;
      throw Error(`Unexpected filter ${key} ${value}`);
    }));
    if(url.searchParams.get('order')) {
      const [key,dir]=url.searchParams.get('order').split('.');
      selected.sort((a,b)=>(a[key]>b[key]?1:a[key]<b[key]?-1:0)*(dir==='desc'?-1:1));
    }
    if(url.searchParams.has('limit'))selected=selected.slice(0,Number(url.searchParams.get('limit')));
    if(method==='PATCH') {for(const row of selected)Object.assign(row,JSON.parse(init.body));return new Response(null,{status:204});}
    assert.equal(method,'GET','State loading must be read-only');
    const fields=url.searchParams.get('select');
    if(fields && fields!=='*')selected=selected.map(row=>Object.fromEntries(fields.split(',').filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));
    return Response.json(selected);
  }
  const modules={};
  function load(path,sourceOverride) {
    if(!sourceOverride && modules[path])return modules[path];
    const exports={};
    const code=ts.transpileModule(sourceOverride||fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{exports,Request,Response,Headers,URL,Date,AbortSignal,AbortController,fetch:fakeFetch,console,
      process:{env:{SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-key'}},
      require:id=>{
        if(id==='next/server')return {NextResponse:Response};
        if(id==='crypto')return crypto;
        if(id==='@supabase/supabase-js')return {createClient:(url,key,opts)=>createClient(url,key,{...opts,global:{...opts?.global,fetch:opts?.global?.fetch||fakeFetch}})};
        if(id==='@/app/api/agrimarket/_lib/server')return {agrimarketEnabled:()=>!options.disabled};
        if(id==='@/lib/agrimarket/dispatch')return {offerAgrimarketDriver:()=>{throw Error('Unexpected dispatch');}};
        if(id.startsWith('@/'))return load(id.slice(2)+'.ts');
        throw Error(`Unexpected module ${id}`);
      }
    },{filename:path});
    if(!sourceOverride)modules[path]=exports;
    return exports;
  }
  const get=load('app/api/driver/agrimarket/offer/route.ts').GET;
  const post=load('app/api/driver/agrimarket/action/route.ts').POST;
  function request(kind,extra={}) {
    const headers={'Content-Type':'application/json','Authorization':`Bearer ${extra.token??TOKEN}`,'x-jride-device-id':extra.device??DEVICE};
    if(extra.missingToken)delete headers.Authorization;
    if(extra.includeState!==false)headers['x-jride-agrimarket-state']=extra.version??'1';
    return new Request(`https://fixture.invalid/api/driver/agrimarket/${kind}?driver_id=${extra.driver??DRIVER}`,{
      method:kind==='offer'?'GET':'POST',headers,...(kind==='offer'?{}:{body:JSON.stringify({driver_id:extra.driver??DRIVER,order_code:extra.orderCode??CODE,action:extra.action??'pay_farmer',payload:extra.payload??{amount:110}})})});
  }
  async function call(fn,req) {const res=await fn(req);assert.match(res.headers.get('Cache-Control'),/no-store/);return {status:res.status,body:await res.json()};}
  return Object.assign(state,{load,request,call,get:extra=>call(get,request('offer',extra)),post:extra=>call(post,request('action',extra))});
}
let count=0;
async function test(name,fn){await fn();count++;console.log('PASS '+name);}
(async()=>{
  await test('normal save returns scoped updated state with one unchanged write RPC',async()=>{
    const h=harness(),r=await h.post();assert.equal(r.status,200);assert.equal(h.rpcs.length,1);
    assert.equal(h.rpcs[0].name,'agrimarket_driver_execute_v2');
    assert.deepEqual(h.rpcs[0].args.p_payload,{amount:110});assert.equal(h.rpcs[0].args.p_driver_id,DRIVER);
    const e=r.body.driver_state;assert.equal(e.version,1);assert.equal(e.driver_id,DRIVER);assert.equal(e.order_code,CODE);assert.equal(e.action,'pay_farmer');
    assert.equal(e.snapshot.order.next_action,'verify_pickup');assert.equal(e.snapshot.order.producer_paid_amount,110);
    assert.equal(e.snapshot.order.final_cash_due,160);assert.equal(e.snapshot.order.driver_delivery_payout,30);
    const business=h.calls.filter(c=>c.table!=='agrimarket_driver_devices');
    assert.ok(business.every(c=>c.cache==='no-store'));
    const read=business.find(c=>c.table==='agrimarket_orders');
    assert.equal(read.url.searchParams.get('assigned_driver_id'),'eq.'+DRIVER);
    assert.equal(read.url.searchParams.get('order_code'),'eq.'+CODE);
    assert.ok(business.filter(c=>c.method==='GET').every(c=>c.signal));
    assert.equal(business.filter(c=>c.method==='PATCH').length,0);
    if(process.env.AGRIMARKET_ANDROID_FIXTURE)fs.writeFileSync(process.env.AGRIMARKET_ANDROID_FIXTURE,JSON.stringify(r.body));
  });
  for(const extra of [{includeState:false},{version:'2'}])await test('old or unsupported client response stays unchanged',async()=>{
    const h=harness();const r=await h.post(extra);assert.equal(r.status,200);assert.equal(r.body.driver_state,undefined);
    assert.equal(h.calls.filter(c=>c.table==='agrimarket_orders').length,0);assert.equal(h.rpcs.length,1);
  });
  for(const table of ['agrimarket_orders','agrimarket_producers','agrimarket_order_items','agrimarket_pickup_checks'])await test('saved action survives state read failure: '+table,async()=>{
    const h=harness({failTable:table}),r=await h.post();assert.equal(r.status,200);assert.equal(r.body.ok,true);
    assert.equal(r.body.driver_state,null);assert.ok(r.body.driver_state_error);assert.equal(h.rpcs.length,1);
    assert.equal(h.rows.agrimarket_orders[0].producer_paid_amount,110);
  });
  await test('transport exception after commit preserves save success',async()=>{
    const h=harness({throwTable:'agrimarket_orders'}),r=await h.post();assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.driver_state,null);assert.equal(h.rpcs.length,1);
  });
  await test('state read deadline preserves committed action success',async()=>{
    const h=harness({hangTable:'agrimarket_orders'}),r=await h.post();
    assert.equal(r.status,200);assert.equal(r.body.ok,true);assert.equal(r.body.driver_state,null);assert.equal(h.rpcs.length,1);
    assert.ok(h.calls.find(c=>c.table==='agrimarket_orders').signal.aborted);
  });
  for(const mismatch of ['driver','order'])await test('snapshot cannot expose another driver or order: '+mismatch,async()=>{
    const h=harness();h.rows.agrimarket_orders[0][mismatch==='driver'?'assigned_driver_id':'order_code']=mismatch==='driver'?OTHER:'OTHER-ORDER';
    const r=await h.post();assert.equal(r.body.driver_state,null);assert.equal(h.calls.filter(c=>c.table==='agrimarket_producers').length,0);
  });
  for(const [label,configure,extra,status] of [
    ['pending',h=>h.rows.agrimarket_driver_devices[0].status='pending',{},403],
    ['revoked',h=>h.rows.agrimarket_driver_devices[0].status='revoked',{},403],
    ['expired',h=>Object.assign(h.rows.agrimarket_driver_devices[0],{status:'pending',created_at:'2000-01-01T00:00:00Z'}),{},403],
    ['wrong driver',()=>{}, {driver:OTHER},403],['wrong device',()=>{}, {device:'fedcba9876543210'},401],
    ['wrong token',()=>{}, {token:`agdev.${TOKEN_ID}.${'b'.repeat(64)}`},401],['missing token',()=>{}, {missingToken:true},401]
  ])for(const kind of ['get','post'])await test(`${kind} rejects ${label} before business reads or writes`,async()=>{
    const h=harness();configure(h);const r=await h[kind](extra);assert.equal(r.status,status);assert.equal(h.rpcs.length,0);
    assert.equal(h.calls.filter(c=>c.table!=='agrimarket_driver_devices').length,0);
  });
  await test('approval revocation is reread for every action',async()=>{
    const h=harness();assert.equal((await h.post()).status,200);h.rows.agrimarket_driver_devices[0].status='revoked';
    assert.equal((await h.post()).status,403);assert.equal(h.rpcs.length,1);
  });
  for(const options of [{rpcError:true},{disabled:true}])await test('failed or disabled actions never fetch a snapshot',async()=>{
    const h=harness(options),r=await h.post();assert.equal(r.body.ok,false);assert.equal(h.calls.filter(c=>c.table==='agrimarket_orders').length,0);
  });
  await test('business rejection preserves original conflict response',async()=>{
    const h=harness();h.rpcResult={ok:false,error:'FARMER_PAYMENT_REQUIRED'};const r=await h.post();assert.equal(r.status,409);assert.equal(r.body.driver_state,undefined);assert.equal(h.calls.filter(c=>c.table==='agrimarket_orders').length,0);
  });
  await test('completion keeps the settlement receipt and skips state reads',async()=>{
    const h=harness();h.rpcResult={ok:true,status:'completed',final_cash_collected:160,settlement:{settled:true,wallet_settlement_amount:20,wallet_balance_after:980}};
    const r=await h.post({action:'confirm_delivery',payload:{final_cash_collected_amount:160}});
    assert.equal(r.body.settlement.wallet_settlement_amount,20);assert.equal(r.body.settlement.wallet_balance_after,980);assert.equal(h.rpcs.length,1);
    assert.equal(h.calls.filter(c=>c.table==='agrimarket_orders').length,0);
  });
  for(const status of ['driver_assigned','picked_up','delivering','delivered'])await test('polling and action snapshots agree for '+status,async()=>{
    const h=harness();h.rows.agrimarket_orders[0].status=status;h.rpcResult.status=status;h.mutation=()=>{};
    const post=await h.post(),get=await h.get();assert.deepEqual(post.body.driver_state.snapshot,get.body);
    if(process.env.AGRIMARKET_BASELINE_OFFER) {
      const old=h.load('baseline-offer.ts',fs.readFileSync(process.env.AGRIMARKET_BASELINE_OFFER,'utf8'));
      assert.deepEqual(get,await h.call(old.GET,h.request('offer')));
    }
  });
  await test('offered jobs retain farmer privacy',async()=>{
    const h=harness();h.rows.agrimarket_orders[0].status='dispatching';h.rows.agrimarket_driver_offers=[{id:'offer-test',order_id:'order-test',driver_id:DRIVER,status:'offered',assignment_anchor:'farmer',offered_at:NOW,expires_at:new Date(Date.now()+300000).toISOString()}];
    const r=await h.get();assert.equal(r.body.state,'offered');assert.equal(r.body.privacy.farmer_identity_revealed,false);
    assert.doesNotMatch(JSON.stringify(r.body),/Private farmer|Private pin|fixture-phone/);
    if(process.env.AGRIMARKET_BASELINE_OFFER){const old=h.load('baseline-offer.ts',fs.readFileSync(process.env.AGRIMARKET_BASELINE_OFFER,'utf8'));assert.deepEqual(r,await h.call(old.GET,h.request('offer')));}
  });
  console.log(`PASS ${count} scenarios. No live requests or payment RPC execution.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
