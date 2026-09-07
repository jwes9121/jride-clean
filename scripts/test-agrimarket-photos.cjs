const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),ts=require('typescript'),sharp=require('sharp');
const root=path.resolve(__dirname,'..');
function load(file,mocks={}) {
  const cache=new Map();
  function read(abs) {
    if(cache.has(abs)) return cache.get(abs).exports;
    const module={exports:{}};cache.set(abs,module);
    const source=ts.transpileModule(fs.readFileSync(abs,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    new Function('require','module','exports',source)(name=>{
      if(Object.hasOwn(mocks,name))return mocks[name];
      if(name.startsWith('@/')||name.startsWith('.')){let target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(abs),name);if(!path.extname(target))target+='.ts';return read(target);}
      return require(name);
    },module,module.exports);return module.exports;
  }return read(path.join(root,file));
}
const pid='82111111-0000-4000-8000-000000000001',owner='82111111-0000-4000-8000-000000000002';
const bucket='agrimarket-product-photos',origin='https://photos.example.test';
const oldPath='82111111-0000-4000-8000-000000000003.webp',oldUrl=`${origin}/storage/v1/object/public/${bucket}/${oldPath}`;
process.env.NEXT_PUBLIC_SUPABASE_URL=origin;
function harness({auth=true,enabled=true,ownerId=owner,conflict=false,storageError=false}={}) {
  const calls={upload:[],remove:[],updates:[],queries:[]};
  const row={id:pid,producer_id:ownerId,photo_urls:[oldUrl],updated_at:'2026-01-01T00:00:00Z'};
  const storage={async upload(name,bytes,options){calls.upload.push({name,bytes,options});return {error:storageError?{message:'storage down'}:null}},getPublicUrl(name){return {data:{publicUrl:`${origin}/storage/v1/object/public/${bucket}/${name}`}}},async remove(names){calls.remove.push(names);return {error:null}}};
  const admin={
    storage:{from(name){assert.equal(name,bucket);return storage}},
    from(table){
      assert.equal(table,'agrimarket_products');let update=null,filters={};
      const chain={
        select(){return chain},eq(k,v){filters[k]=v;return chain},update(data){update=data;return chain},
        async maybeSingle(){
          calls.queries.push({...filters});const matches=Object.entries(filters).every(([k,v])=>row[k]===v);
          if(update){calls.updates.push(update);if(conflict||!matches)return {data:null,error:null};Object.assign(row,update)}
          return {data:matches?{...row}:null,error:null};
        }
      };
      return chain;
    }
  };
  const server={agrimarketFarmerPortalEnabled:()=>enabled,agrimarketFarmerPortalDisabledResponse:()=>Response.json({ok:false},{status:503}),jsonNoStore:(status,body)=>Response.json(body,{status}),requireAgrimarketProducer:async()=>auth?{ok:true,producer:{id:owner}}:{ok:false,response:Response.json({ok:false},{status:401})},createServiceSupabase:()=>admin};
  return {calls,row,api:load('app/api/agrimarket/producer/products/photo/route.ts',{'../../../_lib/server':server})};
}
async function jpg(){return sharp({create:{width:2000,height:1200,channels:3,background:'#517a30'}}).withMetadata({orientation:6}).jpeg().toBuffer()}
function upload(bytes,type='image/jpeg',product=pid){const data=new FormData();data.set('product_id',product);data.set('file',new File([bytes],'private-farm-gps.jpg',{type}));return new Request('https://app.jride.net/api/agrimarket/producer/products/photo',{method:'POST',body:data});}
function remove(product=pid){return new Request('https://app.jride.net/api/agrimarket/producer/products/photo',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({product_id:product})})}
test('photo upload requires farmer authentication and its portal before reading file data',async()=>{
  for(const options of [{auth:false},{enabled:false}]) {const h=harness(options);const response=await h.api.POST({get body(){throw new Error('must not read unauthenticated body')}});assert.equal(response.status,options.auth===false?401:503);assert.equal(h.calls.queries.length,0);}
});
test('upload saves a resized metadata-free WebP and replaces only the owners product photo',async()=>{
  const h=harness();const response=await h.api.POST(upload(await jpg()));assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.product.photo_urls.length,1);
  const u=h.calls.upload[0];assert.match(u.name,/^[0-9a-f-]{36}\.webp$/);assert(!u.name.includes(owner));assert.equal(u.options.upsert,false);
  const meta=await sharp(u.bytes).metadata();assert.equal(meta.format,'webp');assert(Math.max(meta.width,meta.height)<=1600);assert.equal(meta.exif,undefined);assert.equal(meta.orientation,undefined);
  assert(h.calls.queries.every(q=>q.producer_id===owner));assert.equal(h.calls.queries[1].updated_at,'2026-01-01T00:00:00Z');assert.deepEqual(h.calls.remove,[[oldPath]]);
});
test('a farmer cannot upload to or remove another farmers photo',async()=>{
  for(const method of ['POST','DELETE']) {const h=harness({ownerId:'another-farmer'});const response=await h.api[method](method==='POST'?upload(await jpg()):remove());assert.equal(response.status,404);assert.equal(h.calls.upload.length,0);assert.equal(h.calls.updates.length,0);assert.equal(h.calls.remove.length,0);}
});
test('corrupt images, SVG masquerading as PNG, empty images and oversized streams do not reach storage',async()=>{
  const cases=[[Buffer.from('broken'),'image/jpeg'],[Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),'image/png'],[Buffer.alloc(0),'image/png'],[Buffer.alloc(3*1024*1024+20000),'image/png']];
  for(const [bytes,type] of cases) {const h=harness();const response=await h.api.POST(upload(bytes,type));assert([400,413].includes(response.status));assert.equal(h.calls.upload.length,0);assert.deepEqual(h.row.photo_urls,[oldUrl]);}
});
test('storage failure and a concurrent product edit preserve the current photo',async()=>{
  for(const options of [{storageError:true},{conflict:true}]) {const h=harness(options);const response=await h.api.POST(upload(await jpg()));assert.equal(response.status,options.storageError?503:409);assert.deepEqual(h.row.photo_urls,[oldUrl]);if(options.conflict)assert.deepEqual(h.calls.remove,[[h.calls.upload[0].name]]);else assert.equal(h.calls.remove.length,0);}
});
test('removal clears the photo and cleans only a managed storage object',async()=>{
  const h=harness();assert.equal((await h.api.DELETE(remove())).status,200);assert.deepEqual(h.row.photo_urls,[]);assert.deepEqual(h.calls.remove,[[oldPath]]);
  const helper=load('lib/agrimarket/product-photo.ts');for(const url of ['https://evil.example/'+oldPath,oldUrl+'?path=other',oldUrl.replace(oldPath,'../secrets'),oldUrl.replace(bucket,'passenger-ids')])assert.equal(helper.managedPhotoPath(url,origin),null);
});
test('product creation rejects arbitrary photo URLs and returns its new ID for the optional upload',async()=>{
  let writes=0;const server={agrimarketFarmerPortalEnabled:()=>true,jsonNoStore:(status,body)=>Response.json(body,{status}),requireAgrimarketProducer:async()=>({ok:true,producer:{id:owner}}),createServiceSupabase:()=>({from(){const chain={insert(){writes++;return chain},select(){return chain},eq(){return chain},order(){return chain},async single(){return {data:{id:pid},error:null}},then(resolve){resolve({data:[],error:null})}};return chain}})};
  const api=load('app/api/agrimarket/producer/products/route.ts',{'../../_lib/server':server});
  const body={name:'Test tomatoes',product_group:'produce',condition:'normal',cargo_class:'standard_produce',selling_unit:'kg',unit_price:60,available_quantity:10};
  assert.equal((await api.POST({json:async()=>({...body,photo_urls:[oldUrl]})})).status,400);assert.equal(writes,0);
  const result=await api.POST({json:async()=>body});assert.equal(result.status,200);assert.equal((await result.json()).created_product_id,pid);assert.equal(writes,1);
});

function readDb(data, calls=[]) {
  return {from(table){const filters={};const chain=new Proxy({}, {get(_,method){if(method==='then')return resolve=>resolve({data:data[table]??null,error:null});return (...args)=>{calls.push({table,method,args});if(method==='eq')filters[args[0]]=args[1];if(method==='maybeSingle')return Promise.resolve({data:table==='agrimarket_orders'&&filters.assigned_driver_id&&data[table]?.assigned_driver_id!==filters.assigned_driver_id?null:data[table]??null,error:null});return chain}}});return chain}};
}
test('private vendor name saves only to the authenticated farmer and admin directory rejects other roles',async()=>{
  let edits=[];const server={agrimarketFarmerPortalEnabled:()=>true,jsonNoStore:(status,body)=>Response.json(body,{status}),requireAgrimarketProducer:async()=>({ok:true,producer:{id:owner,vendor_name:null}}),createServiceSupabase:()=>({from(table){const chain={select(){return chain},eq(key,value){if(table==='agrimarket_producers')assert.deepEqual([key,value],['id',owner]);return chain},order(){return chain},update(data){edits.push(data);return chain},async maybeSingle(){return {data:{id:owner,...edits.at(-1)},error:null}},then(resolve){resolve({data:[],error:null})}};return chain}})};
  const api=load('app/api/agrimarket/producer/products/route.ts',{'../../_lib/server':server});
  for(const vendor_name of ['', 'x','x'.repeat(61),false]) assert.equal((await api.POST({json:async()=>({action:'set_vendor_name',vendor_name})})).status,400);
  const response=await api.POST({json:async()=>({action:'set_vendor_name',vendor_name:'Private Test Farm',producer_id:'forged-owner'})});assert.equal(response.status,200);assert.equal((await response.json()).vendor_name,'Private Test Farm');assert.equal(edits.length,1);
  let role='dispatcher';const directory=load('app/api/agrimarket/admin/vendors/route.ts',{'../../_lib/server':{jsonNoStore:server.jsonNoStore,requireAgrimarketStaff:async(adminOnly)=>{assert.equal(adminOnly,true);return role==='admin'?{ok:true}:{ok:false,response:Response.json({ok:false},{status:403})}},createServiceSupabase:()=>readDb({agrimarket_producers:[{vendor_name:'Private Test Farm'}]})}});
  assert.equal((await directory.GET()).status,403);role='admin';assert.equal((await directory.GET()).status,200);
});
test('passenger catalog excludes private vendor identity, contact data, producer UUID and exact pickup',async()=>{
  const privateName='Private Test Farm',privateContact='Private Person';
  const data={passenger_addresses:{id:pid,lat:16.8,lng:121.1},agrimarket_pricing_settings:{currency:'PHP'},agrimarket_products:[{id:pid,producer_id:owner,name:'Tomatoes',unit_price:60,selling_unit:'kg',remaining_quantity:10,availability_mode:'always_available',photo_urls:[oldUrl]}],agrimarket_producers:[{id:owner,vendor_name:privateName,contact_name:privateContact,contact_phone:'09999999999',town:'Lagawe',pickup_label:'Secret pin',pickup_lat:16.8001,pickup_lng:121.1001}]};
  const api=load('app/api/agrimarket/catalog/route.ts',{'../_lib/server':{agrimarketEnabled:()=>true,requireAgrimarketPassenger:async()=>({ok:true,user:{id:'passenger'}}),createServiceSupabase:()=>readDb(data),jsonNoStore:(status,body)=>Response.json(body,{status})},'../_lib/location':{normalizeIfugaoTown:v=>v,reverseGeocodeIfugaoTown:async()=>'Lagawe'},'../_lib/routing':{fetchAgrimarketDrivingRoute:async()=>({distanceKm:2,durationSeconds:300})}});
  const response=await api.GET({nextUrl:new URL('http://localhost/api/agrimarket/catalog')});assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.products.length,1);const raw=JSON.stringify(payload);for(const hidden of [privateName,privateContact,owner,'09999999999','Secret pin','16.8001','121.1001','vendor_name','contact_name','pickup_lat'])assert(!raw.includes(hidden),hidden+' must stay private');assert.deepEqual(payload.products[0].photo_urls,[oldUrl]);
});
test('only the assigned driver receives vendor name and pickup details; offers and other drivers do not',async()=>{
  const driver='00000000-0000-4000-8000-000000000002',privateName='Private Test Farm';
  const order={id:pid,producer_id:owner,assigned_driver_id:driver,status:'driver_assigned',order_code:'LOCAL-ONLY',producer_product_net:500,total_payable:560};
  const data={agrimarket_driver_offers:null,agrimarket_orders:order,agrimarket_producers:{vendor_name:privateName,contact_name:'Private Person',contact_phone:'09999999999',town:'Lagawe',pickup_lat:16.8001,pickup_lng:121.1001},agrimarket_order_items:[],agrimarket_pickup_checks:[]};
  let activeDriver=driver;const api=load('app/api/driver/agrimarket/offer/route.ts',{'@/lib/supabaseAdmin':{supabaseAdmin:()=>readDb(data)},'@/lib/driver/resolveDriverRequest':{resolveDriverRequest:async()=>({ok:true,driverId:activeDriver})},'@/app/api/agrimarket/_lib/server':{agrimarketEnabled:()=>true}});
  const request=new Request('http://localhost/api/driver/agrimarket/offer');
  let response=await api.GET(request);assert.equal(response.status,200);let payload=await response.json();assert.equal(payload.state,'assigned');assert.equal(payload.order.farmer.name,privateName);
  activeDriver='another-driver';response=await api.GET(request);payload=await response.json();assert.equal(payload.state,'none');assert(!JSON.stringify(payload).includes(privateName));
  activeDriver=driver;data.agrimarket_driver_offers={id:'offer',order_id:pid,status:'offered'};response=await api.GET(request);payload=await response.json();assert.equal(payload.state,'offered');for(const privateValue of [privateName,'Private Person','09999999999','16.8001','121.1001'])assert(!JSON.stringify(payload).includes(privateValue));
});
