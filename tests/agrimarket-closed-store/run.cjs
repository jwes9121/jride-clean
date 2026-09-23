// Real application modules, mocked I/O; database constraints tested separately.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {renderToStaticMarkup} = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
let passed = 0;
const read = file => fs.readFileSync(path.join(root,file),'utf8');
async function test(name,run){await run();passed++;console.log('PASS '+name);}
function load(file,mocks={},globals={},cache=new Map()){
  if(cache.has(file))return cache.get(file);
  const module={exports:{}};
  const result=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true},reportDiagnostics:true});
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  const req=name=>{
    if(name in mocks)return mocks[name];
    if(name.endsWith('.css'))return {};
    if(name.startsWith('@/')||name.startsWith('.')){
      const base=name.startsWith('@/')?name.slice(2):path.posix.join(path.posix.dirname(file),name);
      const target=['.ts','.tsx','.js',''].map(ext=>base+ext).find(p=>fs.existsSync(path.join(root,p)));
      assert(target,name);return load(target,mocks,globals,cache);
    }
    return require(name);
  };
  vm.runInNewContext(result.outputText,{module,exports:module.exports,require:req,console,Buffer,URL,URLSearchParams,Headers,Date,Error,AbortSignal,setTimeout,clearTimeout,...globals},{filename:file});
  cache.set(file,module.exports);return module.exports;
}
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const published={id:id(10),vendor_name:'Test Farm',town:'Lamut',status:'active',accepting_orders:true,store_open:true,catalog_approved_at:'2026-09-22T00:00:00Z',pickup_lat:16.65,pickup_lng:121.22,contact_phone:'PRIVATE_PHONE',pickup_motorcycle_accessible:true,pickup_tricycle_accessible:true,pickup_roadside_handoff_required:false,pickup_driver_directions:'PRIVATE_DIRECTIONS'};
const item={id:id(1),producer_id:id(10),name:'Tomatoes',product_group:'produce',cargo_class:'standard_produce',selling_unit:'kg',unit_price:50,unit_weight_kg:1,remaining_quantity:20,is_active:true,availability_mode:'always_available',vehicle_requirement:'either',photo_urls:[],harvest_order_cutoff_at:null};
function harness({farms=[published],items=[item],allowed=true,failTable=null}={}){
  const calls=[];
  const data={agrimarket_producers:farms,agrimarket_products:items,passenger_addresses:[{id:id(20),created_by_user_id:id(30),is_active:true,lat:16.7,lng:121.1,is_primary:true,label:'Home',address_text:'Home'}],agrimarket_pricing_settings:[{id:1,is_active:true,pricing_version:1,base_delivery_fee:40,route_fee_per_km:20}]};
  const db={rpc:async(name,args)=>{calls.push({write:name,args});throw Error('Unexpected write');},from(table){calls.push({table});let filters=[],cols=null;
    const q={select(c){cols=c.split(',');return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},gt(k,v){filters.push(r=>r[k]>v);return q;},not(k,op,v){assert.equal(op,'is');assert.equal(v,null);filters.push(r=>r[k]!=null);return q;},order(){return q;},limit(){return q;},
      result(single){if(failTable===table)return {data:null,error:{message:'TEST_UNAVAILABLE'}};const found=(data[table]||[]).filter(r=>filters.every(f=>f(r))).map(r=>cols?Object.fromEntries(cols.map(k=>[k,r[k]])):{...r});return {data:single?found[0]||null:found,error:null};},maybeSingle:async()=>q.result(true),then(resolve,reject){return Promise.resolve(q.result(false)).then(resolve,reject);}};return q;
  }};
  const server={agrimarketEnabled:()=>true,agrimarketDisabledResponse:()=>({status:503}),createServiceSupabase:()=>db,requireAgrimarketPassenger:async()=>allowed?{ok:true,user:{id:id(30)}}:{ok:false,response:{status:401}},jsonNoStore:(status,body)=>({status,body})};
  const mocks={'next/server':{},'../_lib/server':server,'../_lib/location':{normalizeIfugaoTown:v=>v,reverseGeocodeIfugaoTown:async()=> 'Lamut'},'./location':{reverseGeocodeIfugaoTown:async()=> 'Lamut'},'../_lib/routing':{fetchAgrimarketDrivingRoute:async()=>({distanceKm:3,durationSeconds:360})},'@/lib/agrimarket/browserPushServer':{}};
  const req=query=>({nextUrl:new URL('https://app.jride.net/api/agrimarket/catalog?'+query)});
  return {db,calls,mocks,req,catalog:load('app/api/agrimarket/catalog/route.ts',mocks),store:load('app/api/agrimarket/store/route.ts',mocks)};
}
async function main(){
  const rules=load('lib/agrimarket/storeAvailability.ts');
  await test('open, closed and paused listings distinguish browsing from ordering',()=>{
    for(const [ready,open,status,can,label] of [[true,true,'open',true,'Accepting orders'],[true,false,'closed',false,'Closed for now'],[false,true,'unavailable',false,'Temporarily unavailable'],[false,false,'unavailable',false,'Temporarily unavailable'],[true,null,'closed',false,'Closed for now']]){
      const result=rules.listingAvailability({accepting_orders:ready,store_open:open},true);
      assert.equal(result.store_status,status);assert.equal(result.can_order_now,can);assert.equal(result.store_status_label,label);
      assert.equal(rules.productOrderBlocker(result)===null,can);
    }
  });
  await test('store closure takes precedence over scheduled cutoff, with human text',()=>{
    const closed=rules.listingAvailability({accepting_orders:true,store_open:false},false);
    assert.equal(closed.order_blocker,rules.CLOSED_STORE_BLOCKER);
    assert.match(rules.productOrderBlocker(closed),/Closed for now/);
    const cutoff=rules.listingAvailability({accepting_orders:true,store_open:true},false);
    assert.match(rules.productOrderBlocker(cutoff),/Reservations/);
    assert(!rules.isStoreUnavailable(cutoff));
    assert.equal(rules.productOrderBlocker({can_order_now:false,order_blocker:'INTERNAL_UNKNOWN'}),'This item is currently unavailable to order.');
  });
  await test('new catalog retains closed and re-review stores, hides never-approved/suspended',async()=>{
    const farms=[published,{...published,id:id(11),store_open:false},{...published,id:id(12),accepting_orders:false,store_open:false},{...published,id:id(13),accepting_orders:false,store_open:false,catalog_approved_at:null},{...published,id:id(14),status:'suspended'}];
    const items=farms.map((f,i)=>({...item,id:id(i+1),producer_id:f.id,name:'Item '+i}));
    const h=harness({farms,items});const r=await h.catalog.GET(h.req('store_visibility=1'));
    assert.equal(r.status,200);assert.equal(r.body.products.length,3);
    assert.equal(r.body.products.filter(p=>p.can_order_now).length,1);
    assert.equal(r.body.products[0].can_order_now,true);
    assert.equal(r.body.catalog_visibility_version,'1');
    assert(!r.body.products.some(p=>p.name==='Item 3'||p.name==='Item 4'));
  });
  await test('legacy clients remain open-only until their UI supports closed listings',async()=>{
    const h=harness({farms:[{...published,store_open:false}]});
    for(const q of ['', 'store_visibility=2']){const r=await h.catalog.GET(h.req(q));assert.equal(r.body.products.length,0);assert.equal(r.body.catalog_visibility_version,'legacy');}
    assert.equal((await h.store.GET(h.req('product_id='+item.id))).status,404);
  });
  await test('Hingyon four and Lamut six closed listings are retained without being orderable',async()=>{
    const farms=[{...published,town:'Hingyon',store_open:false},{...published,id:id(11),town:'Lamut',store_open:false}];
    const items=Array.from({length:10},(_,i)=>({...item,id:id(i+100),producer_id:i<4?id(10):id(11),name:'Fixture '+i}));
    const r=await harness({farms,items}).catalog.GET(harness().req('store_visibility=1'));
    assert.equal(r.body.products.filter(p=>p.producer_town==='Hingyon').length,4);
    assert.equal(r.body.products.filter(p=>p.producer_town==='Lamut').length,6);
    assert(r.body.products.every(p=>!p.can_order_now&&p.store_status==='closed'));
  });
  await test('closed store detail remains readable with only public fields',async()=>{
    const h=harness({farms:[{...published,store_open:false}]});const r=await h.store.GET(h.req('product_id='+item.id+'&store_visibility=1'));
    assert.equal(r.status,200);assert.equal(r.body.store.name,'Test Farm');assert.equal(r.body.store.store_status_label,'Closed for now');
    const c=await h.catalog.GET(h.req('store_visibility=1'));
    for(const response of [r,c])for(const privateValue of ['PRIVATE_PHONE','PRIVATE_DIRECTIONS','pickup_lat','pickup_lng','catalog_approved_at',published.id])assert(!JSON.stringify(response.body).includes(privateValue),privateValue);
  });
  await test('unapproved, suspended and inactive-product details remain unavailable',async()=>{
    for(const farm of [{...published,catalog_approved_at:null,accepting_orders:false},{...published,status:'suspended'}]){
      const h=harness({farms:[farm]});assert.equal((await h.store.GET(h.req('product_id='+item.id+'&store_visibility=1'))).status,404);
    }
    const h=harness({items:[{...item,is_active:false}]});assert.equal((await h.store.GET(h.req('product_id='+item.id+'&store_visibility=1'))).status,404);
  });
  await test('catalog and store reject anonymous calls before database access',async()=>{
    const h=harness({allowed:false});assert.equal((await h.catalog.GET(h.req('store_visibility=1'))).status,401);assert.equal((await h.store.GET(h.req('product_id='+item.id+'&store_visibility=1'))).status,401);assert.equal(h.calls.length,0);
  });
  await test('catalog still excludes sold-out/inactive products; cutoff blocks reservations',async()=>{
    const items=[item,{...item,id:id(2),remaining_quantity:0},{...item,id:id(3),is_active:false},{...item,id:id(4),availability_mode:'scheduled_harvest',harvest_order_cutoff_at:'2000-01-01T00:00:00Z'}];
    const h=harness({items});const r=await h.catalog.GET(h.req('store_visibility=1'));assert.equal(r.body.products.length,2);assert.equal(r.body.products.filter(p=>p.can_order_now).length,1);assert.equal(r.body.products.find(p=>p.id===id(4)).order_blocker,'AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED');
  });
  await test('quote and checkout reject closed or paused store before pricing/write',async()=>{
    for(const farm of [{...published,store_open:false},{...published,store_open:null},{...published,accepting_orders:false},{...published,status:'suspended'}]){
      for(const route of ['quote','orders']){
        const h=harness({farms:[farm]});const api=load(`app/api/agrimarket/${route}/route.ts`,h.mocks);
        const r=await api.POST({headers:{get:()=>id(99)},json:async()=>({address_id:id(20),preferred_vehicle_type:'motorcycle',items:[{product_id:item.id,quantity:1}]})});
        assert.equal(r.status,409,route);assert.equal(r.body.error,'AGRIMARKET_PRODUCER_UNAVAILABLE');assert(!h.calls.some(c=>c.write));
      }
    }
  });
  await test('closure after successful context read is rejected on the next checkout read',async()=>{
    const farm={...published};const h=harness({farms:[farm]});const context=load('app/api/agrimarket/_lib/order.ts',h.mocks);
    const args=[h.db,id(30),id(20),[{product_id:item.id,quantity:1}],'motorcycle'];
    assert.equal((await context.loadAgrimarketOrderContext(...args)).productSubtotal,50);
    farm.store_open=false;
    await assert.rejects(context.loadAgrimarketOrderContext(...args),e=>e.code==='AGRIMARKET_PRODUCER_UNAVAILABLE');
    assert(!h.calls.some(c=>c.write));
  });
  await test('closed-store UI keeps prices and back/view controls; ordering disabled and no raw codes',()=>{
    const closed=rules.listingAvailability({accepting_orders:true,store_open:false},true);
    const store={name:'Test Farm',town:'Lamut',...closed};
    const Profile=load('app/agrimarket/StoreProfile.tsx',{'@/lib/passenger/browserSession':{},'./ProductPhoto':{ProductPhoto:({className})=>React.createElement('div',{className,'data-photo':true})},react:{...React,useState:value=>[value===null?store:value,()=>{}],useEffect(){}}}).default;
    const html=renderToStaticMarkup(React.createElement(Profile,{productId:item.id,products:[{...item,...closed,cart_group_key:'one'}],cartProducts:[],otherStoreName:null,busy:false,onAdd(){throw Error('No order');},onClose(){},onReviewCart(){}}));
    for(const text of ['Closed for now','Not accepting orders right now','PHP 50.00','20 kg listed','Back to results','grayscale','Store closed'])assert(html.includes(text),text);
    assert.equal((html.match(/disabled=""/g)||[]).length,1);
    assert(!html.includes('AGRIMARKET_'));assert(!html.includes('Ready to order'));
  });
  await test('paused store UI uses different badge from ordinary closure',()=>{
    const Notice=load('app/agrimarket/StoreAvailabilityNotice.tsx').default;
    const html=renderToStaticMarkup(React.createElement(Notice,{product:rules.listingAvailability({accepting_orders:false,store_open:false},true)}));
    assert(html.includes('Temporarily unavailable'));assert(!html.includes('Closed for now'));
  });
  await test('web cart refresh preserves cart and quote/place paths recheck fresh store status',()=>{
    const s=read('app/agrimarket/page.tsx');const refresh=s.slice(s.indexOf('async function refreshCartStore'),s.indexOf('async function getQuote'));
    assert(!refresh.includes('setCart([])'));assert(refresh.includes('scope !== cartScope.current'));assert(refresh.includes('setQuote(null)'));assert(refresh.includes('setCart(current => current.map'));
    assert.equal((s.match(/if \(!await refreshCartStore\(\)\) return;/g)||[]).length,1);
    assert(s.includes('accepted_quote_id: quoteId'));
    const checkout=read('app/api/agrimarket/orders/route.ts');
    assert(checkout.includes('agrimarket_create_quoted_order_v1'));
    assert(checkout.includes('loadAgrimarketOrderContext(admin, passengerAuth.user.id'));
    assert(s.includes('Refresh store availability'));assert(s.includes('products listed;'));
    assert(s.includes('store_visibility: CLOSED_CATALOG_VERSION'));
  });
  await test('publication migration never changes trading flags or order lifecycle',()=>{
    const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_agrimarket_catalog_visibility_v1.sql'));
    const migration=read('supabase/migrations/'+file);
    assert(migration.includes('OLD.catalog_approved_at IS NOT NULL'));assert(migration.includes("e.event_type = 'ready_for_orders'"));
    assert(!/SET\s+(accepting_orders|store_open)|DELETE FROM|DROP CONSTRAINT|DISABLE TRIGGER/.test(migration));
    assert(!migration.includes('UPDATE public.agrimarket_orders'));
    const guard=read('supabase/migrations/20260920185710_agrimarket_farmer_store_open_v1.sql');
    assert(/before\s+insert\s+on\s+public\.agrimarket_orders/i.test(guard));assert(guard.includes('for share'));assert(guard.includes('AGRIMARKET_PRODUCER_UNAVAILABLE_STORE_CLOSED'));
  });
  console.log(`AgriMarket closed-store: ${passed} test groups passed.`);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
