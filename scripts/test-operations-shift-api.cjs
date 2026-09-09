const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { NextRequest } = require('next/server');
let access={ok:true,staff:{email:'one@example.test',role:'dispatcher'}};
let calls=[]; let result={data:{ok:true},error:null};
function load(file) {
  const full=path.resolve(file); const mod=new Module(full,module); mod.paths=module.paths;
  mod.require=name=>name==='@/lib/auth/requireStaff'?{requireStaff:async()=>access}:
    name==='@/lib/supabaseAdmin'?{supabaseAdmin:()=>({rpc:async(name,args)=>{calls.push({name,args});return result;}})}:
    name.startsWith('@/lib/')?load(name.replace('@/','')+'.ts'):require(name);
  mod._compile(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,full);
  return mod.exports;
}
const route=load('app/api/admin/operations-schedule/shift-report/outreach/route.ts');
const report=load('lib/operations-shift-report.ts'); const outreach=load('lib/operations-shift-outreach.ts');
const payload={day:'2026-09-10',duty:'primary',driver_id:'10000000-0000-4000-8000-000000000001',request_id:'20000000-0000-4000-8000-000000000001',channel:'call',outcome:'no_answer',note:'Called; no answer.',previous_contact_id:null};
const post=(patch={},origin='https://app.example.test')=>route.POST(new NextRequest('https://app.example.test/api/admin/operations-schedule/shift-report/outreach',{
  method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({...payload,...patch})}));
let passed=0; async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('unauthenticated and cross-origin requests never reach the database',async()=>{
    access={ok:false,status:401,error:'NOT_SIGNED_IN'}; calls=[]; assert.equal((await post()).status,401); assert.equal(calls.length,0);
    access={ok:true,staff:{email:'one@example.test',role:'dispatcher'}}; assert.equal((await post({},'https://evil.example')).status,403); assert.equal(calls.length,0);
  });
  await test('staff identity and admin flag come only from the server session',async()=>{
    calls=[];assert.equal((await post({p_admin:true,p_email:'admin@example.test',actor_id:'other'})).status,200);
    assert.equal(calls[0].args.p_email,'one@example.test');assert.equal(calls[0].args.p_admin,false);
  });
  await test('malformed date, UUID, prototype keys and non-ASCII notes are rejected',async()=>{
    for(const p of [{day:'2026-02-30'},{driver_id:'invalid'},{channel:'constructor'},{outcome:'__proto__'},{note:'Very bad \u00e9 note'},{note:'short'}]) assert.equal((await post(p)).status,400);
  });
  await test('database conflict and failure stay visible rather than becoming zero stats',async()=>{
    result={data:null,error:{code:'40001',message:'Refresh first'}};assert.equal((await post()).status,409);
    result={data:null,error:{code:'XX000'}};const r=await route.GET(new NextRequest('https://app.example.test/api/admin/operations-schedule/shift-report/outreach?day=2026-09-10&duty=primary'));
    assert.equal(r.status,503);assert.match((await r.json()).error,/not counted as zero/);
  });
  await test('half-open Philippine shift boundaries and unique-contact totals',async()=>{
    assert.equal(report.inShift('2026-09-10T07:00Z','2026-09-10','primary'),false);
    assert.equal(report.inShift('2026-09-10T07:00Z','2026-09-10','evening'),true);
    assert.deepEqual(outreach.outreachStats([{driver_id:'a',online_after_contact_at:null},{driver_id:'a',online_after_contact_at:'later'},{driver_id:'b',online_after_contact_at:null}]),{attempts:3,contacted:2,laterOnline:1});
    assert.equal(outreach.contactPhone('javascript:alert(1)'),null); assert.equal(outreach.contactPhone('+63 912 345 6789'),'tel:+639123456789');
  });
  console.log(`${passed} API and calculation checks passed.`);
})().catch(e=>{console.error(e);process.exitCode=1;});
