// Offline handler and source-regression tests. No authentication service, database or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const results = [];
function check(name, test) { test(); results.push(name); }
function read(p) { return fs.readFileSync(p, 'utf8'); }
function functionText(source, name) {
  const file = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) result = node.getText(file);
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.ok(result, 'Function not found: ' + name);
  return result;
}
const home = read('app/jfleet/page.tsx');
const owner = read('app/jfleet/owner/page.tsx');
const reviews = read('app/jfleet/owner/routes/page.tsx');
const retired = read('app/api/jfleet/inquiries/route.ts');
check('passenger home links to pinned request', () => assert.match(home, /href="\/jfleet\/request"/));
check('passenger home links to full quote history', () => assert.match(home, /href="\/jfleet\/inquiries"/));
check('legacy passenger writer and bare accept removed', () => {
  for (const symbol of ['submitInquiry(', 'acceptQuote(', '/api/jfleet/quotes/accept', '/api/jfleet/inquiries', '<form']) assert.ok(!home.includes(symbol), symbol);
});
check('booking cancellation and add-on endpoints retained', () => {
  assert.ok(home.includes('/api/jfleet/bookings/cancel'));
  assert.ok(home.includes('/api/jfleet/addons/respond'));
});
check('accepted booking links to its inquiry', () => assert.ok(home.includes('encodeURIComponent(booking.inquiry_id)')));
check('failed booking load is not mislabeled as empty', () => {
  assert.ok(home.includes('!bookingsLoaded')); assert.ok(home.includes('throw new Error(body?.message'));
  assert.ok(home.includes('Use Refresh bookings to retry.'));
});
check('booking alerts remain outside removed form', () => { assert.ok(home.includes('role="alert"')); assert.ok(home.includes('role="status"')); });
check('in-progress and due trips do not offer ordinary cancellation', () => {
  assert.ok(home.includes('booking.status !== "on_trip"'));
  assert.ok(home.includes('Date.parse(booking.scheduled_start_at) > Date.now()'));
});
check('booking dates use Philippines formatter', () => assert.ok(home.includes('return philippinesTime(value)')));
check('owner old quote writer and draft form removed', () => {
  for (const symbol of ['sendQuote(', 'quoteDraft(', 'setQuoteDrafts', '/api/jfleet/owner/quotes']) assert.ok(!owner.includes(symbol), symbol);
});
check('owner links exact inquiry to route review', () => assert.ok(owner.includes('"/jfleet/owner/routes?inquiry_id=" + encodeURIComponent(inquiry.id)')));
check('owner inquiry ID validated before automatic open', () => assert.ok(reviews.includes('UUID.test(requestedInquiry)')));
check('owner deep link responds to query navigation', () => assert.ok(reviews.includes('[requestedInquiry, open]')));
check('owner search parameters have Suspense boundary', () => assert.ok(reviews.includes('<Suspense fallback=')));
check('owner stale response selection guard retained', () => assert.ok(reviews.includes('generation===selectionRef.current')));
check('owner review and quote acknowledgments retained', () => {
  assert.ok(reviews.includes('busy||!ack||!mapReady'));
  assert.ok(reviews.includes('route_review_id:ctx.approved_review_id'));
  assert.ok(reviews.includes('busy||!confirmQuote'));
});
check("owner base payment uses durable form instead of legacy sender", () => {assert.ok(owner.includes("<OwnerPaymentForm"));assert.ok(!owner.includes("async function confirmPayment("));});
const preserved = {
  "assign": "c31972d574c58fe4c17e438feaffb78ffe26dabbd31733cc907e3efccd83e27c",
  "proposeAddon": "25d78bbd3f49ccb85c4280a6c517fedbda830065abf5b88be16520e3cd78c4cd",
  "confirmAddonPayment": "6cb88e48df3485dff66bce1f12f1f5280a1eb0ee27f4e1d3227dc23891d03d28"
};
for (const [name, expected] of Object.entries(preserved)) {
  check('owner ' + name + ' implementation unchanged', () => {
    assert.equal(crypto.createHash('sha256').update(functionText(owner, name)).digest('hex'), expected);
  });
}
for (const file of ['app/jfleet/page.tsx','app/jfleet/owner/page.tsx','app/jfleet/owner/routes/page.tsx','app/api/jfleet/inquiries/route.ts']) {
  check('ASCII and TS/JSX syntax: ' + file, () => {
    const source=read(file); assert.ok(!/[^\x00-\x7F]/.test(source));
    const result=ts.transpileModule(source,{fileName:file,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020,module:ts.ModuleKind.CommonJS},reportDiagnostics:true});
    assert.equal(result.diagnostics.length,0);
  });
}
function handler(enabled, authenticated) {
  let authCalls=0, dbCalls=0;
  const exports={};
  const output=ts.transpileModule(retired,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(output, {exports,require:(name)=>{
    if(name==='next/server')return {NextResponse:{json:(body,init)=>({body,...init})}};
    if(name==='@/lib/jfleet/server')return {jfleetFeatureFlagEnabled:()=>enabled,requireJfleetPassenger:async()=>{authCalls++;return authenticated?{ok:true,user:{id:'fixture-user'}}:{ok:false,status:401,code:'AUTH_REQUIRED',message:'Sign in'};}};
    if(name==='@/lib/supabaseAdmin')return {supabaseAdmin:()=>{dbCalls++;throw new Error('Unexpected database access');}};
    throw new Error(name);
  }});
  return {post:exports.POST,counts:()=>({authCalls,dbCalls})};
}
(async()=>{
  let h=handler(false,false),r=await h.post({});
  check('retired POST honors disabled gate first',()=>{assert.equal(r.status,503);assert.equal(r.body.code,'JFLEET_NOT_ENABLED');assert.deepEqual(h.counts(),{authCalls:0,dbCalls:0});});
  h=handler(true,false);r=await h.post({});
  check('retired POST authenticates before disclosure',()=>{assert.equal(r.status,401);assert.deepEqual(h.counts(),{authCalls:1,dbCalls:0});});
  h=handler(true,true);r=await h.post({json:()=>{throw new Error('Must not parse/forward legacy payload');}});
  check('retired POST returns actionable Gone with no writes',()=>{assert.equal(r.status,410);assert.equal(r.body.next_path,'/jfleet/request');assert.equal(r.body.ok,false);assert.equal(h.counts().dbCalls,0);});
  check('retired POST never redirects stale write payload',()=>{assert.equal(r.headers.Location,undefined);assert.match(r.headers['Cache-Control'],/no-store/);assert.match(r.body.message,/No inquiry was created/);});
  check('legacy GET remains a scoped historical read',()=>{const s=retired.slice(retired.indexOf('export async function GET'));assert.match(s,/\.eq\("passenger_user_id", auth.user.id\)/);assert.ok(!s.includes('.insert('));});
  console.log(JSON.stringify({passed:results.length,checks:results,network:'not used',auth_database:'mocked'},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
