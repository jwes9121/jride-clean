// Offline contract tests. Auth, database and map services are mocked.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),ts=require('typescript');
const root=process.cwd();const checks=[];
function load(rel,mocks={}){
  const file=path.join(root,rel);const source=fs.readFileSync(file,'utf8');
  const out=ts.transpileModule(source,{fileName:file,compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
  assert.equal(out.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length??0,0,rel+' syntax');
  const mod={exports:{}};
  const req=name=>name in mocks?mocks[name]:name.startsWith('@/')?load(name.slice(2)+'.ts',mocks):require(name);
  vm.runInNewContext(out.outputText,{module:mod,exports:mod.exports,require:req,process,console,Buffer,URL,URLSearchParams,AbortController,Date,setTimeout,clearTimeout,fetch,Request,Response},{filename:rel});
  return mod.exports;
}
function plain(v){return JSON.parse(JSON.stringify(v));}
async function check(name,fn){await fn();checks.push(name);}
const uid='11111111-1111-4111-8111-111111111111',inquiry='22222222-2222-4222-8222-222222222222',plan='33333333-3333-4333-8333-333333333333',quote='44444444-4444-4444-8444-444444444444';
const context='a'.repeat(64);
const details={purpose:'family',requested_vehicle_type:'van',trip_mode:'one_way',scheduled_start_at:'2099-10-01T08:00:00+08:00',scheduled_end_at:'2099-10-01T20:00:00+08:00',passenger_count:8,cargo_weight_kg:null,cargo_description:null,luggage_notes:'8 bags',special_notes:null};
const points=[{label:'Pickup',lat:16.8,lng:121.1,notes:''},{label:'Destination',lat:16.4,lng:120.6,notes:''}];
const revision={inquiry_id:inquiry,plan_id:plan,context_token:context,reason:'Change itinerary',points,details};
const acceptance={inquiry_id:inquiry,quote_id:quote,context_token:context,terms_acknowledged:true};
function api(rel,options={}){
  const calls=[];const env=Object.assign({enabled:true,authed:true,rpcResult:{data:{ok:true},error:null}},options);
  const query={};for(const k of ['select','eq','order','limit'])query[k]=(...args)=>{calls.push([k,...args]);return query;};
  query.then=resolve=>resolve({data:[],error:null});
  const db={from:(name)=>{calls.push(['from',name]);return query;},rpc:async(name,args)=>{calls.push(['rpc',name,plain(args)]);return env.rpcResult;}};
  const server={jfleetFeatureFlagEnabled:()=>env.enabled,requireJfleetPassenger:async()=>env.authed?{ok:true,user:{id:uid}}:{ok:false,status:401,code:'AUTH_REQUIRED',message:'Sign in'}};
  const module=load(rel,{'@/lib/jfleet/server':server,'@/lib/supabaseAdmin':{supabaseAdmin:()=>{calls.push(['db']);return db;}},'next/server':{NextResponse:{json:(b,init)=>new Response(JSON.stringify(b),init)}}});
  return {module,calls,env};
}
const request=(body,method='POST',url='https://test.invalid/api/jfleet/customer')=>new Request(url,{method,...(method==='GET'?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
(async()=>{
  const h=load('lib/jfleet/customer.ts');
  await check('valid acceptance and no trusted client user ID',()=>{const p=plain(h.parseAcceptance({...acceptance,user_id:'attacker'}));assert.equal(p.terms_acknowledged,true);assert.equal(p.user_id,undefined);});
  for(const value of [false,'true',1,null,undefined])await check('acknowledgment rejects '+String(value),()=>assert.throws(()=>h.parseAcceptance({...acceptance,terms_acknowledged:value})));
  for(const value of ['',null,'a'.repeat(63),'x'.repeat(64)])await check('invalid context token '+String(value).slice(0,8),()=>assert.throws(()=>h.parseAcceptance({...acceptance,context_token:value})));
  await check('invalid quote identity',()=>assert.throws(()=>h.parseAcceptance({...acceptance,quote_id:'bad'})));
  await check('valid revision delegates strict itinerary and schedule parsing',()=>assert.equal(h.parseRevision(revision).details.passenger_count,8));
  for(const value of [null,[],'revise',7])await check('invalid revision object '+JSON.stringify(value),()=>assert.throws(()=>h.parseRevision(value)));
  for(const value of ['', '  ', 'x'.repeat(1501)])await check('invalid revision reason '+value.length,()=>assert.throws(()=>h.parseRevision({...revision,reason:value})));
  await check('missing map pin rejected',()=>assert.throws(()=>h.parseRevision({...revision,points:[{...points[0],lat:null},points[1]]})));
  await check('ambiguous device-local time rejected',()=>assert.throws(()=>h.parseRevision({...revision,details:{...details,scheduled_start_at:'2099-10-01T08:00'}})));
  await check('invalid fractional passengers rejected',()=>assert.throws(()=>h.parseRevision({...revision,details:{...details,passenger_count:1.5}})));
  await check('Philippines input conversion independent of host timezone',()=>assert.equal(h.phtInput(Date.parse('2099-10-01T00:00:00Z')/1000),'2099-10-01T08:00'));
  await check('raw SQL error not disclosed',()=>assert.equal(h.customerFailure('secret table and password').message.includes('secret'),false));
  await check('stale screen mapped to conflict',()=>assert.equal(h.customerFailure('JFLEET_CUSTOMER_CONTEXT_STALE').status,409));
  await check('foreign inquiry mapped to not found',()=>assert.equal(h.customerFailure('JFLEET_CUSTOMER_INQUIRY_NOT_FOUND').status,404));
  for(const route of ['app/api/jfleet/customer/route.ts','app/api/jfleet/quotes/accept/route.ts']){
    for(const method of route.includes('/customer/')?['GET','POST']:['POST']){
      await check('feature off before DB '+route+' '+method,async()=>{const a=api(route,{enabled:false});const r=await a.module[method](request(acceptance,method));assert.equal(r.status,503);assert.equal(a.calls.length,0);});
      await check('authentication before DB '+route+' '+method,async()=>{const a=api(route,{authed:false});const r=await a.module[method](request(acceptance,method));assert.equal(r.status,401);assert.equal(a.calls.length,0);});
    }
  }
  const route='app/api/jfleet/customer/route.ts';
  await check('list constrained to server passenger ID',async()=>{const a=api(route);const r=await a.module.GET(request(null,'GET'));assert.equal(r.status,200);assert.ok(a.calls.some(c=>c[0]==='eq'&&c[1]==='passenger_user_id'&&c[2]===uid));assert.equal(r.headers.get('Cache-Control'),'no-store, max-age=0');});
  await check('malformed inquiry ID rejected before DB',async()=>{const a=api(route);const r=await a.module.GET(request(null,'GET','https://test.invalid/api/jfleet/customer?id=invalid'));assert.equal(r.status,400);assert.equal(a.calls.length,0);});
  await check('detail returns only public map token',async()=>{
    const names=['MAPBOX_ACCESS_TOKEN','MAPBOX_TOKEN','NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN','NEXT_PUBLIC_MAPBOX_TOKEN'];const old=names.map(k=>process.env[k]);
    try{names.forEach(k=>delete process.env[k]);process.env.MAPBOX_ACCESS_TOKEN='sk.SECRET';process.env.NEXT_PUBLIC_MAPBOX_TOKEN='pk.PUBLIC';const a=api(route);const r=await a.module.GET(request(null,'GET','https://test.invalid/api/jfleet/customer?id='+inquiry));const b=await r.json();assert.equal(b.map_token,'pk.PUBLIC');assert.ok(!JSON.stringify(b).includes('SECRET'));assert.equal(a.calls.find(c=>c[0]==='rpc')[2].p_user_id,uid);}
    finally{names.forEach((k,i)=>old[i]===undefined?delete process.env[k]:process.env[k]=old[i]);}
  });
  for(const endpoint of [route,'app/api/jfleet/quotes/accept/route.ts']){
    await check('invalid JSON rejected '+endpoint,async()=>{const a=api(endpoint);const r=await a.module.POST(request('{'));assert.equal(r.status,400);assert.equal(a.calls.length,0);});
    await check('oversized request rejected '+endpoint,async()=>{const a=api(endpoint);const r=await a.module.POST(request('x'.repeat(25001)));assert.equal(r.status,413);assert.equal(a.calls.length,0);});
  }
  await check('revision uses server identity and exact context',async()=>{const a=api(route);const r=await a.module.POST(request({...revision,user_id:'attacker'}));assert.equal(r.status,200);const c=a.calls.find(c=>c[0]==='rpc');assert.equal(c[1],'jfleet_resubmit_inquiry_v1');assert.equal(c[2].p_user_id,uid);assert.equal(c[2].p_context_token,context);assert.equal(c[2].p_plan_id,plan);});
  await check('stale database revision response remains conflict',async()=>{const a=api(route,{rpcResult:{error:{message:'JFLEET_CUSTOMER_CONTEXT_STALE'},data:null}});const r=await a.module.POST(request(revision));assert.equal(r.status,409);});
  await check('missing reason stops API before DB',async()=>{const a=api(route);const r=await a.module.POST(request({...revision,reason:''}));assert.equal(r.status,400);assert.equal(a.calls.length,0);});
  const acceptRoute='app/api/jfleet/quotes/accept/route.ts';
  await check('legacy bare accept cannot bypass full quote review',async()=>{const a=api(acceptRoute);const r=await a.module.POST(request({inquiry_id:inquiry,quote_id:quote}));assert.equal(r.status,400);assert.equal(a.calls.length,0);assert.equal((await r.json()).code,'JFLEET_QUOTE_REVIEW_REQUIRED');});
  await check('acceptance uses server user and acknowledgment wrapper',async()=>{const a=api(acceptRoute);const r=await a.module.POST(request({...acceptance,user_id:'attacker'}));assert.equal(r.status,200);const c=a.calls.find(c=>c[0]==='rpc');assert.equal(c[1],'jfleet_customer_accept_quote_v2');assert.equal(c[2].p_user_id,uid);assert.equal(c[2].p_context_token,context);assert.equal(c[2].p_terms_acknowledged,true);});
  await check('foreign acceptance remains not found',async()=>{const a=api(acceptRoute,{rpcResult:{error:{message:'JFLEET_CUSTOMER_INQUIRY_NOT_FOUND'},data:null}});assert.equal((await a.module.POST(request(acceptance))).status,404);});
  const ui=['app/jfleet/inquiries/page.tsx','app/jfleet/inquiries/[id]/page.tsx','app/jfleet/inquiries/[id]/revise/page.tsx','app/jfleet/request/page.tsx','app/jfleet/layout.tsx','components/jfleet/CustomerItineraryEditor.tsx'];
  for(const rel of ui)await check('JSX syntax and ASCII '+rel,()=>{const s=fs.readFileSync(path.join(root,rel),'utf8');assert.ok(!/[^\x00-\x7F]/.test(s));const r=ts.transpileModule(s,{fileName:rel,compilerOptions:{jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});assert.equal(r.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);});
  const detail=fs.readFileSync(path.join(root,ui[1]),'utf8'),editor=fs.readFileSync(path.join(root,ui[5]),'utf8');
  await check('consent bound to exact displayed quote and context',()=>{assert.ok(detail.includes('data.context_token+":"+selected'));assert.ok(detail.includes('terms_acknowledged:true'));assert.ok(detail.includes('ack!==binding'));});
  await check('full inclusion exclusion and breakdown rendered',()=>{for(const x of ['quote.inclusions','quote.exclusions','quote.fuel_basis_note','quote.pricing_notes','quote.items','quote.reservation_required_amount'])assert.ok(detail.includes(x));});
  await check('editing trip details invalidates route preview',()=>{assert.ok(editor.includes('function changed(){revision.current++;setPlan(null);setReviewed(false)'));assert.ok(editor.includes('changed();setPassengers'));assert.ok(editor.includes('changed();setStart'));});
  await check('revision reuses inquiry and pinned preview',()=>{assert.ok(editor.includes('inquiry_id:seed.inquiry_id,context_token:seed.context_token'));assert.ok(editor.includes('plan_id:plan.id,points,details:tripDetails'));});
  console.log(JSON.stringify({passed:checks.length,checks,external_services:'mocked',live_mobile:'not exercised'},null,2));
})().catch(e=>{console.error(e);process.exit(1);});
