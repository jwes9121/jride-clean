const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
function moduleAt(path, imports = {}) {
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, require: name => imports[name] || require(name), Buffer, Date, Set, console, process }, { filename: path });
  return exports;
}
const h = moduleAt('lib/driver/jobHistory.ts');
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }
const id = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const row = (n, extra = {}) => ({ id: id(n), created_at: '2026-09-10T22:00:00.000001+00:00', status: 'completed', ...extra });
const receipt = row(500, { order_code: 'AG-20260911-25784445', driver_delivery_payout: 30, producer_paid_at: 'yes', producer_paid_amount: 110, final_cash_collected_at: 'yes', final_cash_collected_amount: 160, customer_cash_collected_amount: 0, wallet_settlement_status: 'settled', wallet_settlement_amount: 20 });
function plain(v) { return JSON.parse(JSON.stringify(v)); }
(async () => {
  await check('recorded AgriMarket receipt distinguishes earnings from collected cash', () => {
    const r = h.mapJob(receipt, 'agrimarket');
    assert.equal(r.driver_earnings, 30); assert.equal(r.cash_collected, 160); assert.equal(r.farmer_paid, 110); assert.equal(r.wallet_deduction, 20); assert.equal(r.fare, undefined);
  });
  await check('advance and final confirmed collections are summed once', () => {
    const r = h.mapJob({ ...receipt, customer_cash_collected_at: 'yes', customer_cash_collected_amount: 110, final_cash_collected_amount: 50 }, 'agrimarket');
    assert.equal(r.cash_collected, 160);
  });
  await check('unconfirmed stored amounts are not reported as received', () => {
    const r = h.mapJob({ ...receipt, status: 'delivering', producer_paid_at: null, final_cash_collected_at: null, wallet_settlement_status: 'pending' }, 'agrimarket');
    assert.equal(r.cash_collected, null); assert.equal(r.farmer_paid, null); assert.equal(r.driver_earnings, null); assert.equal(r.wallet_deduction, null);
  });
  await check('missing confirmed amounts are not fabricated as zero', () => {
    assert.equal(h.mapJob({ ...receipt, final_cash_collected_amount: null }, 'agrimarket').cash_collected, null);
  });
  await check('legacy fare semantics remain unchanged and are not relabeled earnings', () => {
    const r = h.mapJob(row(1, { service_type: 'errand', proposed_fare: 166, pickup_distance_fee: 100, driver_payout: 146 }), 'bookings');
    assert.equal(r.fare, 266); assert.equal(r.driver_earnings, undefined);
  });
  await check('verified zero fare does not fall through to proposed fare', () => {
    assert.equal(h.mapJob(row(1, { verified_fare: 0, proposed_fare: 50, pickup_distance_fee: 0 }), 'bookings').fare, 0);
  });
  await check('database motorcycle and tricycle service types map to Ride', () => {
    for (const service_type of ['motorcycle', 'tricycle']) assert.equal(h.mapJob(row(1, { service_type }), 'bookings').service_type, 'ride');
  });
  await check('two tables are merged in deterministic descending order', () => {
    const p = h.mergeHistory([row(3)], [row(2), row(4)], new Set());
    assert.deepEqual(plain(p.items.map(x => x.key)), ['agrimarket:' + id(4), 'bookings:' + id(3), 'agrimarket:' + id(2)]);
  });
  await check('microsecond timestamps survive ordering and cursor generation', () => {
    const p = h.mergeHistory(Array.from({ length: 11 }, (_, i) => row(i + 1)), [row(99, { created_at: '2026-09-10T22:00:00.000002Z' })], new Set());
    assert.equal(p.items[0].key, 'agrimarket:' + id(99));
    assert.equal(h.decodeHistoryCursor(p.next_cursor).at, '2026-09-10T22:00:00.000001Z');
  });
  await check('pagination traverses more than 10 mixed-service jobs without loss or repeats', () => {
    const all = Array.from({ length: 53 }, (_, i) => ({ ...row(i + 1), source: i % 2 ? 'bookings' : 'agrimarket' }));
    let cursor = null, seen = [], pages = 0;
    do {
      const filtered = all.filter(r => !cursor || r.id < cursor.id || (r.id === cursor.id && r.source < cursor.source));
      const b = filtered.filter(r => r.source === 'bookings').sort((a,b) => b.id.localeCompare(a.id)).slice(0,11);
      const a = filtered.filter(r => r.source === 'agrimarket').sort((a,b) => b.id.localeCompare(a.id)).slice(0,11);
      const p = h.mergeHistory(b, a, new Set()); seen.push(...p.items.map(r => r.key));
      cursor = h.decodeHistoryCursor(p.next_cursor); pages++;
    } while (cursor && pages < 10);
    assert.equal(seen.length, 53); assert.equal(new Set(seen).size, 53); assert.equal(pages, 6);
  });
  await check('linked booking rows are omitted and empty duplicate pages still advance', () => {
    const b = Array.from({length:11}, (_, i) => row(i + 1));
    const p = h.mergeHistory(b, [], new Set(b.map(r => r.id)));
    assert.equal(p.items.length, 0); assert.equal(p.has_more, true); assert.ok(p.next_cursor);
  });
  await check('same timestamp and UUID across tables retain a source tie-breaker', () => {
    const p=h.mergeHistory([row(5)], [row(5)], new Set());
    assert.equal(p.items[0].key, 'bookings:' + id(5));
    const c={at:'2026-09-10T22:00:00.000001Z',id:id(5),source:'bookings'};
    assert.ok(h.historyFilter(c,'agrimarket').includes('id.lte.')); assert.ok(h.historyFilter(c,'bookings').includes('id.lt.'));
  });
  await check('malformed or injection-bearing cursors are rejected before database access', () => {
    for (const c of ['', 'x'.repeat(301), Buffer.from(JSON.stringify({ at: '2026-09-10T00:00:00Z),id.gt.0', id: id(1), source:'bookings' })).toString('base64url')]) assert.throws(() => h.decodeHistoryCursor(c));
  });

  const requests=[];
  const { createClient } = require('@supabase/supabase-js');
  const db=createClient('https://example.supabase.co','fixture-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url) => {requests.push(new URL(url)); return new Response('[]',{status:200,headers:{'content-type':'application/json'}});}}});
  await check('real query builder retains ownership, cursor filters and bounded page sizes', async () => {
    const c={at:'2026-09-10T22:00:00.000001Z',id:id(5),source:'bookings'};
    await h.readJobHistory(db,id(2),c);
    const b=requests.find(u=>u.pathname.endsWith('/bookings'));
    const a=requests.find(u=>u.pathname.endsWith('/agrimarket_orders'));
    assert.equal(b.searchParams.getAll('or').length,1); assert.ok(b.searchParams.get('or').includes('and(or(driver_id.eq.'+id(2)));
    assert.ok(b.searchParams.get('or').includes('created_at.lt.')); assert.equal(b.searchParams.get('limit'),'11');
    assert.equal(a.searchParams.get('assigned_driver_id'),'eq.'+id(2)); assert.equal(a.searchParams.get('limit'),'11');
  });
  await check('failed data reads reject the page instead of returning partial history', async () => {
    const bad=createClient('https://example.supabase.co','fixture-key',{global:{fetch:async()=>new Response('{"message":"fixture failure"}',{status:400})}});
    await assert.rejects(h.readJobHistory(bad,id(2),null),/HISTORY_READ_FAILED/);
  });
  const sha = s => require('node:crypto').createHash('sha256').update(s).digest('hex');
  const after=fs.readFileSync('app/api/driver/profile/route.ts','utf8');
  await check('profile photo POST and driver identity resolution remain byte-for-byte unchanged', () => {
    assert.equal(sha(after.slice(after.indexOf('export async function POST'))), '5f2958c8c8a6bb44cd4303edff330fda49413f51e654e8570f5a6687f0cf5e11');
    const identity=s=>s.slice(s.indexOf('async function resolveDriverIdentity'),s.indexOf('function buildTripSummary'));
    assert.equal(sha(identity(after)), 'f32692763fe7b0e2614e8c1660336bc1a5cb84cd935c3bc1c7661fb0e35ff261');
  });
  process.env.SUPABASE_URL='https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-key';
  process.env.DRIVER_PING_SECRET='fixture-driver-secret';
  let authenticated=false, failHistory=false;
  const filters=[];
  const mockDb={auth:{getUser:async()=>({data:{user:authenticated?{id:id(2)}:null}})},from(table){
    const q={select(){return q},eq(k,v){filters.push([table,k,v]);return q},or(v){filters.push([table,'or',v]);return q},order(){return q},limit(){return q},in(){return q},
      maybeSingle:async()=>({data:table==='driver_profiles'?{driver_id:id(2),full_name:'Tester Driver Jr.'}:{wallet_balance:860,min_wallet_required:250}}),
      then(resolve,reject){return Promise.resolve({data:table==='agrimarket_orders'?[receipt]:[],error:failHistory?{message:'private internal error'}:null}).then(resolve,reject)}};
    return q;
  }};
  const route=moduleAt('app/api/driver/profile/route.ts',{
    'next/server':{NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}},
    '@supabase/supabase-js':{createClient:()=>mockDb},
    '@/lib/driver/jobHistory':h,
    'sharp':()=>{},
  });
  const request=(headers={},query='history_version=2')=>({headers:new Headers(headers),nextUrl:new URL('https://app.jride.net/api/driver/profile?'+query)});
  await check('unauthenticated History request is rejected',async()=>{
    const r=await route.GET(request());assert.equal(r.status,401);assert.equal(r.body.job_history,undefined);
  });
  await check('authenticated driver ownership overrides another requested driver UUID',async()=>{
    authenticated=true;filters.length=0;
    const r=await route.GET(request({authorization:'Bearer fixture'},'history_version=2&driver_id='+id(999)));
    assert.equal(r.body.profile.driver_id,id(2));assert.equal(r.body.job_history.items[0].driver_earnings,30);
    assert.ok(filters.some(f=>f[0]==='agrimarket_orders'&&f[1]==='assigned_driver_id'&&f[2]===id(2)));
    assert.ok(!filters.some(f=>String(f[2]).includes(id(999))));
  });
  await check('History read failure retains profile without leaking raw database errors',async()=>{
    failHistory=true;
    const r=await route.GET(request({authorization:'Bearer fixture'}));
    assert.equal(r.body.profile.wallet_balance,860);assert.equal(r.body.job_history.error,'HISTORY_UNAVAILABLE');assert.ok(!JSON.stringify(r).includes('private internal error'));
    failHistory=false;
  });
  await check('existing clients keep their recent_trips response contract',async()=>{
    const r=await route.GET(request({authorization:'Bearer fixture'},''));assert.ok(Array.isArray(r.body.recent_trips));assert.equal(r.body.job_history,undefined);
  });
  console.log('PASS '+count+' server history checks');
})().catch(e=>{console.error(e);process.exitCode=1});
