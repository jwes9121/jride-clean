const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function load(file, mocks = {}, env = {}, globals = {}) {
  const filename = path.join(root, file);
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const resolve = name => {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks, env, globals);
    if (name.startsWith('.')) return load(path.posix.join(path.posix.dirname(file), name) + '.ts', mocks, env, globals);
    return require(name);
  };
  vm.runInNewContext(source, { module, exports: module.exports, require: resolve, process: { env },
    Buffer, URL, Headers, Date, console, setTimeout, clearTimeout, AbortSignal, atob, Uint8Array, ...globals }, { filename });
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
  const phone = load('lib/agrimarket/browserAlertDevice.ts');
  const origin = 'https://app.jride.net';
  const device = (registration, permission = 'granted') => ({ origin, secure: true, permission,
    workers: { getRegistration: async () => registration } });
  const farmerWorker = () => ({ scope: origin + rules.AGRI_ALERT_SCOPE,
    active: { scriptURL: origin + rules.AGRI_ALERT_WORKER },
    pushManager: { getSubscription: async () => validSub }, showNotification: async () => {} });
  await test('phone check distinguishes missing permission, worker and subscription without mutating them', async () => {
    const missing = await phone.inspectAlertDevice(device(undefined, 'default'));
    assert.equal(missing.permission, 'default'); assert.equal(missing.worker, 'missing');
    const worker = farmerWorker(); worker.pushManager.getSubscription = async () => null;
    const noSub = await phone.inspectAlertDevice(device(worker));
    assert.equal(noSub.worker, 'ready'); assert.equal(noSub.subscription, 'missing');
  });
  await test('phone check never reads or modifies the Takeout worker subscription', async () => {
    const rootWorker = farmerWorker(); rootWorker.scope = origin + '/'; rootWorker.active.scriptURL = origin + '/sw.js';
    rootWorker.pushManager.getSubscription = async () => { throw new Error('must not read root subscription'); };
    const state = await phone.inspectAlertDevice(device(rootWorker));
    assert.equal(state.worker, 'different'); assert.equal(state.subscription, 'unknown');
    await assert.rejects(phone.testPhoneNotification(device(rootWorker)), /FARMER_WORKER_REQUIRED/);
  });
  await test('phone diagnostics report browser-read errors as unknown rather than disabled', async () => {
    const unavailable = device(undefined); unavailable.workers.getRegistration = async () => { throw new Error('blocked'); };
    assert.equal((await phone.inspectAlertDevice(unavailable)).worker, 'unavailable');
    const worker = farmerWorker(); worker.pushManager.getSubscription = async () => { throw new Error('unavailable'); };
    assert.equal((await phone.inspectAlertDevice(device(worker))).subscription, 'unavailable');
  });
  await test('phone readiness exposes no push endpoint or keys', async () => {
    const state = await phone.inspectAlertDevice(device(farmerWorker()));
    assert.equal(state.permission, 'granted'); assert.equal(state.worker, 'ready'); assert.equal(state.subscription, 'present');
    assert(!JSON.stringify(state).includes('fcm.googleapis.com')); assert(!JSON.stringify(state).includes('p256dh'));
  });
  await test('immediate phone test requires existing permission and cannot create an order or subscription', async () => {
    const worker = farmerWorker(); const shown = [];
    worker.showNotification = async (...args) => shown.push(args);
    await assert.rejects(phone.testPhoneNotification(device(worker, 'default')), /PHONE_PERMISSION_REQUIRED/);
    await assert.rejects(phone.testPhoneNotification(device(worker, 'denied')), /PHONE_PERMISSION_REQUIRED/);
    assert.equal(shown.length, 0);
    await phone.testPhoneNotification(device(worker));
    assert.equal(shown.length, 1); assert.equal(shown[0][0], 'AgriMarket phone test');
    assert.equal(shown[0][1].tag, 'agrimarket-phone-test');
  });
  await test('rejected phone notification display propagates failure without a false success', async () => {
    const worker = farmerWorker(); worker.showNotification = async () => { throw new Error('display denied'); };
    await assert.rejects(phone.testPhoneNotification(device(worker)), /display denied/);
  });
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
    assert(ui.includes('flight.current || authStopped.current'));
    assert(ui.includes('authStopped.current = true;'));
    assert(ui.includes('AGRI_ALERT_STALE_MS')); assert(ui.includes('navigator.locks.request'));
    assert(!ui.includes('/api/vendor-push')); assert(!ui.includes('AGRIMARKET_PHONE_APPROVAL'));
  });
  const registrationRules = load('lib/agrimarket/browserPushRegistration.ts');
  const publicKey = Buffer.from([1,2,3]).toString('base64url');
  function pushHarness(keepDead = false) {
    const events = []; const worker = farmerWorker();
    const fresh = { endpoint: 'fresh', options: {applicationServerKey: new Uint8Array([1,2,3]).buffer} };
    let sub = { endpoint: 'dead', options: fresh.options, unsubscribe: async () => { events.push('unsubscribe'); if (!keepDead) sub = null; return true; } };
    worker.pushManager = { getSubscription: async () => sub,
      subscribe: async () => { events.push('subscribe'); return fresh; } };
    return { worker, events };
  }
  await test('expired push endpoint is removed before requesting a fresh subscription', async () => {
    const h = pushHarness();
    assert.equal((await registrationRules.farmerPushSubscription(h.worker, origin, publicKey, true)).endpoint, 'fresh');
    assert.deepEqual(h.events, ['unsubscribe','subscribe']);
  });
  await test('valid push endpoint is preserved and root Takeout worker is never changed', async () => {
    const h = pushHarness();
    assert.equal((await registrationRules.farmerPushSubscription(h.worker, origin, publicKey, false)).endpoint, 'dead');
    assert.deepEqual(h.events, []);
    h.worker.scope = origin + '/';
    await assert.rejects(registrationRules.farmerPushSubscription(h.worker, origin, publicKey, true), /not ready/);
    assert.deepEqual(h.events, []);
  });
  await test('failed push removal cannot be reported as repaired', async () => {
    const h = pushHarness(true);
    await assert.rejects(registrationRules.farmerPushSubscription(h.worker, origin, publicKey, true), /could not be repaired/);
    assert.deepEqual(h.events, ['unsubscribe']);
  });
  await test('push key rotation replaces an incompatible subscription', async () => {
    const h = pushHarness();
    await registrationRules.farmerPushSubscription(h.worker, origin, Buffer.from([4,5,6]).toString('base64url'), false);
    assert.deepEqual(h.events, ['unsubscribe','subscribe']);
  });
  const sessions = load('lib/agrimarket/farmerSessionServer.ts');
  const token = 'a'.repeat(64);
  function sessionReq(method = 'GET', code = '', originValue = origin) {
    return { method, nextUrl: new URL(origin + '/api/agrimarket/producer/session'),
      cookies: { get: name => name === sessions.FARMER_SESSION_COOKIE ? {value:token} : undefined },
      headers: new Headers({ origin:originValue, 'x-jride-agrimarket-session':'1', 'x-jride-agrimarket-code':code }) };
  }
  await test('persistent farmer cookie is opaque, HttpOnly, secure and scoped to farmer APIs', () => {
    const issued = sessions.newFarmerSessionToken(); assert.match(issued, /^[a-f0-9]{64}$/); assert.notEqual(issued, sessions.newFarmerSessionToken());
    const settings = []; sessions.setFarmerSessionCookie({cookies:{set:(...args)=>settings.push(args)}}, issued);
    const [name,value,options] = settings[0]; assert.equal(name,sessions.FARMER_SESSION_COOKIE); assert.equal(value,issued);
    assert.equal(options.httpOnly,true); assert.equal(options.secure,true); assert.equal(options.sameSite,'strict');
    assert.equal(options.path,'/api/agrimarket/producer'); assert.equal(options.maxAge,2592000);
    assert.notEqual(sessions.farmerSessionHash(issued),issued);
  });
  await test('cookie authentication rejects cross-origin requests and changed farm tabs', async () => {
    const db={rpc:async()=>({data:{access_code:'AGF-FARM0001',producer:{id:owner}}})};
    assert.equal(sessions.farmerSessionRequestAllowed(sessionReq('POST','', 'https://evil.test')),false);
    const noOrigin=sessionReq('POST');noOrigin.headers.delete('origin');
    assert.equal(sessions.farmerSessionRequestAllowed(noOrigin),false);
    const noHeader=sessionReq();noHeader.headers.delete('x-jride-agrimarket-session');
    assert.equal(await sessions.readFarmerSession(noHeader,db),null);
    assert.equal(await sessions.readFarmerSession(sessionReq('GET','AGF-OTHER001'),db),null);
    assert.equal((await sessions.readFarmerSession(sessionReq('GET','AGF-FARM0001'),db)).producer.id,owner);
  });
  await test('cookie authentication reports unavailable database without treating it as invalid login', async () => {
    await assert.rejects(sessions.readFarmerSession(sessionReq(),{rpc:async()=>({error:Error('down')})}), /UNAVAILABLE/);
    assert.equal(await sessions.readFarmerSession(sessionReq(),{rpc:async()=>({data:null})}),null);
  });
  function clientHarness(responses, initial={}) {
    const values=new Map(Object.entries(initial)),calls=[];
    const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
    const client=load('lib/agrimarket/farmerSessionClient.ts',{}, {}, {sessionStorage:storage,localStorage:storage,
      fetch:async(url,options)=>{calls.push({url,...options});const result=responses.shift();if(result instanceof Error)throw result;
        return {ok:result.status===200,status:result.status,json:async()=>result.body};}});
    return {client,calls,values};
  }
  await test('a reopened browser restores via cookie without saved PIN or login POST', async () => {
    const h=clientHarness([{status:200,body:{ok:true,access_code:'AGF-FARM0001'}}]);
    assert.equal(await h.client.restoreFarmerSession(),'AGF-FARM0001');assert.equal(h.calls.length,1);assert.equal(h.calls[0].method,'GET');
    assert.equal(h.calls[0].credentials,'same-origin');assert.equal(h.values.has('JRIDE_AGRIMARKET_ACCESS_PIN'),false);
  });
  await test('an old signed-in tab upgrades once and removes its saved PIN', async () => {
    const h=clientHarness([{status:401,body:{}},{status:200,body:{ok:true,access_code:'AGF-FARM0001'}}],
      {JRIDE_AGRIMARKET_ACCESS_CODE:'AGF-FARM0001',JRIDE_AGRIMARKET_ACCESS_PIN:'123456'});
    assert.equal(await h.client.restoreFarmerSession(),'AGF-FARM0001');assert.equal(h.calls[1].method,'POST');
    assert.equal(h.values.has('JRIDE_AGRIMARKET_ACCESS_PIN'),false);
    assert(!('x-jride-agrimarket-pin' in h.client.farmerSessionHeaders('AGF-FARM0001',true)));
  });
  await test('failed old-PIN upgrade is not retried and outages do not resubmit PINs', async () => {
    const initial={JRIDE_AGRIMARKET_ACCESS_CODE:'AGF-FARM0001',JRIDE_AGRIMARKET_ACCESS_PIN:'123456'};
    const h=clientHarness([{status:401,body:{}},{status:401,body:{}},{status:401,body:{}}],initial);
    await assert.rejects(h.client.restoreFarmerSession());assert.equal(await h.client.restoreFarmerSession(),'');
    assert.equal(h.calls.filter(c=>c.method==='POST').length,1);
    const outage=clientHarness([{status:503,body:{}}],initial);await assert.rejects(outage.client.restoreFarmerSession());
    assert.equal(outage.calls.length,1);assert.equal(outage.values.get('JRIDE_AGRIMARKET_ACCESS_PIN'),'123456');
  });
  await test('sign-out waits for server revocation and clears only this farmer registration hint', async () => {
    const initial={'AGRI_PUSH_V1:AGF-FARM0001':'46b235e6-caca-4294-95e8-dab2cd30ccf1',takeout:'keep'};
    const h=clientHarness([{status:200,body:{ok:true}}],initial);await h.client.signOutFarmer('AGF-FARM0001');
    assert.equal(h.calls[0].method,'DELETE');assert(h.calls[0].url.includes('subscription_id='));
    assert.equal(h.values.get('takeout'),'keep');assert.equal(h.values.has('AGRI_PUSH_V1:AGF-FARM0001'),false);
    const failed=clientHarness([{status:503,body:{}}],initial);await assert.rejects(failed.client.signOutFarmer('AGF-FARM0001'));
    assert.equal(failed.values.get('AGRI_PUSH_V1:AGF-FARM0001'),initial['AGRI_PUSH_V1:AGF-FARM0001']);
  });
  function sessionApiHarness({result=null,error=null}={}) {
    const calls=[];
    const response=(status,body)=>({status,body,cookies:{set:(...args)=>calls.push({cookie:args})}});
    const db={rpc:async(name,args)=>{calls.push({name,args});return {data:result,error};}};
    const api=load('app/api/agrimarket/producer/session/route.ts',{'../../_lib/server':{
      createServiceSupabase:()=>db,jsonNoStore:response,agrimarketFarmerPortalEnabled:()=>true}});
    const req=(method,body={},site=origin)=>({...sessionReq(method,'',site),text:async()=>JSON.stringify(body)});
    return {api,req,calls};
  }
  await test('session login issues a cookie after verification and returns no token or PIN in JSON', async()=>{
    const h=sessionApiHarness({result:{access_code:'AGF-FARM0001'}});
    const response=await h.api.POST(h.req('POST',{access_code:'AGF-FARM0001',pin:'123456'}));
    assert.equal(response.status,200);assert.deepEqual(Object.keys(response.body).sort(),['access_code','ok']);
    const login=h.calls.find(c=>c.name==='agrimarket_farmer_session_login_v1');assert.match(login.args.p_token_hash,/^[a-f0-9]{64}$/);
    const cookie=h.calls.find(c=>c.cookie).cookie;assert.notEqual(cookie[1],login.args.p_token_hash);assert.equal(cookie[2].httpOnly,true);
    assert(!JSON.stringify(response.body).includes('123456'));
  });
  await test('session login rejects origin spoofing and invalid credentials without issuing a cookie', async()=>{
    const h=sessionApiHarness();assert.equal((await h.api.POST(h.req('POST',{access_code:'AGF-FARM0001',pin:'123456'},'https://evil.test'))).status,403);
    assert.equal(h.calls.length,0);
    assert.equal((await h.api.POST(h.req('POST',{access_code:'AGF-FARM0001',pin:'123456'}))).status,401);
    assert(!h.calls.some(c=>c.cookie));
  });
  await test('session logout clears cookie only after successful server revocation', async()=>{
    const h=sessionApiHarness();assert.equal((await h.api.DELETE(h.req('DELETE'))).status,200);
    assert.equal(h.calls[0].name,'agrimarket_farmer_session_logout_v1');assert.equal(h.calls[1].cookie[2].maxAge,0);
    const failed=sessionApiHarness({error:Error('private database detail')});const response=await failed.api.DELETE(failed.req('DELETE'));
    assert.equal(response.status,503);assert(!failed.calls.some(c=>c.cookie));assert(!JSON.stringify(response.body).includes('private database'));
  });
  console.log(`${passed} AgriMarket browser alert test groups passed.`);
}
run().catch(error => { console.error(error); process.exitCode = 1; });
