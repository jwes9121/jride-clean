// Offline contracts and fail-closed API guards; browser/real DB tests are separate.
const fs=require('node:fs'), vm=require('node:vm'), assert=require('node:assert/strict'), ts=require('typescript');
const checks=[];
function check(name,fn){fn();checks.push(name);}
function mod(file,deps={}) {const exports={}; const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(code,{exports,require:n=>{if(n in deps)return deps[n];throw Error(n);},URL,URLSearchParams,Date,Math,JSON});return exports;}
const m=mod('lib/jfleet/ownerPayment.ts');
const scope={owner_user_id:'11111111-1111-1111-1111-111111111111',partner_id:'22222222-2222-2222-2222-222222222222',booking_id:'33333333-3333-3333-3333-333333333333'};
const fields={payment_kind:'reservation',amount:1200,payment_channel:'Cash',payment_reference:'Receipt 01',notes:'Testing'};
const req={...fields,booking_id:scope.booking_id,idempotency_key:'JFP-stable-payment-001',expected_owner_id:scope.owner_user_id,expected_partner_id:scope.partner_id};
const receipt={...fields,...scope,idempotency_key:req.idempotency_key,payment_id:'44444444-4444-4444-4444-444444444444',status:'confirmed',confirmed_at:'2026-09-23T00:00:00Z'};
check('valid frozen request parsed',()=>assert.equal(m.paymentRequest(req).idempotency_key,req.idempotency_key));
for(const v of ['',undefined,null,'short','abc defghi','x'.repeat(121)])check('reject invalid key '+String(v).slice(0,12),()=>assert.throws(()=>m.paymentRequest({...req,idempotency_key:v})));
for(const v of [0,-1,Infinity,NaN,'1200',true,1.001,100000001])check('reject invalid amount '+String(v),()=>assert.throws(()=>m.paymentFields({...fields,amount:v})));
check('normalize approved text whitespace consistently',()=>assert.equal(m.paymentFields({...fields,payment_channel:' Cash\n payment '}).payment_channel,'Cash payment'));
check('do not truncate payment reference',()=>assert.throws(()=>m.paymentFields({...fields,payment_reference:'x'.repeat(181)})));
check('scope separates owner identity',()=>assert.notEqual(m.paymentScopeKey(scope),m.paymentScopeKey({...scope,owner_user_id:scope.partner_id})));
check('scope separates booking',()=>assert.notEqual(m.paymentScopeKey(scope),m.paymentScopeKey({...scope,booking_id:scope.partner_id})));
check('reject unavailable owner scope',()=>assert.throws(()=>m.paymentScope({...scope,owner_user_id:''})));
check('verified receipt matches entire request',()=>assert.equal(m.checkedReceipt(receipt,scope,req).payment_id,receipt.payment_id));
for(const change of [{amount:1201},{payment_reference:'different'},{payment_channel:'other'},{notes:'other'},{status:'pending'},{booking_id:scope.partner_id},{owner_user_id:scope.partner_id},{idempotency_key:'JFP-other-001'},{confirmed_at:''}])check('reject mismatched receipt '+Object.keys(change)[0],()=>assert.throws(()=>m.checkedReceipt({...receipt,...change},scope,req)));
const source=fs.readFileSync('app/api/jfleet/owner/payments/route.ts','utf8');
check('server never invents a new payment key',()=>assert.ok(!source.includes('randomUUID')));
check('API binds persisted owner identity to authenticated context',()=>assert.ok(source.includes('r.expected_owner_id !== a.user.id')));
check('GET reconciliation explicitly keeps unknown requests',()=>assert.ok(source.includes('a concurrent POST may still commit')));
const ui=fs.readFileSync('components/jfleet/OwnerPaymentForm.tsx','utf8'), store=fs.readFileSync('lib/jfleet/ownerPaymentStore.ts','utf8');
check('save request before sending HTTP',()=>assert.ok(ui.indexOf('await preparePaymentSlot')<ui.indexOf('await fetch(')));
check('pending payment fields remain locked',()=>assert.ok(ui.includes('slot.phase !== "draft"')));
check('unknown outcome cannot reset payment slot',()=>assert.ok(store.includes('old.phase !== "confirmed"')));
check('transaction completed before promise resolves',()=>assert.ok(store.includes('tx.oncomplete = () => {db.close(); resolve(result);};')));
check('cross-tab mutations compare generation',()=>assert.ok(store.includes('old.generation !== generation')));
check('no unsafe memory or localStorage fallback',()=>assert.ok(!store.includes('localStorage')));
check('payment form has synchronous duplicate-click guard',()=>assert.ok(ui.includes('guard.current = true; setBusy(true)')));
check('form does not clear pending request on server not-found',()=>assert.ok(ui.includes('No receipt is visible yet. Keep this request')));
for(const file of ['lib/jfleet/ownerPayment.ts','lib/jfleet/ownerPaymentStore.ts','components/jfleet/OwnerPaymentForm.tsx','app/api/jfleet/owner/payments/route.ts','app/api/jfleet/owner/dashboard/route.ts','app/jfleet/owner/page.tsx'])check('ASCII and syntax '+file,()=>{const src=fs.readFileSync(file,'utf8');assert.ok(!/[^\x00-\x7F]/.test(src));assert.equal(ts.transpileModule(src,{fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).diagnostics.length,0);});
function handler(enabled,authed){let db=0;const e=mod('app/api/jfleet/owner/payments/route.ts',{'@/lib/jfleet/ownerPayment':m,'next/server':{NextResponse:{json:(body,init)=>({body,...init})}},'@/lib/supabaseAdmin':{supabaseAdmin:()=>{db++;throw Error('Unexpected ledger access');}},'@/lib/jfleet/server':{jfleetFeatureFlagEnabled:()=>enabled,requireJfleetOwner:async()=>authed?{ok:true,user:{id:scope.owner_user_id},partner:{id:scope.partner_id,status:'active'}}:{ok:false,status:401,code:'AUTH_REQUIRED',message:'Sign in'}}});return {...e,db:()=>db};}
(async()=>{
 let h=handler(false,false), r=await h.POST({text:()=>{throw Error('Must not parse');}});check('feature off fails before ledger',()=>{assert.equal(r.status,503);assert.equal(h.db(),0);});
 h=handler(true,false);r=await h.POST({});check('authentication before ledger',()=>{assert.equal(r.status,401);assert.equal(h.db(),0);});
 h=handler(true,true);r=await h.POST({text:async()=>JSON.stringify({...req,idempotency_key:undefined})});check('missing key fails before ledger writes',()=>{assert.equal(r.status,400);assert.equal(h.db(),0);});
 r=await h.POST({text:async()=>JSON.stringify({...req,expected_owner_id:scope.partner_id})});check('changed account blocked before payment lookup',()=>{assert.equal(r.status,409);assert.equal(h.db(),0);});
 r=await h.POST({text:async()=>'{bad'});check('malformed JSON is rejected',()=>assert.equal(r.status,400));
 r=await h.GET({url:'http://localhost/api/jfleet/owner/payments?booking_id='+scope.booking_id});check('receipt lookup requires complete saved scope',()=>{assert.equal(r.status,400);assert.equal(h.db(),0);});
 console.log(JSON.stringify({passed:checks.length,checks,database:'mocked in this file',browser:'not exercised in this file'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
