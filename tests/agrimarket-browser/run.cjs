const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function load(file, mocks = {}, env = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const resolve = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks, env);
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts', mocks, env);
    return require(name);
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: resolve, process: { env },
    Buffer, URL, Headers, Date, console, setTimeout, clearTimeout, AbortSignal }, { filename });
  return module.exports;
}
const validSub = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-only', keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'A'.repeat(22) } };
const owner = '7219cecb-073f-42db-b9d9-8a4e23c0c79a';
function harness({ allowed = true, config = { public_key: 'PUBLIC', private_key: 'NEVER_EXPOSE' }, rpcError = false } = {}) {
  const calls = [];
  const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { id: 'subscription-id', active: true }, error: rpcError ? Error('db internal secret') : null }; },
    from(name) { calls.push({ name }); const q = { select() { return q; }, eq(column, value) { calls.push({ column, value }); return q; }, gt() { return q; }, order() { return q; },
      limit: async () => ({ data: [], error: null }) }; return q; } };
  const mocks = { '../../_lib/server': { requireAgrimarketProducer: async () => allowed ? { ok: true, producer: { id: owner } }
    : { ok: false, response: { status: 401 } }, createServiceSupabase: () => db,
    jsonNoStore: (status, body) => ({ status, body }), agrimarketFarmerPortalEnabled: () => true },
    '@/lib/agrimarket/browserPushServer': { browserPushConfig: async () => config } };
  const api = load('app/api/agrimarket/producer/alerts/route.ts', mocks);
  const req = (body = {}, origin = 'https://app.jride.net') => ({ nextUrl: new URL('https://app.jride.net/api/agrimarket/producer/alerts'),
    headers: new Headers({ origin }), text: async () => JSON.stringify(body) });
  return { api, req, calls };
}
async function run() {
  const rules = load('lib/agrimarket/browserAlerts.ts');
  await test('expired and invalid orders never enter the sound queue; deadline is not extended', () => {
    const rows = [{ order_code: 'AG-TEST', producer_confirm_expires_at: new Date(2000).toISOString() },
      { order_code: 'bad', producer_confirm_expires_at: new Date(8000).toISOString() }];
    assert.equal(rules.pendingFarmerOrders(rows, 1000).length, 1);
    assert.equal(rules.pendingFarmerOrders(rows, 2000).length, 0);
    assert.equal(rules.alertSendTtl(new Date(2000).toISOString(), 2000), 0);
    assert.equal(rules.alertSendTtl('invalid'), 0);
  });
  await test('push destination allowlist rejects private hosts, credentials, HTTP and lookalike domains', () => {
    for (const endpoint of ['https://localhost/x','http://fcm.googleapis.com/x','https://fcm.googleapis.com.evil.test/x',
      'https://user:secret@fcm.googleapis.com/x','https://127.0.0.1/x','https://fcm.googleapis.com:444/x',
      'https://fcm.googleapis.com/x#fragment','https://169.254.169.254/latest/meta-data/']) assert.equal(rules.validPushEndpoint(endpoint), false, endpoint);
    for (const endpoint of [validSub.endpoint,'https://web.push.apple.com/QTEST','https://updates.push.services.mozilla.com/wpush/v2/test']) assert.equal(rules.validPushEndpoint(endpoint), true);
    assert.equal(rules.validPushKeys(validSub.keys), true);
    assert.equal(rules.validPushKeys({ p256dh: 'bad', auth: 'bad' }), false);
  });
  await test('unauthenticated feed and mutations cannot touch subscriptions or orders', async () => {
    const h = harness({ allowed: false });
    assert.equal((await h.api.GET(h.req())).status, 401);
    assert.equal((await h.api.POST(h.req({ action: 'subscribe', subscription: validSub }))).status, 401);
    assert.equal(h.calls.length, 0);
  });
  await test('cross-origin mutation fails before any database call', async () => {
    const h = harness(); assert.equal((await h.api.POST(h.req({}, 'https://evil.test'))).status, 403); assert.equal(h.calls.length, 0);
  });
  await test('subscribe ignores spoofed producer identity and uses authenticated farm', async () => {
    const h = harness(); const response = await h.api.POST(h.req({ action: 'subscribe', producer_id: 'another-farm', subscription: validSub }));
    assert.equal(response.status, 200); assert.equal(h.calls[0].args.p_producer_id, owner);
  });
  await test('invalid subscriptions and disabled configuration fail closed', async () => {
    let h = harness(); assert.equal((await h.api.POST(h.req({ action: 'subscribe', subscription: { ...validSub, endpoint: 'http://localhost/' } }))).status, 400); assert.equal(h.calls.length, 0);
    h = harness({ config: null }); assert.equal((await h.api.POST(h.req({ action: 'subscribe', subscription: validSub }))).status, 503); assert.equal(h.calls.length, 0);
  });
  await test('feed exposes public key only and filters orders by authenticated farm', async () => {
    const h = harness(); const response = await h.api.GET(h.req()); assert.equal(response.status, 200);
    assert.equal(response.body.public_key, 'PUBLIC'); assert(!JSON.stringify(response).includes('NEVER_EXPOSE'));
    assert(h.calls.some(c => c.column === 'producer_id' && c.value === owner));
  });
  await test('test action is subscription-scoped and cannot create orders', async () => {
    const h = harness(); const response = await h.api.POST(h.req({ action: 'test', subscription_id: owner, producer_id: 'other' }));
    assert.equal(response.status, 200); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].name, 'agrimarket_browser_action_v1');
    assert.equal(h.calls[0].args.p_producer_id, owner);
  });
  await test('database errors do not leak secrets', async () => {
    const h = harness({ rpcError: true }); const response = await h.api.POST(h.req({ action: 'subscribe', subscription: validSub }));
    assert.equal(response.status, 409); assert(!JSON.stringify(response).includes('db internal secret'));
  });
  await test('worker validates immediately before send; TTL bounded and invalid destinations expire', async () => {
    for (const scenario of ['ok', 'stale', 'invalid', 'gone']) {
      const calls = [], pushes = [];
      const db = { rpc: async (name, args) => { calls.push({ name, args });
        if (name.includes('config')) return { data: { enabled: true, public_key: 'pub', private_key: 'private' } };
        if (name.includes('claim')) return { data: [{ id: owner, lease_id: owner }] };
        if (name.includes('validate')) return { data: scenario === 'stale' ? null : { endpoint: scenario === 'invalid' ? 'https://localhost/x' : validSub.endpoint,
          keys: validSub.keys, expires_at: new Date(Date.now() + 150000).toISOString(), kind: 'order', order_code: 'AG-TEST' } };
        return { data: null }; } };
      const worker = load('lib/agrimarket/browserPushServer.ts', { 'web-push': { sendNotification: async (...args) => {
        pushes.push(args); if (scenario === 'gone') throw { statusCode: 410, body: 'sensitive-endpoint' };
      } } });
      await worker.sendFarmerBrowserAlerts(db, owner);
      assert.equal(calls[1].args.p_producer_id, owner);
      assert.equal(pushes.length, ['ok', 'gone'].includes(scenario) ? 1 : 0);
      if (scenario === 'ok') { assert(pushes[0][2].TTL <= 150); assert(!pushes[0][1].includes('private')); }
      assert.equal(calls.at(-1).args.p_result, { ok: 'SENT', stale: 'STALE', invalid: 'INVALID_SUBSCRIPTION', gone: 'SUBSCRIPTION_GONE' }[scenario]);
    }
  });
  await test('cron fails closed without a configured secret', async () => {
    for (const env of [{}, { CRON_SECRET: 'correct' }]) {
      let called = false;
      const api = load('app/api/cron/agrimarket-browser-alerts/route.ts', {
        '@/app/api/agrimarket/_lib/server': { jsonNoStore: (status, body) => ({ status, body }), agrimarketFarmerPortalEnabled: () => true, createServiceSupabase: () => { called = true; } },
        '@/lib/agrimarket/browserPushServer': { sendFarmerBrowserAlerts: async () => ({}) },
      }, env);
      assert.equal((await api.GET({ headers: new Headers({ authorization: 'Bearer wrong' }) })).status, 401); assert.equal(called, false);
    }
  });
  await test('service worker handles only AgriMarket and drops expired pushes', async () => {
    const events = {}, shown = [], opened = [];
    const self = { addEventListener: (name, fn) => { events[name] = fn; }, location: { origin: 'https://app.jride.net' },
      clients: { matchAll: async () => [], openWindow: async url => opened.push(url) }, registration: { showNotification: async (...args) => shown.push(args) } };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'public/agrimarket-alerts-sw.js'), 'utf8'), { self, URL, Date });
    for (const data of [{ type: 'takeout', kind: 'order' }, { type: 'jride-agrimarket', kind: 'order', expires_at: '2000-01-01' }]) {
      let pending; events.push({ data: { json: () => data }, waitUntil: promise => { pending = promise; } }); await pending;
    }
    assert.equal(shown.length, 0);
    let pending; events.push({ data: { json: () => ({ type: 'jride-agrimarket', kind: 'test', expires_at: new Date(Date.now()+60000).toISOString() }) }, waitUntil: promise => { pending = promise; } }); await pending;
    assert.equal(shown.length, 1); assert.equal(shown[0][0], 'AgriMarket alert test');
    events.notificationclick({ notification: { data: { url: 'https://evil.test', order_code: 'https://evil.test' }, close() {} }, waitUntil: promise => { pending = promise; } }); await pending;
    assert.equal(opened[0], 'https://app.jride.net/agrimarket/producer');
    assert(!events.fetch, 'must not intercept or cache other services');
  });
  await test('AgriMarket UI is isolated; no auto registration on login or polling', () => {
    const ui = fs.readFileSync(path.join(root,'app/agrimarket/producer/FarmerOrderAlerts.tsx'),'utf8');
    assert.equal((ui.match(/serviceWorker\.register\(/g)||[]).length, 1);
    assert(ui.indexOf('serviceWorker.register(') > ui.indexOf('async function enablePush()'));
    assert(!ui.includes('setItem("JRIDE_AGRIMARKET_ACCESS_PIN"'));
    assert(ui.includes('AGRI_ALERT_STALE_MS')); assert(ui.includes('navigator.locks.request'));
    assert(!ui.includes('/api/vendor-push')); assert(!ui.includes('AGRIMARKET_PHONE_APPROVAL'));
  });
  console.log(`${passed} AgriMarket browser alert test groups passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
