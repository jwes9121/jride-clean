const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
function load(file, mocks = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, Date, console, URL, require(name) {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/') || name.startsWith('.')) {
      const base = name.startsWith('@/') ? name.slice(2) : path.join(path.dirname(file), name);
      return load(base + (fs.existsSync(path.join(root, base + '.tsx')) ? '.tsx' : '.ts'), mocks, cache);
    }
    return require(name);
  }});
  cache.set(file, module.exports); return module.exports;
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const eggs = {id:id(1),name:'Eggs',producer_id:id(10),cart_group_key:'one-farm',cargo_class:'fragile_produce',availability_mode:'always_available',selling_unit:'tray',unit_price:200,unit_weight_kg:1.8,remaining_quantity:10,is_active:true,can_order_now:true,vehicle_requirement:'either'};
const tomatoes = {...eggs,id:id(2),name:'Tomatoes',cargo_class:'standard_produce',selling_unit:'kg',unit_price:50,unit_weight_kg:1};
const rice = {...eggs,id:id(3),name:'Rice',cargo_class:'bulk_sack',selling_unit:'sack',unit_weight_kg:25,vehicle_requirement:'tricycle'};
const crate = {...eggs,id:id(4),name:'Vegetable crate',cargo_class:'crate'};
const scheduled = {...tomatoes,availability_mode:'scheduled_harvest',harvest_start_at:'2099-09-21T01:00:00Z',harvest_end_at:null,harvest_order_cutoff_at:'2099-09-20T01:00:00Z'};
function database(products) {
  const calls = [];
  const db = { rpc:async (name,args) => { calls.push({rpc:name,args});throw new Error('Unexpected checkout write or pricing call'); }, from(table) {
    calls.push({table}); let filters=[],cols=[];
    const rows = table==='passenger_addresses' ? [{id:id(20),created_by_user_id:id(30),is_active:true,lat:16.8,lng:121.1,label:'Home'}]
      : table==='agrimarket_products' ? products : table==='agrimarket_pricing_settings' ? [{id:1,is_active:true,base_delivery_fee:40}]
      : table==='agrimarket_producers' ? [{id:id(10),status:'active',accepting_orders:true,store_open:true,pickup_lat:16.85,pickup_lng:121.1,pickup_motorcycle_accessible:true,pickup_tricycle_accessible:true,pickup_roadside_handoff_required:false,pickup_driver_directions:'Test pickup'}] : [];
    const q={select(c){cols=c.split(',');return q;},eq(k,v){filters.push(row=>row[k]===v);return q;},in(k,v){filters.push(row=>v.includes(row[k]));return q;},limit(){return q;},
      result(single){const data=rows.filter(row=>filters.every(f=>f(row))).map(row=>Object.fromEntries(cols.map(k=>[k,row[k]])));return {error:null,data:single?data[0]||null:data};},
      async maybeSingle(){return q.result(true);},then(resolve,reject){return Promise.resolve(q.result(false)).then(resolve,reject);}};return q;
  }};return {db,calls};
}
async function main() {
  const rules=load('lib/agrimarket/cartCompatibility.ts');
  assert.equal(rules.cargoConflict([eggs,tomatoes]),null);
  for(const pair of [[eggs,rice],[tomatoes,crate],[rice,crate],[{...eggs,cargo_class:'live_poultry'},{...tomatoes,cargo_class:'fresh_meat'}]]) assert.match(rules.cargoConflict(pair),/separate orders/);
  assert.equal(rules.cartConflict([scheduled,{...scheduled,name:'Other produce'}]),null);
  assert.match(rules.cartConflict([eggs,scheduled]),/scheduled reservations/);
  assert.match(rules.cartConflict([scheduled,{...scheduled,harvest_start_at:'2099-09-22T01:00:00Z'}]),/different preparation dates/);
  assert.equal(rules.deliveryGroupKey(eggs),rules.deliveryGroupKey(tomatoes));
  assert.notEqual(rules.deliveryGroupKey(eggs),rules.deliveryGroupKey(rice));
  for(const unknown of ['constructor','__proto__','unknown']) assert.equal(rules.cargoFamily(unknown),null);
  console.log('PASS compatible produce groups, isolated cargo, schedule separation and unknown classes');

  const location={'./location':{reverseGeocodeIfugaoTown:async()=> 'Lamut'}};
  const context=load('app/api/agrimarket/_lib/order.ts',location);
  const h=database([eggs,tomatoes]);
  const combined=await context.loadAgrimarketOrderContext(h.db,id(30),id(20),[{product_id:eggs.id,quantity:2},{product_id:tomatoes.id,quantity:3}],'tricycle');
  assert.equal(combined.productSubtotal,550);assert.equal(combined.estimatedCargoWeightKg,6.6);assert.equal(combined.itemSnapshots.length,2);assert(!h.calls.some(c=>c.rpc));
  for(const [rows,code] of [[[eggs,rice],'AGRIMARKET_CARGO_COMPATIBILITY_MISMATCH'],[[eggs,{...tomatoes,producer_id:id(11)}],'AGRIMARKET_SINGLE_PRODUCER_ORDER_REQUIRED'],[[eggs,scheduled],'AGRIMARKET_MIXED_AVAILABILITY_CART_NOT_ALLOWED']]) {
    const b=database(rows);await assert.rejects(context.loadAgrimarketOrderContext(b.db,id(30),id(20),rows.map(row=>({product_id:row.id,quantity:1})),'tricycle'),error=>error.code===code);
    assert(!b.calls.some(c=>c.rpc));
  }
  console.log('PASS combined totals and weight; mixed stores, cargo and schedules fail before mutation');

  for(const endpoint of ['quote','orders']) {
    const b=database([eggs,rice]);let routed=0;
    const api=load(`app/api/agrimarket/${endpoint}/route.ts`,{...location,'next/server':{},'../_lib/server':{
      agrimarketEnabled:()=>true,requireAgrimarketPassenger:async()=>({ok:true,user:{id:id(30)}}),createServiceSupabase:()=>b.db,jsonNoStore:(status,body)=>({status,body}),
    },'../_lib/routing':{fetchAgrimarketDrivingRoute:async()=>{routed++;throw new Error('Should reject before routing');}},'@/lib/agrimarket/browserPushServer':{}});
    const response=await api.POST({headers:{get:()=>id(99)},json:async()=>({address_id:id(20),preferred_vehicle_type:'tricycle',items:[{product_id:eggs.id,quantity:1},{product_id:rice.id,quantity:1}],cargo_class:'produce'})});
    assert.equal(response.status,409);assert.equal(response.body.error,'AGRIMARKET_CARGO_COMPATIBILITY_MISMATCH');assert.match(response.body.message,/Eggs.*Rice.*separate orders/);assert.equal(routed,0);assert(!b.calls.some(c=>c.rpc));
  }
  console.log('PASS quote and checkout use database cargo classes and reject before route, pricing or stock writes');

  const weight=load('lib/agrimarket/weightValidation.ts').weightConfirmationError;
  assert.match(weight('approximate','18',''),/Select a weight range/);
  assert.equal(weight('approximate','18','16_25'),null);assert.equal(weight('approximate','','101_200'),null);
  assert.equal(weight('exact','18',''),null);assert.equal(weight('exact','200',''),null);
  for(const kg of ['','0','-1','NaN','Infinity','201']) assert(weight('exact',kg,''));
  assert(weight('approximate','','over_200'));assert(weight('approximate','-1','16_25'));
  console.log('PASS visible weight blockers cover missing band, measured weight and the 200 kg limit');

  const profile=load('app/agrimarket/StoreProfile.tsx',{'@/lib/passenger/browserSession':{},'./ProductPhoto':{ProductPhoto:()=>null},react:{...React,useState:value=>[value===null?{name:'Test Farm',town:'Lamut',store_status:'open',store_status_label:'Accepting orders'}:value,()=>{}],useEffect(){}}}).default;
  const props={productId:eggs.id,products:[eggs,tomatoes,rice],cartProducts:[eggs],otherStoreName:null,busy:false,onAdd(){},onClose(){},onReviewCart(){}};
  const html=renderToStaticMarkup(React.createElement(profile,props));
  for(const text of ['Test Farm','Produce and fragile produce','Sacks','10 tray listed','separate orders','Review cart (1)','aria-describedby="store-blocker-'+rice.id+'"']) assert(html.includes(text),text);
  assert.equal((html.match(/disabled=""/g)||[]).length,1);
  const other=renderToStaticMarkup(React.createElement(profile,{...props,otherStoreName:'Existing farm'}));
  assert.equal((other.match(/disabled=""/g)||[]).length,3);assert(other.includes('Your cart belongs to Existing farm'));
  console.log('PASS store view groups compatible items and explains blocked buttons without replacing another store cart');

  const sent=[];
  const approval=load('app/api/agrimarket/order-reapproval-response/route.ts',{'next/server':{},'../_lib/server':{
    agrimarketEnabled:()=>true,requireAgrimarketPassenger:async()=>({ok:true,user:{id:id(30)}}),jsonNoStore:(status,body)=>({status,body}),createServiceSupabase:()=>({rpc:async(name,args)=>{sent.push({name,args});return {data:{ok:false,error:'AGRIMARKET_REAPPROVAL_PROPOSAL_STALE'},error:null};}}),
  }});
  const denied=await approval.POST({json:async()=>({order_code:'AG-TEST',response:'accept',expected_total:1791,expected_vehicle:'tricycle',expected_deadline:'2026-09-21T00:05:00Z'})});
  assert.equal(denied.status,409);assert.match(denied.body.message,/No approval was recorded/);
  assert.equal(sent[0].name,'agrimarket_customer_respond_reapproval_v2');assert.equal(sent[0].args.p_expected_total,1791);assert.equal(sent[0].args.p_expected_vehicle,'tricycle');assert.equal(sent[0].args.p_expected_deadline,'2026-09-21T00:05:00Z');
  console.log('PASS friendly approval error retains the exact revision safety checks');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
