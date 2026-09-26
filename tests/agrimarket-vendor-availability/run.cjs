const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, server) {
  const module = {exports:{}};
  const source = ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,Date,console,require(name){
    if(name==='next/server')return {};
    if(name==='../../_lib/server')return server;
    if(name==='@/lib/agrimarket/farmer-profile-validation')return {driverDirectionsError:()=>null};
    throw new Error('Unexpected dependency '+name);
  }});
  return module.exports;
}
async function main() {
  const pid='00000000-0000-4000-8000-000000000001', product='00000000-0000-4000-8000-000000000002';
  const farm={id:pid,vendor_name:'Lamut test store',town:'Lamut',status:'active',accepting_orders:true,store_open:true};
  const other={...farm,id:'other',vendor_name:'Other store'};
  const item={id:product,producer_id:pid,listed_quantity:12,reserved_quantity:2,sold_quantity:3};
  let allowed=true, race=false, reads=0;
  const db={from(table){
    reads++;
    const rows=table==='agrimarket_producers'?[farm,other]:[item];
    let patch,filters=[],columns;
    const q={select(c){columns=c.split(',');return q;},eq(k,v){filters.push([k,v]);return q;},limit(){return q;},order(){return q;},update(p){patch=p;return q;},
      execute(single){
        if(patch && table==='agrimarket_products' && race){item.reserved_quantity++;race=false;}
        const selected=rows.filter(row=>filters.every(([k,v])=>row[k]===v));
        if(patch)selected.forEach(row=>Object.assign(row,patch));
        const data=selected.map(row=>({...row,remaining_quantity:row.listed_quantity-row.reserved_quantity-row.sold_quantity}));
        return {data:single?data[0]||null:data,error:null};
      },async maybeSingle(){return q.execute(true);},then(resolve,reject){return Promise.resolve(q.execute(false)).then(resolve,reject);}};
    return q;
  }};
  const server={agrimarketFarmerPortalEnabled:()=>true,agrimarketFarmerPortalDisabledResponse:()=>({status:503}),createServiceSupabase:()=>db,
    requireAgrimarketProducer:async()=>allowed?{ok:true,producer:farm}:{ok:false,response:{status:401}},jsonNoStore:(status,body)=>({status,body})};
  const store=load('app/api/agrimarket/producer/store/route.ts',server);
  const req=(body={},origin='https://app.jride.net')=>({headers:{get:key=>key==='origin'?origin:null},nextUrl:new URL('https://app.jride.net/api/agrimarket/producer/store'),json:async()=>body});
  allowed=false;
  assert.equal((await store.GET(req())).status,401);assert.equal((await store.POST(req({open:false}))).status,401);assert.equal(reads,0);
  allowed=true;
  const profile=await store.GET(req());assert.equal(profile.body.store.name,farm.vendor_name);assert(!('id' in profile.body.store));
  assert.equal((await store.POST(req({open:false,producer_id:'other',accepting_orders:false}))).status,200);
  assert.equal(farm.store_open,false);assert.equal(farm.accepting_orders,true);assert.equal(other.store_open,true);
  assert.equal((await store.POST(req({open:true}))).status,200);assert.equal(farm.store_open,true);
  farm.accepting_orders=false;farm.store_open=false;
  assert.equal((await store.POST(req({open:true}))).status,409);assert.equal(farm.store_open,false);
  assert.equal((await store.POST(req({open:false}))).status,200);
  farm.accepting_orders=true;farm.status='suspended';
  assert.equal((await store.POST(req({open:true}))).status,409);
  farm.status='active';assert.equal((await store.POST(req({open:'true'}))).status,400);
  assert.equal((await store.POST(req({open:true},'https://evil.invalid'))).status,403);
  console.log('PASS own-store switching, trusted ownership, Admin readiness, suspension, input validation and cross-origin rejection');
  const products=load('app/api/agrimarket/producer/products/route.ts',server);
  const stock=quantity=>products.POST(req({action:'set_available_quantity',product_id:product,available_quantity:quantity}));
  const saved=await stock(4.5);assert.equal(saved.status,200);assert.equal(item.listed_quantity,9.5);assert.equal(item.reserved_quantity,2);assert.equal(item.sold_quantity,3);assert.equal(saved.body.products[0].remaining_quantity,4.5);
  race=true;assert.equal((await stock(20)).status,409);assert.equal(item.listed_quantity,9.5);assert.equal(item.reserved_quantity,3);
  assert.equal((await stock(0)).status,200);assert.equal(item.listed_quantity,6);
  assert.equal((await stock(-1)).status,400);
  assert.equal((await products.POST(req({action:'set_available_quantity',product_id:pid,available_quantity:99}))).status,404);
  console.log('PASS decimal stock, sold out, ownership and concurrent reservation conflict without overwriting reserved/sold stock');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
