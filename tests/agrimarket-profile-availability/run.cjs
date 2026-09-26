// API/UI regression coverage. Migration also runs ten actual SQL rollback cases.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const origin = 'https://app.jride.net';
const route = 'app/api/agrimarket/producer/profile/route.ts';
const page = 'app/agrimarket/producer/profile/page.tsx';
const migration = 'supabase/migrations/20260922124201_agrimarket_profile_preserve_approved_availability_v1.sql';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function harness(options = {}) {
  const calls = [];
  const row = {
    id: 'authenticated-farmer', contact_name: 'Test Farmer', contact_phone: '09991234567',
    town: 'Lamut', barangay: 'Pugol', vendor_name: 'Test farm',
    pickup_label: 'Verified test pickup', pickup_lat: 16.65, pickup_lng: 121.22,
    pickup_motorcycle_accessible: true, pickup_tricycle_accessible: true,
    pickup_roadside_handoff_required: false, pickup_driver_directions: 'Meet beside the barangay hall.',
    accepting_orders: options.ready === true, store_open: options.open === true, status: 'active',
  };
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { data: [{ application_id: 'test-application', accepting_orders: options.rpcReady ?? row.accepting_orders }],
        error: options.rpcError ? { message: options.rpcError } : null };
    },
    from: table => {
      calls.push({ table });
      const q = { select() { return q; }, eq(column, value) { calls.push({ column, value }); return q; }, limit() { return q; },
        maybeSingle: async () => options.readError ? { error: { message: 'test read failure' }, data: null } : { error: null, data: row } };
      return q;
    },
  };
  const mocks = {
    '../../_lib/server': {
      agrimarketFarmerPortalEnabled: () => true,
      agrimarketFarmerPortalDisabledResponse: () => ({ status: 503 }),
      requireAgrimarketProducer: async () => options.denied ? { ok: false, response: { status: 401 } }
        : { ok: true, accessCode: 'AGF-TESTONLY', producer: { id: row.id, town: row.town } },
      createServiceSupabase: () => db,
      jsonNoStore: (status, body) => ({ status, body }),
    },
    '../../_lib/admin-farmer-location': { reverseGeocodeFarmerPin: async () => {
      calls.push({ geocode: true }); return { launch_eligible: true, town: options.pinTown || 'Lamut', label: row.pickup_label };
    } },
    '@/lib/agrimarket/farmer-towns': {
      isAgrimarketActiveTown: value => ['Lagawe','Hingyon','Banaue','Lamut'].includes(value),
      canonicalAgrimarketBarangay: (town,value) => town === 'Lamut' && value === 'Pugol' ? value : null,
    },
    '@/lib/agrimarket/farmer-profile-validation': {
      driverDirectionsError: ({ directions }) => String(directions || '').trim().length >= 8 ? null : 'Add clearer driver directions.',
    },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(read(route), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, reportDiagnostics: true });
  assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: name => name in mocks ? mocks[name] : require(name), Date, Number, String, JSON, console }, { filename: route });
  const req = (extra = {}, requestOrigin = origin) => ({ nextUrl: new URL(origin + '/api/agrimarket/producer/profile'),
    headers: new Headers({ origin: requestOrigin }), text: async () => JSON.stringify({ ...row, ...extra }) });
  return { api: module.exports, req, calls, row };
}
async function run() {
  await test('approved open store reports preserved availability after save', async () => {
    const h = harness({ ready: true, open: true }); const r = await h.api.POST(h.req());
    assert.equal(r.status, 200); assert.equal(r.body.readiness_review_pending, false);
    assert.equal(r.body.profile.accepting_orders, true); assert.equal(r.body.profile.store_open, true);
    assert.match(r.body.message, /remains open/); assert(!r.body.message.includes('orders are paused'));
  });
  await test('approved closed store stays closed without requesting reapproval', async () => {
    const h = harness({ ready: true, open: false }); const r = await h.api.POST(h.req());
    assert.equal(r.status, 200); assert.equal(r.body.readiness_review_pending, false); assert.equal(r.body.profile.store_open, false);
    assert.match(r.body.message, /remains closed/);
  });
  await test('pending store remains blocked and receives accurate explanation', async () => {
    const h = harness({ ready: false, open: false }); const r = await h.api.POST(h.req());
    assert.equal(r.status, 200); assert.equal(r.body.readiness_review_pending, true);
    assert.match(r.body.message, /JRide will review your pickup and products/); assert.match(r.body.message, /receive new orders/);
  });
  await test('latest database readback wins over an earlier RPC readiness value', async () => {
    const h = harness({ ready: false, open: false, rpcReady: true }); const r = await h.api.POST(h.req());
    assert.equal(r.body.readiness_review_pending, true); assert.equal(r.body.profile.accepting_orders, false);
  });
  await test('caller cannot choose another farmer or set approval flags', async () => {
    const h = harness({ ready: false }); await h.api.POST(h.req({ producer_id: 'other', id: 'other', accepting_orders: true, store_open: true }));
    const call = h.calls.find(c => c.name); assert.equal(call.name, 'agrimarket_farmer_save_profile_v4'); assert.equal(call.args.p_producer_id, 'authenticated-farmer'); assert.equal(call.args.p_town, 'Lamut');
    assert.equal(call.args.p_actor, 'AGF-TESTONLY');
    assert(!Object.hasOwn(call.args, 'accepting_orders')); assert(!Object.hasOwn(call.args, 'store_open'));
    assert.equal(call.args.p_phone_normalized, '+639991234567');
  });
  await test('unauthenticated and cross-origin saves do not reach the database', async () => {
    let h = harness({ denied: true }); assert.equal((await h.api.POST(h.req())).status, 401); assert.equal(h.calls.length, 0);
    h = harness(); assert.equal((await h.api.POST(h.req({}, 'https://other.test'))).status, 403); assert.equal(h.calls.length, 0);
  });
  await test('out-of-town pin is still rejected before the save RPC', async () => {
    const h = harness({ pinTown: 'Hingyon' }); assert.equal((await h.api.POST(h.req())).status, 422);
    assert(!h.calls.some(c => c.name));
  });
  await test('save error and readback failure never report success', async () => {
    let h = harness({ rpcError: 'check constraint failure' }); assert.equal((await h.api.POST(h.req())).status, 409);
    h = harness({ readError: true }); const r = await h.api.POST(h.req()); assert.equal(r.status, 503); assert.equal(r.body.ok, false);
  });
  await test('GET reports the same persisted operating state as POST', async () => {
    for (const ready of [true, false]) for (const open of [true, false]) {
      const h = harness({ ready, open }); const r = await h.api.GET(h.req()); assert.equal(r.status, 200);
      assert.equal(r.body.profile.accepting_orders, ready); assert.equal(r.body.profile.store_open, open);
    }
  });
  await test('migration matches live verified function and cannot self-approve or auto-open', () => {
    const sql = read(migration); const body = sql.match(/AS \$function\$([\s\S]*?)\$function\$;/)[1];
    assert.equal(crypto.createHash('md5').update(body).digest('hex'), 'ce2c41b4671fb13a0b7ae6ea0cea7e03');
    assert(body.includes('v_next_ready := coalesce(v_producer.accepting_orders,false) and cardinality(v_review_fields)=0;'));
    assert(body.includes('v_next_open := v_next_ready and coalesce(v_producer.store_open,false);'));
    for (const field of ['contact_name','contact_phone','barangay','pickup_lat','pickup_lng','pickup_motorcycle_accessible','pickup_tricycle_accessible','pickup_roadside_handoff_required']) assert(body.includes("then '" + field + "' end"));
    assert(sql.includes('FOR v_case IN 1..10 LOOP')); assert(sql.includes('Regression fixture was not fully rolled back'));
    assert(!/ALTER TABLE|DROP CONSTRAINT|DISABLE TRIGGER|SECURITY DEFINER/i.test(sql));
  });
  await test('UI warns about review-sensitive changes before Save and retains map authentication', () => {
    const source = read(page); assert(source.includes('Review required:'));
    assert(source.indexOf('Review required:') < source.indexOf('type="submit"'));
    assert(source.includes('keeps your approval and current Open / Closed setting'));
    assert(source.includes('will close the store and pause new orders'));
    assert(source.includes('farmerCode={sessionCode}')); assert(source.includes('agrimarket-store-updated'));
    const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
    assert.equal((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  });
  await test('new source is ASCII and regression suite is wired into prebuild', () => {
    for (const file of [route, page, migration, 'tests/agrimarket-profile-availability/run.cjs']) assert(!/[^\x00-\x7F]/.test(read(file)), file);
    const pkg = JSON.parse(read('package.json')); assert(pkg.scripts.prebuild.includes('node tests/agrimarket-profile-availability/run.cjs'));
  });
  console.log('AgriMarket profile availability: ' + passed + ' test groups passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
