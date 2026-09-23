const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const file = path.resolve(__dirname,"../../app/api/agrimarket/producer/orders/harvest/route.ts");
const source = ts.transpileModule(fs.readFileSync(file,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
function harness(options={}) {
 const calls=[];const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,Date,console,require(name){
  if(name==="next/server")return {};
  if(name==="../../../_lib/server")return {agrimarketEnabled:()=>true,agrimarketDisabledResponse:()=>({status:503}),
   requireAgrimarketProducer:async()=>options.denied?{ok:false,response:{status:401}}:{ok:true,producer:{id:"own-farm"}},
   createServiceSupabase:()=>({rpc:async(n,a)=>{calls.push([n,a]);return {data:options.result||{ok:false,error:"AGRIMARKET_SCHEDULE_NOT_READY"},error:null};}}),jsonNoStore:(status,body)=>({status,body})};
  throw Error(name);
 }},{filename:file});
 return {calls,post:()=>module.exports.POST({json:async()=>({order_code:"AG-TEST",action:"ready",preparation_minutes:15,confirmed_cargo_weight_basis:"exact",confirmed_cargo_weight_kg:1,confirmed_handling_tier:"standard"})})};
}
(async()=>{
 const h=harness();const r=await h.post();assert.equal(r.status,409);assert.equal(r.body.error,"AGRIMARKET_SCHEDULE_NOT_READY");assert(r.body.message.includes("customer approval"));assert(r.body.message.includes("date and time"));assert.equal(h.calls[0][1].p_producer_id,"own-farm");
 console.log("PASS early Ready returns readable schedule-specific refusal from actual route");
 const denied=harness({denied:true});assert.equal((await denied.post()).status,401);assert.equal(denied.calls.length,0);
 console.log("PASS unauthorized farmer cannot reach readiness mutation");
 const good=await harness({result:{ok:true,status:"preparing"}}).post();assert.equal(good.status,200);assert.equal(good.body.ok,true);
 console.log("PASS ordinary successful readiness response remains unchanged");
 const sql=fs.readFileSync(path.resolve(__dirname,"../../supabase/migrations/20260923080500_agrimarket_scheduled_preparation_guard_v1.sql"),"utf8");
 assert(sql.includes("NEW.harvest_expected_start_at>clock_timestamp()"));assert(sql.includes("o.harvest_expected_start_at>clock_timestamp()"));assert(sql.includes("BEFORE INSERT OR UPDATE OF status,fulfillment_mode,harvest_expected_start_at"));assert(sql.includes("FROM PUBLIC,anon,authenticated"));assert(!sql.includes("SET status="));
 const dispatch=fs.readFileSync(path.resolve(__dirname,"../../lib/agrimarket/dispatch.ts"),"utf8");assert(dispatch.includes("const DRIVER_ACCEPT_TTL_SECONDS = 300;"));
 console.log("PASS both readiness and offer gates use server clock and preserve five-minute driver offer policy");
 console.log("PASS: 4 scheduled-readiness route/schema-contract groups. Mocked database; separate real rollback probes recorded.");
})().catch(e=>{console.error(e);process.exitCode=1;});
