const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../../app/api/agrimarket/orders/history/route.ts");
let passed = 0;
function check(name, run) { return Promise.resolve().then(run).then(() => { passed++; console.log("PASS " + name); }); }
const terminal = ["completed","cancelled","producer_rejected","producer_timeout"];
const active = ["awaiting_producer","awaiting_harvest","producer_accepted","preparing","awaiting_customer_reapproval","ready_for_dispatch","dispatching","driver_assigned","picked_up","delivering","delivered","exception"];
const order = (id,status="awaiting_harvest",user="passenger-a") => ({id,order_code:id,customer_user_id:user,producer_id:"farm-a",status,created_at:"2026-09-23T00:00:00Z",fulfillment_mode:"scheduled_harvest",cancel_reason:"Reserved cut sold outside JRide",total_payable:385});
function harness(options={}) {
  const calls=[];
  const tables={agrimarket_orders:options.orders || [], agrimarket_order_items:options.items || [],
    agrimarket_producers:options.stores || [{id:"farm-a",vendor_name:"Test farm",town:"Lamut",contact_phone:"private",pickup_lat:16}]};
  const admin={from(table) {
    calls.push({table}); let rows=[...(tables[table] || [])],fields=[],sorts=[];
    const q={select(s){fields=s.split(",");return q;},eq(k,v){calls.push({table,k,v});rows=rows.filter(x=>x[k]===v);return q;},
      in(k,vs){calls.push({table,k,vs});rows=rows.filter(x=>vs.includes(x[k]));return q;},order(k,o){sorts.push([k,o.ascending]);return q;},
      range(a,b){rows.sort((x,y)=>{for(const [k,asc] of sorts){const d=String(x[k]||"").localeCompare(String(y[k]||""));if(d)return asc?d:-d;}return 0;});rows=rows.slice(a,b+1);return q;},
      then(resolve,reject){return Promise.resolve({data:options.nullTable===table?null:rows.map(x=>Object.fromEntries(fields.map(k=>[k,x[k]]))),error:options.failTable===table?{message:"private database error"}:null}).then(resolve,reject);}}; return q;
  }};
  const source=ts.transpileModule(fs.readFileSync(filename,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(source,{module,exports:module.exports,console,Date,Set,Map,require(name){
    if(name==="next/server")return {};
    if(name==="@/lib/agrimarket/schedule")return {scheduledActivity:items=>items.every(x=>x.product_group==="meat")?"butchering":"harvest"};
    if(name==="../../_lib/server")return {agrimarketEnabled:()=>!options.disabled,agrimarketDisabledResponse:()=>({status:503}),
      requireAgrimarketPassenger:async()=>options.denied?{ok:false,response:{status:401}}:{ok:true,user:{id:"passenger-a"}},
      createServiceSupabase:()=>admin,jsonNoStore:(status,body)=>({status,body})};
    throw Error("Unexpected dependency: "+name);
  }},{filename});
  return {calls,get:q=>module.exports.GET({nextUrl:new URL("https://app.jride.net/api/agrimarket/orders/history"+(q||""))})};
}
(async()=>{
 await check("passenger order-history route exists at the actual native URL",async()=>{assert(fs.existsSync(filename));assert(fs.readFileSync(filename,"utf8").includes('requireAgrimarketPassenger'));});
 await check("unauthenticated requests never read orders",async()=>{const h=harness({denied:true});assert.equal((await h.get()).status,401);assert.equal(h.calls.length,0);});
 await check("disabled feature never reads orders",async()=>{const h=harness({disabled:true});assert.equal((await h.get()).status,503);assert.equal(h.calls.length,0);});
 await check("only owned active orders and owned child items returned",async()=>{const h=harness({orders:[order("own"),order("other","awaiting_harvest","passenger-b")],items:[{order_id:"own",product_name:"Meat",quantity:1},{order_id:"other",product_name:"SECRET"}]});const r=await h.get("?view=active&customer_user_id=passenger-b");assert.equal(r.status,200);assert.equal(r.body.orders.length,1);assert.equal(r.body.orders[0].order_code,"own");assert(!JSON.stringify(r).includes("SECRET"));assert(h.calls.some(x=>x.k==="customer_user_id"&&x.v==="passenger-a"));});
 await check("all current active states including future reservations and settlement remain active",async()=>{const h=harness({orders:[...active,...terminal].map((s,i)=>order(String(i),s))});assert.deepEqual((await h.get()).body.orders.map(x=>x.status).sort(),active.slice().sort());});
 await check("all terminal outcomes and reasons appear in history",async()=>{const h=harness({orders:[...active,...terminal].map((s,i)=>order(String(i),s))});const r=await h.get("?view=history");assert.deepEqual(r.body.orders.map(x=>x.status).sort(),terminal.slice().sort());assert.equal(r.body.orders[0].cancel_reason,"Reserved cut sold outside JRide");});
 await check("active pagination covers 57 rows with no gaps or duplicates",async()=>{const h=harness({orders:Array.from({length:57},(_,i)=>order(String(i).padStart(3,"0")))});const rr=await Promise.all([0,1,2].map(p=>h.get("?view=active&page="+p)));assert.deepEqual(rr.map(r=>r.body.orders.length),[25,25,7]);assert.deepEqual(rr.map(r=>r.body.has_more),[true,true,false]);assert.equal(new Set(rr.flatMap(r=>r.body.orders.map(x=>x.order_code))).size,57);});
 await check("past pagination uses same stable tie-breaker",async()=>{const h=harness({orders:Array.from({length:51},(_,i)=>order(String(i).padStart(3,"0"),"cancelled"))});const rr=await Promise.all([0,1,2].map(p=>h.get("?view=history&page="+p)));assert.deepEqual(rr.map(r=>r.body.orders.length),[25,25,1]);assert.equal(new Set(rr.flatMap(r=>r.body.orders.map(x=>x.order_code))).size,51);});
 await check("invalid view/page rejected before database queries",async()=>{for(const q of ["?view=producer","?view=all","?page=-1","?page=1.5","?page=oops","?page=1000000"]){const h=harness();assert.equal((await h.get(q)).status,400);assert.equal(h.calls.length,0);}});
 await check("empty successful results remain distinct from failure",async()=>{const h=harness();const r=await h.get();assert.equal(r.status,200);assert.equal(r.body.has_more,false);assert.equal(r.body.orders.length,0);assert.equal(h.calls.filter(x=>x.table&& !x.k).length,1);});
 await check("order database errors sanitized",async()=>{const r=await harness({failTable:"agrimarket_orders"}).get();assert.equal(r.status,503);assert(!JSON.stringify(r).includes("private database error"));assert(!("orders" in r.body));});
 await check("child/store failures cannot appear as complete orders",async()=>{for(const table of ["agrimarket_order_items","agrimarket_producers"]){const r=await harness({orders:[order("a")],failTable:table}).get();assert.equal(r.status,503);assert(!("orders" in r.body));}});
 await check("null payload fails closed",async()=>{for(const table of ["agrimarket_orders","agrimarket_order_items","agrimarket_producers"]){const r=await harness({orders:[order("a")],nullTable:table}).get();assert.equal(r.status,503);}});
 await check("producer private contact/pin and passenger identity not leaked",async()=>{const r=await harness({orders:[order("a")]}).get();const s=JSON.stringify(r.body);for(const key of ["contact_phone","pickup_lat","customer_user_id","producer_id"]){assert(!s.includes(key));}assert.equal(r.body.orders[0].store.town,"Lamut");});
 await check("scheduled meat history includes preparation semantics, not a driver offer",async()=>{const r=await harness({orders:[order("a")],items:[{order_id:"a",product_group:"meat"}]}).get();assert.equal(r.body.orders[0].scheduled_activity,"butchering");assert.equal(r.body.orders[0].status,"awaiting_harvest");});
 await check("missing current store does not hide owned historical order",async()=>{const r=await harness({orders:[order("a")],stores:[]}).get();assert.equal(r.status,200);assert.equal(r.body.orders[0].store,null);});
 const dispatch=fs.readFileSync(path.resolve(__dirname,"../../lib/agrimarket/dispatch.ts"),"utf8");
 await check("scheduled waiting cannot enter driver offer path",()=>{assert(dispatch.includes('const DRIVER_ACCEPT_TTL_SECONDS = 300;'));assert(dispatch.includes('if (!["preparing", "ready_for_dispatch", "dispatching"].includes(lower(order.status)))'));assert(dispatch.includes('remainingPreparationSeconds > etaToFarmer + DRIVER_ACCEPT_TTL_SECONDS'));});
 console.log("PASS: "+passed+" passenger-history and dispatch-contract groups. Mocked database/auth; no order mutation.");
})().catch(e=>{console.error(e);process.exitCode=1;});
