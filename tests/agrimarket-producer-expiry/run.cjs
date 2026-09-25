// Real SQL function deadline/stock checks are performed separately with rollback.
// These tests run the actual cron route with controlled external dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app/api/cron/agrimarket-dispatch/route.ts'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
function harness(options = {}) {
  const calls = [];
  const admin = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (options.error === name) return { data: null, error: { message: 'SECRET_DATABASE_DETAIL' } };
      if (name === 'agrimarket_expire_pending_orders_v1') return { data: options.expired || [], error: null };
      return { data: [], error: null };
    },
    from: name => {
      calls.push({ name });
      let mutation = false;
      const q = { update: payload => { mutation = true; calls.push({ name, payload }); return q; }, eq: () => q, lte: () => q, select: () => q,
        is: () => q, in: () => q, order: () => q, limit: () => q,
        then: resolve => Promise.resolve({ data: name === 'agrimarket_orders' && !mutation ? options.pendingRows || [] : [], error: null }).then(resolve) };
      return q;
    },
  };
  const mocks = {
    'next/server': { NextResponse: { json: (body, opts) => ({ body, status: opts.status }) } },
    '@/lib/supabaseAdmin': { supabaseAdmin: () => admin },
    '@/lib/agrimarket/dispatch': { offerAgrimarketDriver: () => { if (options.dispatchResult) return options.dispatchResult; throw Error('Unexpected driver offer'); } },
    '@/lib/agrimarket/dispatchWait': { dispatchWaitCode: result => result.error === 'NO_DRIVER_WITHIN_AGRIMARKET_APPROACH_LIMIT' ? 'outside_pickup_range' : result.error === 'ROAD_DISTANCE_UNAVAILABLE' ? 'route_unavailable' : null },
    '@/app/api/agrimarket/_lib/server': { agrimarketEnabled: () => options.enabled !== false },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, { module, exports: module.exports, Date,
    process: { env: { CRON_SECRET: options.noSecret ? '' : 'TEST_SECRET' } },
    require: name => { assert(Object.hasOwn(mocks, name), name); return mocks[name]; } });
  return { calls, GET: module.exports.GET,
    req: token => ({ headers: new Headers(token ? { authorization: token } : {}) }) };
}
let passed = 0;
async function test(label, run) { await run(); console.log('PASS ' + label); passed++; }
(async () => {
  await test('missing, invalid and unconfigured cron credentials fail before all database calls', async () => {
    for (const [options,token] of [[{},null],[{},'Bearer wrong'],[{noSecret:true},'Bearer TEST_SECRET']]) {
      const h=harness(options);assert.equal((await h.GET(h.req(token))).status,401);assert.equal(h.calls.length,0);
    }
  });
  await test('disabled AgriMarket preserves existing cron behavior with no database calls', async () => {
    const h=harness({enabled:false});const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.status,200);assert.equal(r.body.enabled,false);assert.equal(h.calls.length,0);
  });
  await test('producer expiry runs before reapproval, settlement and driver dispatch', async () => {
    const h=harness();const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.status,200);assert.equal(h.calls[0].name,'agrimarket_expire_pending_orders_v1');
    assert.equal(h.calls[0].args.p_limit,200);assert(Number.isFinite(Date.parse(h.calls[0].args.p_now)));
    assert.equal(h.calls[1].name,'agrimarket_expire_customer_reapproval_v1');assert.equal(r.body.expired_producer_orders,0);
  });
  await test('expiry failure is explicit, leaks no DB detail and stops subsequent work', async () => {
    const h=harness({error:'agrimarket_expire_pending_orders_v1'});const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.status,503);assert.equal(r.body.error,'AGRIMARKET_PRODUCER_TIMEOUT_SWEEP_FAILED');
    assert.equal(h.calls.length,1);assert(!JSON.stringify(r).includes('SECRET'));
  });
  await test('successful response reports actual processed row count without exposing tickets', async () => {
    const h=harness({expired:[{order_id:'PRIVATE_ID'},{order_id:'PRIVATE_OTHER'}]});const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.status,200);assert.equal(r.body.expired_producer_orders,2);assert(!JSON.stringify(r).includes('PRIVATE'));
  });
  await test('reapproval failure stays distinct and cannot silently continue', async () => {
    const h=harness({error:'agrimarket_expire_customer_reapproval_v1'});const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.status,503);assert.equal(r.body.error,'AGRIMARKET_TIMEOUT_SWEEP_FAILED');assert.equal(h.calls.length,2);
  });
  await test('no nearby driver result is recorded for the selected vehicle and counted', async () => {
    const h=harness({pendingRows:[{id:'order-1',order_code:'AG-TEST',status:'ready_for_dispatch',ready_at:'2026-09-25T18:00:00Z',preferred_vehicle_type:'tricycle'}],dispatchResult:{ok:true,offered:false,error:'NO_DRIVER_WITHIN_AGRIMARKET_APPROACH_LIMIT'}});
    const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.body.no_driver_available,1);assert.equal(r.body.routing_unavailable,0);
    const diagnostic=h.calls.find(c=>c.payload?.dispatch_wait_code==='outside_pickup_range');
    assert.equal(diagnostic.name,'agrimarket_orders');assert.equal(diagnostic.payload.dispatch_wait_vehicle_type,'tricycle');
  });
  await test('route failure stays separate from unavailable drivers', async () => {
    const h=harness({pendingRows:[{id:'order-1',order_code:'AG-TEST',status:'ready_for_dispatch',ready_at:'2026-09-25T18:00:00Z',preferred_vehicle_type:'tricycle'}],dispatchResult:{ok:true,offered:false,error:'ROAD_DISTANCE_UNAVAILABLE'}});
    const r=await h.GET(h.req('Bearer TEST_SECRET'));
    assert.equal(r.body.no_driver_available,0);assert.equal(r.body.routing_unavailable,1);
    assert(h.calls.some(c=>c.payload?.dispatch_wait_code==='route_unavailable'));
  });
  await test('scheduler uses bounded existing RPC independently of farmer-screen polling', () => {
    const m=fs.readFileSync(path.join(root,'supabase/migrations/20260922200115_agrimarket_producer_confirmation_expiry_schedule_v1.sql'),'utf8');
    assert(m.includes("'10 seconds'"));assert(m.includes("SET statement_timeout='15s'"));
    assert(m.includes('agrimarket_expire_pending_orders_v1(clock_timestamp(),200)'));
    assert(m.includes('Expiry function changed'));assert(m.includes('do not duplicate'));
    assert(!/delete\s+from|update\s+public|disable\s+trigger|grant\s+.*authenticated/i.test(m));
  });
  console.log('AgriMarket producer expiry: '+passed+' test groups passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
