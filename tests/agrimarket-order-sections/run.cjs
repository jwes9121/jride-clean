const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const filename = path.resolve(__dirname,'../../app/api/agrimarket/orders/sections/route.ts');
const sqlFile = path.resolve(__dirname,'../../supabase/migrations/20260923124023_agrimarket_passenger_order_sections_v1.sql');
const sql = fs.readFileSync(sqlFile,'utf8');
function body(view='deliveries') { return {ok:true,layout:'sections_v1',view,page:0,total_count:1,active_count:3,counts:{deliveries:1,reservations:2,history:4,needs_response:0},server_now:'2026-09-23T12:00:00Z',orders:[{order_code:'test',status:'ready_for_dispatch',preferred_vehicle_type:'tricycle',fulfillment_mode:view==='reservations'?'scheduled_harvest':'always_available',items:[{product_name:'Meat',product_group:'meat',quantity:1}],cancel_reason:'Reserved cut sold outside JRide',store:{name:'Test',town:'Lamut'}}]}; }
function harness(options={}) {
 const calls=[], module={exports:{}};
 const schedule = {exports:{}};
 const wait = {exports:{}};
 const compile = f => ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
 vm.runInNewContext(compile(path.resolve(__dirname,'../../lib/agrimarket/schedule.ts')),{module:schedule,exports:schedule.exports});
 vm.runInNewContext(compile(path.resolve(__dirname,'../../lib/agrimarket/dispatchWait.ts')),{module:wait,exports:wait.exports,Date,Number,String});
 vm.runInNewContext(compile(filename),{module,exports:module.exports,Date,require:n=> {
  if(n==='next/server') return {};
  if(n==='@/lib/agrimarket/schedule') return schedule.exports;
  if(n==='@/lib/agrimarket/dispatchWait') return wait.exports;
  if(n==='../../_lib/server') return {agrimarketEnabled:()=>!options.disabled,agrimarketDisabledResponse:()=>({status:503}),
   requireAgrimarketPassenger:async()=>options.denied?{ok:false,response:{status:401}}:{ok:true,user:{id:'verified-owner'}},
   createServiceSupabase:()=>({rpc:async(name,args)=>{calls.push({name,args});if(options.throw) throw Error('private token');return options.result??{data:body(args.p_view),error:null};},
    from:name=>{const q={select:()=>q,eq:(key,value)=>{calls.push({filter:key,value});return q},in:()=>q,then:resolve=>Promise.resolve({data:options.waitRows||[],error:null}).then(resolve)};calls.push({table:name});return q}}),
   jsonNoStore:(status,body)=>({status,body})};
  throw Error(n);
 }},{filename});
 return {calls,get:q=>module.exports.GET({nextUrl:new URL('https://app.jride.net/api/agrimarket/orders/sections'+(q||''))})};
}
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name)}
(async()=>{
 await check('new sections endpoint rejects missing authentication before RPC',async()=>{const h=harness({denied:true});assert.equal((await h.get()).status,401);assert.equal(h.calls.length,0)});
 await check('disabled feature never queries orders',async()=>{const h=harness({disabled:true});assert.equal((await h.get()).status,503);assert.equal(h.calls.length,0)});
 await check('query-supplied customer ID is ignored; trusted session is sent',async()=>{const h=harness();assert.equal((await h.get('?customer_user_id=other&view=deliveries')).status,200);assert.equal(h.calls[0].args.p_customer_user_id,'verified-owner')});
 await check('all three sections use the exact read-only RPC',async()=>{for(const v of ['deliveries','reservations','history']){const h=harness();const r=await h.get('?view='+v+'&page=2');assert.equal(r.status,200);assert.equal(h.calls[0].name,'agrimarket_passenger_order_sections_v1');assert.equal(h.calls[0].args.p_page,2);assert.equal(r.body.view,v)}});
 await check('invalid view and page are rejected without a database read',async()=>{for(const q of ['?view=active','?view=all','?view=producer','?page=-1','?page=1.2','?page=hello','?page=1000000']){const h=harness();assert.equal((await h.get(q)).status,400);assert.equal(h.calls.length,0)}});
 await check('SQL counts pass through, never computed from the 25-row list',async()=>{const r=await harness().get();assert.equal(r.body.active_count,3);assert.equal(r.body.orders.length,1);assert.equal(r.body.counts.reservations,2)});
 await check('meat cards use the actual shared schedule formatter',async()=>{assert.equal((await harness().get('?view=reservations')).body.orders[0].scheduled_activity,'butchering')});
 await check('ordinary cards have no scheduled activity',async()=>{assert.equal((await harness().get()).body.orders[0].scheduled_activity,null)});
 await check('human cancellation reasons and public store towns retained',async()=>{const r=await harness().get('?view=history');assert.equal(r.body.orders[0].cancel_reason,'Reserved cut sold outside JRide');assert.equal(r.body.orders[0].store.town,'Lamut')});
 await check('fresh matching driver wait reason is owner-scoped and visible only for the current vehicle',async()=>{
  const row={order_code:'test',status:'ready_for_dispatch',preferred_vehicle_type:'tricycle',dispatch_wait_code:'outside_pickup_range',dispatch_wait_vehicle_type:'tricycle',dispatch_checked_at:new Date().toISOString()};
  const h=harness({waitRows:[row]});const r=await h.get();
  assert.match(r.body.orders[0].dispatch_wait.message,/10 km road pickup limit/);
  assert(h.calls.some(c=>c.filter==='customer_user_id'&&c.value==='verified-owner'));
  assert.equal((await harness({waitRows:[{...row,dispatch_wait_vehicle_type:'motorcycle'}]}).get()).body.orders[0].dispatch_wait,null);
 });
 await check('database errors and exceptions are bounded, not fake empty orders',async()=>{for(const o of [{throw:true},{result:{error:{message:'private sql'},data:null}}]){const r=await harness(o).get();assert.equal(r.status,503);assert(!JSON.stringify(r).includes('private'));assert(!('orders' in r.body))}});
 await check('malformed payload or wrong view does not claim a loaded section',async()=>{for(const data of [null,{}, {...body(),view:'history'},{...body(),orders:null},{...body(),counts:null},{...body(),active_count:-1}]) assert.equal((await harness({result:{data,error:null}}).get()).status,503)});
 await check('SQL is service-only and invoker-security, not executable by browser roles',()=>{assert(sql.includes('STABLE SECURITY INVOKER'));assert(sql.includes('FROM PUBLIC,anon,authenticated'));assert(sql.includes('TO service_role'))});
 await check('counts and selected page are in one owner-scoped SQL statement',()=>{assert(sql.includes('WITH owned AS MATERIALIZED'));assert(sql.includes('o.customer_user_id=p_customer_user_id'));assert(sql.includes("count(*) FILTER(WHERE section='reservations')"));assert(sql.includes('CROSS JOIN page_info'));assert(sql.includes('least(p_page,greatest((total-1)/25,0))'))});
 await check('projection returns no customer ID, driver ID, private contact or pickup coordinates',()=>{const projection=sql.slice(sql.indexOf("'order_code',o.order_code"),sql.indexOf('AS card FROM'));for(const key of ['customer_user_id','contact_phone','pickup_lat','pickup_lng']) assert(!projection.includes(key));assert(!projection.includes("'assigned_driver_id'"));assert(projection.includes("'has_assigned_driver',o.assigned_driver_id IS NOT NULL"))});
 await check('read function contains no order, reservation or dispatch mutations',()=>{const body=sql.split('AS $function$')[1].split('$function$;')[0];assert(!/\b(?:INSERT|UPDATE|DELETE)\b/i.test(body));assert(!/\bPERFORM\b/i.test(body))});
 await check('legacy history endpoint still exists and is unchanged by grouped reads',()=>{const legacy=fs.readFileSync(path.resolve(__dirname,'../../app/api/agrimarket/orders/history/route.ts'),'utf8');assert(legacy.includes('const PAGE_SIZE = 25;'));assert(legacy.includes('view === "history" ? HISTORY : ACTIVE'));assert(!legacy.includes('order_sections'))});
 console.log(`${passed} order section endpoint and SQL contract groups passed. Mocked auth/RPC; SQL snapshot is verified separately in the database.`);
})().catch(e=>{console.error(e);process.exitCode=1});
