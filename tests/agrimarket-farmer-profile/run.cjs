// Regression tests for authenticated farmer pickup and profile completion.
// Provider/database calls are mocked here; SQL is also verified with rollback probes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const origin = 'https://app.jride.net';
const code = 'AGF-LAMUTTEST';
const producer = { id: 'test-producer', town: 'Lamut', status: 'active' };
const centers = { Lamut: [121.22, 16.65], Lagawe: [121.1, 16.8] };
const point = { lat: 16.65, lng: 121.22, town: 'Lamut', barangay: null, label: 'Test pickup', launch_eligible: true };
let passed = 0;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }
function load(file, mocks = {}, globals = {}) {
  const module = { exports: {} };
  const result = ts.transpileModule(read(file), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  }, reportDiagnostics: true });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  const resolve = name => {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return {};
    const base = name.startsWith('@/') ? name.slice(2) : name.startsWith('.') ? path.posix.join(path.posix.dirname(file), name) : null;
    if (base) {
      const target = ['.ts', '.tsx', ''].map(ext => base + ext).find(p => fs.existsSync(path.join(root, p)));
      assert(target, 'Missing source: ' + base); return load(target, mocks, globals);
    }
    return require(name);
  };
  vm.runInNewContext(result.outputText, { module, exports: module.exports, require: resolve,
    process: { env: { NEXT_PUBLIC_MAPBOX_TOKEN: 'TEST_ONLY' } }, console, Buffer, URL, URLSearchParams,
    Headers, Date, Error, AbortSignal, setTimeout, clearTimeout, ...globals }, { filename: file });
  return module.exports;
}
const session = load('lib/agrimarket/farmerSessionServer.ts');
const client = load('lib/agrimarket/farmerSessionClient.ts', {
  './browserAlerts': { AGRI_ALERT_SCOPE: '/agrimarket/' },
  './browserAlertDevice': { isFarmerAlertWorker: () => false },
});
function apiHarness(options = {}) {
  const calls = [];
  const db = { rpc: async (name, args) => {
    calls.push({ kind: 'auth', name, args });
    return options.expired ? { data: null, error: null } : { data: { access_code: code, producer }, error: null };
  } };
  const api = load('app/api/agrimarket/producer/location/route.ts', {
    '../../_lib/server': {
      agrimarketFarmerPortalEnabled: () => options.portal !== false,
      agrimarketFarmerPortalDisabledResponse: () => ({ status: 503, body: { ok: false } }),
      // Deliberately fail if profile lookup is recoupled to public applications.
      agrimarketOnboardingEnabled: () => { throw Error('PUBLIC_GATE_MUST_NOT_BE_USED'); },
      requireAgrimarketProducer: async req => {
        const value = await session.readFarmerSession(req, db);
        return value ? { ok: true, ...value, accessCode: value.access_code } : { ok: false, response: { status: 401, body: { ok: false, message: 'Sign in again.' } } };
      },
      jsonNoStore: (status, body) => ({ status, body }),
    },
    '../../_lib/admin-farmer-location': {
      searchFarmerLocations: async (q, town) => { calls.push({ kind: 'search', q, town }); if (options.providerError) throw Error('SECRET_PROVIDER_ERROR'); return options.results || [point]; },
      reverseGeocodeFarmerPin: async (lat, lng) => { calls.push({ kind: 'reverse', lat, lng }); if (options.providerError) throw Error('SECRET_PROVIDER_ERROR'); return Object.hasOwn(options, 'point') ? options.point : { ...point, lat, lng }; },
    },
    '@/lib/agrimarket/farmer-towns': { FARMER_TOWN_CENTERS: centers },
  });
  function req(query, headers = client.farmerSessionHeaders(code), hasCookie = true) {
    return { method: 'GET', nextUrl: new URL(origin + '/api/agrimarket/producer/location?' + query),
      headers: new Headers(headers), cookies: { get: () => hasCookie ? { value: 'a'.repeat(64) } : undefined } };
  }
  return { api, calls, req };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function walk(node, pred) {
  if (!node || typeof node !== 'object') return null;
  if (pred(node)) return node;
  for (const child of [node.props?.children].flat(Infinity)) { const found = walk(child, pred); if (found) return found; }
  return null;
}
function mapHarness({ farmerCode = code, apiOptions = {}, fetchOverride } = {}) {
  const server = apiHarness(apiOptions), requests = [], changes = [], effects = [], slots = [];
  let index = 0, tree, mapInstance, markerInstance;
  const react = {
    useRef(value) { const i = index++; if (!(i in slots)) slots[i] = { current: value }; return slots[i]; },
    useState(value) { const i = index++; if (!(i in slots)) slots[i] = typeof value === 'function' ? value() : value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useEffect(fn, deps) { const i = index++; const old = slots[i]; if (!old || deps.some((v, n) => !Object.is(v, old[n]))) { effects.push(fn); slots[i] = deps; } },
  };
  class MapMock {
    constructor() { mapInstance = this; this.events = {}; }
    on(event, cb) { this.events[event] = cb; }
    addControl() {} flyTo() {} remove() {}
  }
  class MarkerMock {
    constructor() { markerInstance = this; this.events = {}; }
    setLngLat(coord) { this.coord = coord; return this; }
    addTo() { return this; } on(event, cb) { this.events[event] = cb; }
    getLngLat() { return { lng: this.coord[0], lat: this.coord[1] }; } remove() {}
  }
  const jsx = (type, props) => ({ type, props });
  const component = load('components/agrimarket/FarmerPickupMap.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    'mapbox-gl': { Map: MapMock, Marker: MarkerMock, NavigationControl: class {} },
    '@/lib/agrimarket/farmer-towns': { FARMER_TOWN_CENTERS: centers },
    '@/lib/agrimarket/farmerSessionClient': client,
  }, {
    navigator: { geolocation: { getCurrentPosition: ok => ok({ coords: { latitude: point.lat, longitude: point.lng } }) } },
    fetch: async (url, opts) => {
      requests.push({ url, opts });
      if (fetchOverride) return fetchOverride(url, opts);
      if (!url.startsWith('/api/agrimarket/producer/location?')) return { ok: true, json: async () => ({ results: [] }) };
      const response = await server.api.GET(server.req(url.split('?')[1], opts.headers));
      return { ok: response.status < 400, status: response.status, json: async () => response.body };
    },
  });
  const props = { selectedTown: 'Lamut', farmerCode, value: component.emptyFarmerPin(), onChange: value => { props.value = value; changes.push(value); } };
  const render = () => {
    index = 0; tree = component.default(props);
    const container = walk(tree, node => node.props?.ref); if (container) container.props.ref.current = {};
    while (effects.length) effects.shift()();
    return tree;
  };
  render();
  const clickPin = async (lat = point.lat, lng = point.lng) => { mapInstance.events.click({ lngLat: { lat, lng } }); await flush(); render(); };
  const search = async text => { walk(tree, n => n.props?.['aria-label'] === 'Search pickup location').props.onChange({ target: { value: text } }); render(); walk(tree, n => n.type === 'button' && n.props.children === 'Search map').props.onClick(); await flush(); render(); };
  return { server, requests, changes, props, render, clickPin, search, get tree() { return tree; }, get marker() { return markerInstance; } };
}
async function run() {
  await test('missing cookie and missing session header both reject before geocoding', async () => {
    const h = apiHarness();
    assert.equal((await h.api.GET(h.req('q=Lamut', client.farmerSessionHeaders(code), false))).status, 401);
    assert.equal((await h.api.GET(h.req('q=Lamut', {}))).status, 401);
    assert.equal(h.calls.length, 0);
  });
  await test('expired session and another farm code cannot search', async () => {
    let h = apiHarness({ expired: true }); assert.equal((await h.api.GET(h.req('q=Lamut'))).status, 401);
    h = apiHarness(); assert.equal((await h.api.GET(h.req('q=Lamut', client.farmerSessionHeaders('AGF-OTHERFARM')))).status, 401);
    assert(!h.calls.some(c => c.kind === 'search'));
  });
  await test('cross-origin and cross-site lookup reject without database or provider calls', async () => {
    const h = apiHarness();
    for (const extra of [{ origin: 'https://other.test' }, { 'sec-fetch-site': 'cross-site' }]) {
      assert.equal((await h.api.GET(h.req('q=Lamut', { ...client.farmerSessionHeaders(code), ...extra }))).status, 401);
    }
    assert.equal(h.calls.length, 0);
  });
  await test('disabled farmer portal fails closed', async () => {
    const h = apiHarness({ portal: false }); assert.equal((await h.api.GET(h.req('q=Lamut'))).status, 503); assert.equal(h.calls.length, 0);
  });
  await test('authenticated search does not depend on public onboarding and filters other towns', async () => {
    const h = apiHarness({ results: [point, { ...point, town: 'Lagawe' }, { ...point, launch_eligible: false }] });
    const r = await h.api.GET(h.req('q=Municipal+hall&town=Lamut'));
    assert.equal(r.status, 200); assert.equal(r.body.results.length, 1); assert.equal(h.calls.find(c => c.kind === 'search').town, 'Lamut');
  });
  await test('forged municipality and invalid search length do not call provider', async () => {
    const h = apiHarness();
    for (const q of ['q=hall&town=Lagawe', 'q=a', 'q=' + 'a'.repeat(181)]) assert.equal((await h.api.GET(h.req(q))).status, 400);
    assert(!h.calls.some(c => c.kind === 'search'));
  });
  await test('no search matches is not a pin-verification failure', async () => {
    const h = apiHarness({ results: [] }); const r = await h.api.GET(h.req('q=Unknown')); assert.equal(r.status, 200); assert.equal(r.body.results.length, 0);
  });
  await test('valid pin preserves exact requested coordinates and verifies own town', async () => {
    const h = apiHarness(); const r = await h.api.GET(h.req('lat=16.651615&lng=121.2191733')); assert.equal(r.status, 200);
    assert.equal(r.body.location.lat, 16.651615); assert.equal(r.body.location.lng, 121.2191733); assert.equal(r.body.location.town, 'Lamut');
  });
  await test('missing, blank, non-finite and out-of-range coordinates reject before provider', async () => {
    const h = apiHarness();
    for (const q of ['', 'lat=&lng=121', 'lat=16&lng=', 'lat=null&lng=121', 'lat=Infinity&lng=121', 'lat=91&lng=121', 'lat=16&lng=181']) assert.equal((await h.api.GET(h.req(q))).status, 400, q);
    assert(!h.calls.some(c => c.kind === 'reverse'));
  });
  await test('unresolved, out-of-town and ineligible pins cannot be accepted', async () => {
    for (const p of [null, { ...point, town: 'Lagawe' }, { ...point, launch_eligible: false }]) {
      const h = apiHarness({ point: p }); assert.equal((await h.api.GET(h.req('lat=16&lng=121'))).status, 422);
    }
  });
  await test('geocoder failure is reported without disclosing provider details', async () => {
    const h = apiHarness({ providerError: true });
    for (const q of ['q=Lamut', 'lat=16&lng=121']) { const r = await h.api.GET(h.req(q)); assert.equal(r.status, 502); assert(!JSON.stringify(r).includes('SECRET')); }
  });
  await test('map click authenticates with existing cookie path and required headers', async () => {
    const h = mapHarness(); await h.clickPin(); const req = h.requests[0];
    assert(new URL(req.url, origin).pathname.startsWith(session.FARMER_SESSION_PATH + '/'));
    assert.equal(req.opts.headers['x-jride-agrimarket-session'], '1'); assert.equal(req.opts.headers['x-jride-agrimarket-code'], code);
    assert.equal(req.opts.credentials, 'same-origin'); assert.equal(req.opts.cache, 'no-store'); assert(req.opts.signal);
    assert.equal(h.props.value.launch_eligible, true); assert.equal(h.props.value.resolved_town, 'Lamut'); assert.equal(h.props.value.resolving, false);
    assert(!Object.hasOwn(req.opts.headers, 'x-jride-agrimarket-pin'));
  });
  await test('search uses authenticated endpoint but selecting result still requires actual pin', async () => {
    const h = mapHarness(); await h.search('Lamut'); assert(h.requests[0].url.startsWith('/api/agrimarket/producer/location?'));
    const result = walk(h.tree, n => n.type === 'button' && n.props.children === point.label); assert(result);
    result.props.onClick(); h.render(); assert.equal(h.props.value.lat, null); assert.equal(h.props.value.launch_eligible, false);
    await h.clickPin(); assert.equal(h.props.value.launch_eligible, true);
  });
  await test('public picker keeps separate endpoint and sends no farmer credentials', async () => {
    const h = mapHarness({ farmerCode: '' }); await h.search('Lamut');
    assert(h.requests[0].url.startsWith('/api/agrimarket/farmer-location?')); assert.equal(h.requests[0].opts.headers['x-jride-agrimarket-code'], undefined);
  });
  await test('manual pin works with no address suggestion or search request', async () => {
    const h = mapHarness({ apiOptions: { results: [] } }); await h.clickPin();
    assert.equal(h.requests.length, 1); assert(!h.requests[0].url.includes('q=')); assert.equal(h.props.value.launch_eligible, true);
  });
  await test('Use my location and marker drag use same authenticated verification', async () => {
    const h = mapHarness(); walk(h.tree, n => n.type === 'button' && n.props.children === 'Use my location').props.onClick(); await flush(); h.render();
    assert.equal(h.props.value.launch_eligible, true);
    h.marker.setLngLat([121.219, 16.651]); h.marker.events.dragend(); await flush(); h.render();
    assert.equal(h.props.value.lat, 16.651); assert.equal(h.requests.length, 2); assert(h.requests.every(r => r.opts.headers['x-jride-agrimarket-session'] === '1'));
  });
  await test('rejected verification retains selected coordinates but never enables save', async () => {
    const h = mapHarness({ apiOptions: { point: { ...point, town: 'Lagawe' } } }); await h.clickPin();
    assert.equal(h.props.value.lat, point.lat); assert.equal(h.props.value.launch_eligible, false); assert.equal(h.props.value.resolving, false);
    assert(walk(h.tree, n => n.props?.role === 'alert' && n.props.children.includes('inside Lamut')));
  });
  await test('stale pin response cannot overwrite a newer verified pin', async () => {
    const deferred = [];
    const h = mapHarness({ fetchOverride: () => new Promise(resolve => deferred.push(resolve)) });
    await h.clickPin(16.65, 121.22); await h.clickPin(16.66, 121.23);
    deferred[1]({ ok: true, json: async () => ({ location: point }) }); await flush(); h.render();
    deferred[0]({ ok: true, json: async () => ({ location: { ...point, town: 'Lagawe' } }) }); await flush(); h.render();
    assert.equal(h.props.value.lat, 16.66); assert.equal(h.props.value.resolved_town, 'Lamut');
  });
  await test('profile passes account code and keeps municipality/access/directions save gates', () => {
    const page = read('app/agrimarket/producer/profile/page.tsx');
    assert(page.includes('farmerCode={sessionCode}'));
    for (const guard of ['!pickup.launch_eligible', 'pickup.resolved_town !== profile.town', '!form.pickup_motorcycle_accessible && !form.pickup_tricycle_accessible', 'form.pickup_driver_directions.trim().length < 5']) assert(page.includes(guard));
    assert(page.includes('Driver directions / landmark'));
  });
  await test('audit migration changes only compatible event labels and adds action detail', () => {
    const before = read('supabase/migrations/20260922012406_agrimarket_preassigned_farmer_profile_completion_v1.sql');
    const after = read('supabase/migrations/20260922115000_agrimarket_farmer_profile_audit_contract_v1.sql');
    const expected = before.replace("    'profile_completed_by_farmer',\n    'farmer',", "    'profile_updated',\n    'applicant',")
      .replace("    jsonb_build_object(\n      'producer_id',p_producer_id,", "    jsonb_build_object(\n      'action','profile_completed_by_farmer',\n      'producer_id',p_producer_id,");
    assert.notEqual(before, expected); assert.equal(after, expected);
    assert(after.includes('accepting_orders=false')); assert(after.includes('store_open=false'));
    assert(!/ALTER TABLE|DROP CONSTRAINT|DISABLE TRIGGER/i.test(after));
  });
  console.log('AgriMarket farmer profile: ' + passed + ' test groups passed.');
}
run().catch(error => { console.error(error); process.exitCode = 1; });
