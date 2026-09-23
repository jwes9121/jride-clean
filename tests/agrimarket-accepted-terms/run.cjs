// Exact application modules with mocked authentication/database/routing.
// Stored function behavior is independently exercised in rollback SQL probes.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), ts=require('typescript');
const root=path.resolve(__dirname,'../..');let count=0;
async function test(name,fn){await fn();console.log('PASS '+name);count++;}
function load(file,mocks={},cache=new Map()){
 if(cache.has(file))return cache.get(file);const module={exports:{}};
 const result=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.equal(result.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0,file);
 vm.runInNewContext(result.outputText,{module,exports:module.exports,Date,console,URL,Buffer,require:n=>{
  if(n in mocks)return mocks[n];if(n.startsWith('@/')||n.startsWith('.')){let name=n.startsWith('@/')?n.slice(2):path.posix.join(path.posix.dirname(file),n);if(!path.extname(name))name+='.ts';return load(name,mocks,cache);}return require(n);
 }},{filename:file});cache.set(file,module.exports);return module.exports;
}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const customer=id(1), producer=id(2), address=id(3), product=id(4), receipt=id(5), request=id(6);
const pricing={id:1,is_active:true,base_delivery_fee:40,route_fee_per_km:20,pricing_version:1,currency:'PHP',cash_first_threshold:500};
const item={id:product,producer_id:producer,name:'Tomatoes',selling_unit:'kg',unit_price:55,availability_mode:'always_available',remaining_quantity:10,is_active:true};
const context={address:{id:address,label:'Poblacion West',address_text:'Poblacion West',lat:16.7,lng:121.2,is_active:true},producer:{id:producer,pickup_lat:16.71,pickup_lng:121.21,status:'active',accepting_orders:true,store_open:true},products:[item],items:[{product_id:product,quantity:1}],itemSnapshots:[{product_id:product,name:'Tomatoes',selling_unit:'kg',unit_price:55,quantity:1,line_total:55,availability_mode:'always_available',harvest_start_at:null,harvest_end_at:null,harvest_order_cutoff_at:null}],productSubtotal:55,preferredVehicleType:'motorcycle',requiredVehicleType:'either',fulfillmentMode:'always_available',estimatedCargoWeightKg:1,handlingEligible:false,harvestExpectedStartAt:null,harvestExpectedEndAt:null,harvestOrderCutoffAt:null};
function harness(options={}){
 const calls=[];let row=options.existing?{order_code:'AG-TEST-EXISTING',customer_user_id:customer,client_request_id:request,total_payable:155}:null;
 const db={from(table){calls.push({table});const filters=[];const q={select(){return q},eq(k,v){filters.push([k,v]);return q},limit(){return q},async maybeSingle(){return q.single()},async single(){return {error:null,data:table==='agrimarket_pricing_settings'?pricing:row&&filters.every(([k,v])=>row[k]===v)?row:null}}};return q;},async rpc(name,args){calls.push({rpc:name,args});
  if(name==='agrimarket_quote_delivery_v1')return {data:[{base_delivery_fee:40,route_fee_per_km:20,route_distance_fee:60,delivery_fee:100,pricing_version:1,currency:'PHP'}],error:null};
  if(name==='agrimarket_capture_checkout_quote_v1')return options.captureFailure?{data:{ok:false,error:'AGRIMARKET_QUOTE_CHANGED'}}:{data:{ok:true,contract:'quoted_v1',quote_id:receipt,created_at:'2026-09-23T12:00:00Z',expires_at:'2026-09-23T12:05:00Z'}};
  if(name==='agrimarket_create_quoted_order_v1'){
   if(options.rpcFailure)return {error:{message:options.rpcFailure}};
   if(options.quoteFailure)return {data:{ok:false,error:options.quoteFailure}};
   row={order_code:'AG-TEST-CREATED',customer_user_id:customer,client_request_id:request,fulfillment_mode:'always_available',status:'awaiting_producer',total_payable:155,product_subtotal:55,delivery_fee:100};
   return {data:{ok:true,order_code:row.order_code,producer_id:producer,idempotent_replay:!!options.replay}};
  }
  if(name==='agrimarket_customer_respond_harvest_v2')return options.proposalFailure?{data:{ok:false,error:'AGRIMARKET_HARVEST_PROPOSAL_STALE'}}:{data:{ok:true,proposal_id:args.p_proposal_id}};
  throw Error('Unexpected RPC '+name);
 }};
 const orderModule=load('app/api/agrimarket/_lib/order.ts',{'./location':{reverseGeocodeIfugaoTown:async()=> 'Lamut'}});
 const mocks={'next/server':{},'../_lib/server':{agrimarketEnabled:()=>!options.disabled,agrimarketDisabledResponse:()=>({status:503}),requireAgrimarketPassenger:async()=>options.denied?{ok:false,response:{status:401}}:{ok:true,user:{id:customer}},createServiceSupabase:()=>db,jsonNoStore:(status,body)=>({status,body})},'../_lib/order':{...orderModule,loadAgrimarketOrderContext:async()=>{calls.push({context:true});return context;}},'../_lib/routing':{fetchAgrimarketDrivingRoute:async()=>({distanceKm:3,durationSeconds:500,provider:'mapbox_driving'})},'@/lib/agrimarket/browserPushServer':{sendFarmerBrowserAlerts:async()=>{calls.push({push:true});if(options.pushFailure)throw Error('push failed');}}};
 function req(body){return {headers:{get:()=>request},json:async()=>body};}
 return {calls,quote:body=>load('app/api/agrimarket/quote/route.ts',mocks).POST(req(body)),create:body=>load('app/api/agrimarket/orders/route.ts',mocks).POST(req(body)),proposal:body=>load('app/api/agrimarket/order-harvest-response/route.ts',mocks).POST(req(body))};
}
const body={address_id:address,items:[{product_id:product,quantity:1}],preferred_vehicle_type:'motorcycle',accepted_quote_id:receipt};
(async()=>{
 const money=load('lib/agrimarket/checkoutMoney.ts');
 await test('decimal half-up line rounding matches the PostgreSQL numeric policy',()=>{assert.equal(money.lineCents(55,0.555),BigInt(3053));assert.equal(money.lineCents(65,0.555),BigInt(3608));assert.equal(money.moneyFromCents(money.lineCents(55,.555)+money.lineCents(65,.555)),66.61);});
 await test('exact, fractional and trailing-zero money values retain cents',()=>{for(const [p,q,c] of [['1.00','1.005',101],['250',1.5,37500],[.01,.5,1],[230,2,46000],[0,1,0]])assert.equal(money.lineCents(p,q),BigInt(c));});
 await test('invalid precision/nonfinite/negative/overflow quantities and prices reject',()=>{for(const [p,q] of [['NaN',1],[1,'Infinity'],[-1,1],[1,-1],[1,.0001],[.001,1],['1e20',1],[999999999999,100]])assert.throws(()=>money.lineCents(p,q));});
 await test('anonymous quote and checkout never access private data',async()=>{const h=harness({denied:true});assert.equal((await h.quote(body)).status,401);assert.equal((await h.create(body)).status,401);assert.equal(h.calls.length,0);});
 await test('disabled service remains disabled without side effects',async()=>{const h=harness({disabled:true});assert.equal((await h.quote(body)).status,503);assert.equal((await h.create(body)).status,503);assert.equal(h.calls.length,0);});
 await test('quote capture is owner-bound and private routing basis is not returned',async()=>{const h=harness();const r=await h.quote({...body,customer_user_id:id(99),product_subtotal:1});assert.equal(r.status,200);assert.equal(r.body.checkout_quote.quote_id,receipt);assert.equal(r.body.product_subtotal,55);const call=h.calls.find(c=>c.rpc==='agrimarket_capture_checkout_quote_v1');assert.equal(call.args.p_customer_user_id,customer);assert.equal(call.args.p_expected_basis.products[0].unit_price,55);assert(!JSON.stringify(r.body).includes('pickup_lat'));assert(!JSON.stringify(r.body).includes('customer_user_id'));});
 await test('changed capture is rejected rather than sending an unbound quote',async()=>{const h=harness({captureFailure:true});const r=await h.quote(body);assert.equal(r.status,409);assert.equal(r.body.ok,false);assert(!h.calls.some(c=>c.rpc==='agrimarket_create_quoted_order_v1'));});
 await test('fresh order without accepted quote requires an app update and cannot write',async()=>{const h=harness();const r=await h.create({...body,accepted_quote_id:undefined});assert.equal(r.status,426);assert(!h.calls.some(c=>c.rpc));});
 await test('legacy retry can still recover its already-created owned order',async()=>{const h=harness({existing:true});const r=await h.create({...body,accepted_quote_id:undefined});assert.equal(r.status,200);assert.equal(r.body.order.order_code,'AG-TEST-EXISTING');assert(!h.calls.some(c=>c.rpc));});
 await test('new checkout calls atomic quoted creator, never legacy creator',async()=>{const h=harness();const r=await h.create({...body,customer_user_id:id(99),initial_approved_total:1});assert.equal(r.status,201);const call=h.calls.find(c=>c.rpc==='agrimarket_create_quoted_order_v1');assert.equal(call.args.p_customer_user_id,customer);assert.equal(call.args.p_quote_id,receipt);assert(!('p_total' in call.args));assert(!h.calls.some(c=>c.rpc==='agrimarket_create_reserved_order_v4'));});
 await test('stock/quote/revision changes return actionable 409 and no browser alert',async()=>{for(const code of ['AGRIMARKET_QUOTE_CHANGED','AGRIMARKET_QUOTE_EXPIRED','AGRIMARKET_QUOTE_CART_CHANGED','AGRIMARKET_QUOTE_ALREADY_USED','AGRIMARKET_QUOTE_REPLAY_CONFLICT']){const h=harness({quoteFailure:code});const r=await h.create(body);assert.equal(r.status,409);assert(!h.calls.some(c=>c.push));}});
 await test('unknown database errors are sanitized and remain uncertain',async()=>{const h=harness({rpcFailure:'secret private SQL detail'});const r=await h.create(body);assert.equal(r.status,503);assert(!JSON.stringify(r).includes('secret'));});
 await test('push outage cannot turn committed checkout into failure',async()=>{const h=harness({pushFailure:true});const r=await h.create(body);assert.equal(r.status,201);assert.equal(r.body.order.total_payable,155);});
 await test('quoted replay returns original order without a second notification call',async()=>{const h=harness({replay:true});const r=await h.create(body);assert.equal(r.status,200);assert.equal(r.body.idempotent_replay,true);assert(!h.calls.some(c=>c.push));});
 const proposal={order_code:'AG-TEST',response:'accept',proposal_id:id(7),expected_updated_at:'2026-09-23T12:00:00.123456+00:00'};
 await test('proposal requires identity and exact microsecond revision',async()=>{const h=harness();for(const changes of [{proposal_id:undefined},{expected_updated_at:undefined},{expected_updated_at:'2026-09-23T12:00:00.1234567Z'},{proposal_id:'anything'}])assert.equal((await h.proposal({...proposal,...changes})).status,409);assert(!h.calls.some(c=>c.rpc));});
 await test('proposal forwards server identity, exact proposal and untruncated revision',async()=>{const h=harness();assert.equal((await h.proposal({...proposal,customer_user_id:id(99)})).status,200);const call=h.calls.find(c=>c.rpc==='agrimarket_customer_respond_harvest_v2');assert.equal(call.args.p_customer_user_id,customer);assert.equal(call.args.p_expected_updated_at,proposal.expected_updated_at);assert.equal(call.args.p_proposal_id,proposal.proposal_id);assert(!('p_now' in call.args));});
 await test('stale proposal remains an error, not permission to apply the newest proposal',async()=>{const h=harness({proposalFailure:true});const r=await h.proposal(proposal);assert.equal(r.status,409);assert.equal(r.body.error,'AGRIMARKET_HARVEST_PROPOSAL_STALE');});
 await test('proposal denial happens before any database call',async()=>{const h=harness({denied:true});assert.equal((await h.proposal(proposal)).status,401);assert.equal(h.calls.length,0);});
 await test('status feed exports exact database proposal revision for both clients',()=>{const s=fs.readFileSync(path.join(root,'app/api/agrimarket/order-status/route.ts'),'utf8');assert(s.includes('producer_reason,proposed_at,updated_at'));assert(s.includes('updated_at: proposal.updated_at'));});
 await test('web checkout and proposal writers carry reviewed identities',()=>{const s=fs.readFileSync(path.join(root,'app/agrimarket/page.tsx'),'utf8');assert(s.includes('accepted_quote_id: quoteId'));assert(s.includes('checkoutAttempt.current?.body !== cartIdentity'));const p=fs.readFileSync(path.join(root,'app/agrimarket/order/page.tsx'),'utf8');assert(p.includes('proposal_id: proposal.id, expected_updated_at: proposal.updated_at'));assert(p.includes('finally { setResponding(false); }'));});
 console.log(`PASS: ${count} accepted-terms test groups. Mocked I/O, no real orders.`);
})().catch(e=>{console.error(e);process.exitCode=1});
