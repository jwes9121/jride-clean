const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
let transpile;
try {
  const ts = require('typescript');
  transpile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ESNext } }).outputText;
} catch { transpile = require('node:module').stripTypeScriptTypes; }
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app/api/driver/agrimarket/vehicle/route.ts'), 'utf8');
const code = transpile(source).replace(/^import .*;\s*$/gm, '').replace(/export /g, '') + '\nexports.GET = GET; exports.POST = POST;';
const driver = '00000000-0000-4000-8000-000000000001';
let count = 0;
function fixture(options = {}) {
  const state = { vehicle: options.vehicle === undefined ? 'motorcycle' : options.vehicle, writes: [], reads: [] };
  const identity = options.identity || { ok: true, driverId: driver, authMode: 'device' };
  function query(table) {
    const filters = []; let mutation = null;
    const q = {
      select() { return q; }, eq(...v) { filters.push(['eq', ...v]); return q; },
      is(...v) { filters.push(['is', ...v]); return q; },
      or(v) { filters.push(['or', v]); return q; },
      in(...v) { filters.push(['in', ...v]); return q; }, gt(...v) { filters.push(['gt', ...v]); return q; },
      limit() { return q; }, update(v) { mutation = v; return q; },
      maybeSingle() { return q; },
      then(resolve, reject) { return Promise.resolve().then(() => {
        state.reads.push({ table, filters });
        if (options.errorTable === table) return { data: null, error: new Error('failure') };
        if (table === 'driver_profiles') {
          if (mutation) {
            state.writes.push({ filters, mutation });
            if (options.conflict) return { data: null, error: null };
            assert(filters.some(f => f[1] === 'driver_id' && f[2] === driver));
            assert(filters.some(f => f[1] === 'vehicle_type' && f[2] === state.vehicle));
            state.vehicle = mutation.vehicle_type;
          }
          return { data: options.missing ? null : { vehicle_type: state.vehicle }, error: null };
        }
        if (table === 'driver_locations') return { data: options.locations || [{ status: 'offline' }], error: null };
        return { data: options.busyTable === table ? [{ id: 'busy' }] : [], error: null };
      }).then(resolve, reject); },
    }; return q;
  }
  const exports = {};
  vm.runInNewContext(code, {
    exports, URL, Date, Promise,
    supabaseAdmin: config => { assert.equal(config.noStore, true); return { from: query }; },
    resolveDriverRequest: async (_req, explicit, policy) => {
      assert.equal(policy.requireBearer, true);
      if (explicit && explicit !== driver) return { ok: false, status: 403, error: 'DRIVER_IDENTITY_MISMATCH' };
      return identity;
    },
    jsonNoStore: (status, body) => ({ status, body }),
  });
  const req = body => new Request('https://preview.example/api/driver/agrimarket/vehicle?driver_id=' + driver,
    body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  return { state, get: () => exports.GET(req()), post: (extra = {}) => exports.POST(req({ driver_id: driver, vehicle_type: 'kolong_kolong', expected_vehicle_type: state.vehicle, ...extra })), malformed: () => exports.POST({ json: async () => { throw Error('bad JSON'); } }) };
}
async function check(name, fn) { await fn(); count++; console.log('PASS ' + name); }
(async () => {
  await check('Kolong-Kolong saves canonically and is returned after reopening', async () => {
    const f = fixture(); assert.equal((await f.post()).status, 200);
    const read = await f.get(); assert.equal(read.body.vehicle_type, 'kolong_kolong');
    assert.deepEqual(Array.from(read.body.choices), ['motorcycle','tricycle','kolong_kolong']);
    assert.equal(read.body.driver_id, driver);
  });
  for (const vehicle of ['motorcycle','tricycle']) await check(vehicle + ' remains selectable', async () => {
    const f = fixture({ vehicle: 'kolong_kolong' }); assert.equal((await f.post({ vehicle_type: vehicle })).body.vehicle_type, vehicle);
  });
  await check('null and legacy profile values can be changed without losing the concurrency guard', async () => {
    for (const vehicle of [null, 'Kulong Kulong']) assert.equal((await fixture({ vehicle }).post()).status, 200);
  });
  await check('mismatched driver cannot read or save another profile', async () => {
    const f = fixture(); assert.equal((await f.post({ driver_id: 'different' })).status, 403); assert.equal(f.state.writes.length, 0);
  });
  for (const error of ['NOT_AUTHED','DRIVER_DEVICE_PENDING','DRIVER_DEVICE_REVOKED','DRIVER_AUTH_UNAVAILABLE']) {
    await check(error + ' prevents all profile access', async () => {
      const f = fixture({ identity: { ok: false, status: error === 'NOT_AUTHED' ? 401 : 403, error } });
      assert.notEqual((await f.get()).status, 200); assert.notEqual((await f.post()).status, 200); assert.equal(f.state.reads.length, 0);
    });
  }
  await check('unsupported vehicle and missing previous value are rejected', async () => {
    const f = fixture(); for (const vehicle_type of ['truck', 'Kolong-Kolong', null, {}]) assert.equal((await f.post({ vehicle_type })).status, 400);
    assert.equal((await f.post({ expected_vehicle_type: undefined })).status, 400); assert.equal(f.state.reads.length, 0);
  });
  await check('online, walk-in, unknown, and mixed location statuses prevent changing vehicles', async () => {
    for (const status of ['online','walkin','busy','',null]) {
      const f = fixture({ locations: [{ status: 'offline' }, { status }] });
      assert.equal((await f.post()).body.error, 'DRIVER_MUST_BE_OFFLINE'); assert.equal(f.state.writes.length, 0);
    }
  });
  for (const busyTable of ['bookings','agrimarket_orders','agrimarket_driver_offers']) await check(busyTable + ' blocks changes during work', async () => {
    const f = fixture({ busyTable }); assert.equal((await f.post()).body.error, 'DRIVER_HAS_ACTIVE_JOB'); assert.equal(f.state.writes.length, 0);
  });
  for (const errorTable of ['driver_locations','bookings','agrimarket_orders','agrimarket_driver_offers','driver_profiles']) await check(errorTable + ' failure never reports a successful save', async () => {
    assert.equal((await fixture({ errorTable }).post()).status, 503);
  });
  await check('concurrent profile change requires refresh rather than overwriting', async () => {
    assert.equal((await fixture({ conflict: true }).post()).body.error, 'DRIVER_VEHICLE_CHANGED');
  });
  await check('missing profile and malformed JSON return controlled responses', async () => {
    assert.equal((await fixture({ missing: true }).get()).status, 404);
    assert.equal((await fixture().malformed()).status, 400);
  });
  console.log(`${count} driver vehicle checks passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
