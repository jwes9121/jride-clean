// Offline contract tests. No network, tokens, database writes or external packages.
const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const assert=require('node:assert/strict');const ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const files={helper:'lib/jfleet/routeReview.ts',api:'app/api/jfleet/owner/routes/route.ts',quotes:'app/api/jfleet/owner/quotes/route.ts',ui:'app/jfleet/owner/routes/page.tsx',map:'components/jfleet/ReviewedRouteMap.tsx'};
let passes=0;const names=[];
function ok(name,fn){fn();passes++;names.push(name);}
function load(file,mocks={}){
 const source=fs.readFileSync(path.join(root,file),'utf8');
 const out=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});
 assert.equal((out.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,'syntax: '+file);
 const module={exports:{}};
 vm.runInNewContext(out.outputText,{module,exports:module.exports,require:(n)=>{if(n in mocks)return mocks[n];throw new Error('Unexpected import '+n);},Buffer,URL,Request,Response,Date,console,process:{env:{MAPBOX_TOKEN:'sk.do-not-expose',NEXT_PUBLIC_MAPBOX_TOKEN:'pk.mock'}}},{filename:file});
 return module.exports;
}
const h=load(files.helper);const id='00000000-0000-4000-8000-000000000001';const rid='00000000-0000-4000-8000-000000000002';
const review={inquiry_id:id,snapshot_hash:'a'.repeat(64),decision:'approved',notes:'Checked',acknowledged:true};
ok('valid approval parsed',()=>assert.equal(h.parseReview(review).decision,'approved'));
ok('change request requires no approval checkbox',()=>assert.equal(h.parseReview({...review,decision:'changes_requested',acknowledged:false}).decision,'changes_requested'));
for(const [name,patch] of [['invalid ID',{inquiry_id:'x'}],['missing fingerprint',{snapshot_hash:null}],['invalid fingerprint',{snapshot_hash:'g'.repeat(64)}],['invalid decision',{decision:'yes'}],['checkbox cannot be a string',{acknowledged:'true'}],['checkbox required',{acknowledged:false}],['oversized notes',{notes:'x'.repeat(1501)}],['blank change request',{decision:'changes_requested',notes:' '}]] ) ok(name,()=>assert.throws(()=>h.parseReview({...review,...patch})));
for(const value of [null,[],7,'approved'])ok('reject nonobject '+JSON.stringify(value),()=>assert.throws(()=>h.parseReview(value)));
ok('untrusted owner identity ignored',()=>assert.equal(h.parseReview({...review,owner_user_id:'attacker'}).owner_user_id,undefined));
ok('raw database error not leaked',()=>assert.ok(!h.reviewFailure('token=secret database details').message.includes('secret')));
ok('stale review is conflict',()=>assert.equal(h.reviewFailure('JFLEET_ROUTE_REVIEW_STALE').status,409));
ok('foreign inquiry is not found',()=>assert.equal(h.reviewFailure('JFLEET_OWNER_INQUIRY_NOT_FOUND').status,404));
ok('Philippines timezone explicit',()=>assert.match(h.philippinesTime('2026-10-01T00:00:00Z'),/8:00/));
function harness(file,{enabled=true,status='active',authorized=true,rpcError=null}={}){
 const calls=[];let query;
 const db={rpc:async(n,p)=>{calls.push({n,p});return {data:{ok:true,version_no:1,snapshot:{}},error:rpcError?{message:rpcError}:null};},from:(table)=>{calls.push({table});query={select(){return this},eq(...a){calls.push({eq:a});return this},in(){return this},order(){return this},limit(){return Promise.resolve({data:[],error:null})}};return query;}};
 const module=load(file,{'next/server':{NextResponse:{json:(b,opts)=>new Response(JSON.stringify(b),{...opts,headers:{...opts.headers,'Content-Type':'application/json'}})}},'@/lib/supabaseAdmin':{supabaseAdmin:()=>db},'@/lib/jfleet/server':{jfleetFeatureFlagEnabled:()=>enabled,requireJfleetOwner:async()=>authorized?{ok:true,user:{id:'server-owner'},partner:{id:'server-partner',status}}:{ok:false,status:401,code:'AUTH',message:'Sign in.'}},'@/lib/jfleet/routeReview':h});
 return {module,calls};
}
async function responseTest(name,file,options,method,body,expected,suffix=''){
 const x=harness(file,options);const r=await x.module[method](new Request('https://test.invalid/api'+suffix,method==='GET'?{}:{method:'POST',body:typeof body==='string'?body:JSON.stringify(body)}));
 assert.equal(r.status,expected,name);assert.match(r.headers.get('cache-control'),/no-store/);passes++;names.push(name);return {...x,body:await r.json()};
}
(async()=>{
 for(const f of [files.api,files.quotes]){
  const a=await responseTest('feature off before DB '+f,f,{enabled:false},'POST',{},503);assert.equal(a.calls.length,0);
  const b=await responseTest('unauthenticated before DB '+f,f,{authorized:false},'POST',{},401);assert.equal(b.calls.length,0);
  const c=await responseTest('suspended owner before DB '+f,f,{status:'suspended'},'POST',{},403);assert.equal(c.calls.length,0);
 }
 await responseTest('malformed review JSON',files.api,{},'POST','{',400);
 await responseTest('large review rejected',files.api,{},'POST','x'.repeat(8001),413);
 const reviewed=await responseTest('approval uses server identity',files.api,{},'POST',{...review,owner_user_id:'attacker'},200);assert.equal(reviewed.calls[0].p.p_owner_user_id,'server-owner');assert.equal(reviewed.calls[0].p.p_snapshot_hash,review.snapshot_hash);
 await responseTest('stale DB decision mapped',files.api,{rpcError:'JFLEET_ROUTE_REVIEW_STALE'},'POST',review,409);
 const detail=await responseTest('private detail and public-only token',files.api,{},'GET',null,200,'?inquiry_id='+id);assert.equal(detail.body.map_token,'pk.mock');assert.equal(detail.calls[0].p.p_owner_user_id,'server-owner');
 const list=await responseTest('list constrained to owner partner',files.api,{},'GET',null,200);assert.ok(list.calls.some(c=>c.eq?.[0]==='partner_id'&&c.eq[1]==='server-partner'));
 const quote={inquiry_id:id,route_review_id:rid,total_amount:10000,valid_until:'2099-01-01T12:00:00+08:00',items:[]};
 await responseTest('legacy quote without review ID blocked',files.quotes,{},'POST',{...quote,route_review_id:null},409);
 await responseTest('invalid money rejected',files.quotes,{},'POST',{...quote,total_amount:'NaN'},400);
 await responseTest('quote breakdown mismatch rejected',files.quotes,{},'POST',{...quote,items:[{label:'Hire',amount:50}]},400);
 const sent=await responseTest('quote calls reviewed RPC with exact ID',files.quotes,{},'POST',{...quote,owner_user_id:'attacker'},201);assert.equal(sent.calls[0].n,'jfleet_owner_send_reviewed_quote_v1');assert.equal(sent.calls[0].p.p_review_id,rid);assert.equal(sent.calls[0].p.p_owner_user_id,'server-owner');
 await responseTest('quote stale token mapped',files.quotes,{rpcError:'JFLEET_ROUTE_REVIEW_STALE'},'POST',quote,409);
 await responseTest('quote validity after departure mapped',files.quotes,{rpcError:'JFLEET_QUOTE_VALIDITY_INVALID'},'POST',quote,409);
 for(const f of [files.ui,files.map])ok('JSX syntax '+f,()=>{const o=ts.transpileModule(fs.readFileSync(path.join(root,f),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},reportDiagnostics:true});assert.equal((o.diagnostics||[]).filter(d=>d.category===1).length,0);});
 const ui=fs.readFileSync(path.join(root,files.ui),'utf8');
 ok('approval disabled without loaded map and acknowledgment',()=>assert.match(ui,/disabled=\{busy\|\|!ack\|\|!mapReady\}/));
 ok('quote uses displayed approval',()=>assert.match(ui,/route_review_id:ctx.approved_review_id/));
 ok('cross-screen response race guarded',()=>assert.match(ui,/generation===selectionRef.current/));
 console.log(JSON.stringify({passed:passes,checks:names,external_services:'mocked',mobile_browser:'not exercised'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
