const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, require: name => mocks[name] || require(name),
    Date, URL, console, setTimeout, clearTimeout,
    process: { env: { SUPABASE_URL: 'https://test.invalid', SUPABASE_SERVICE_ROLE_KEY: 'test-only' } },
  }, { filename: file });
  return module.exports;
}

const progress = load('app/takeout/passengerProgress.ts');
const fares = load('app/takeout/fareProposal.ts');
const fixture = {
  id: 'test-order', booking_code: 'TO-PROGRESS-TEST', service_type: 'takeout',
  assigned_driver_id: 'test-driver', driver_status: 'rider_arrived_vendor',
  vendor_status: 'rider_arrived_vendor', customer_status: 'rider_arrived_vendor',
  takeout_pricing_status: 'customer_confirmed', takeout_items_subtotal: 99,
  takeout_delivery_fee: 25, takeout_service_fee: 15, takeout_total_payable: 139,
};

// Enforce the route's real projection: omitted database fields cannot leak into
// the fixture response and accidentally make a broken API pass this test.
async function readOrder(row) {
  const db = { from(table) {
    let fields = [], filters = [];
    const q = {
      select(value) { fields = value.split(','); return q; },
      eq(key, value) { filters.push(r => r[key] === value); return q; },
      order() { return q; }, limit() { return q; }, in() { return q; },
      update() { throw new Error('Progress reads must not write this order'); },
      then(resolve, reject) {
        const rows = table === 'bookings' && filters.every(check => check(row)) ? [row] : [];
        return Promise.resolve({ data: rows.map(r => Object.fromEntries(fields.map(key => [key, r[key] ?? null]))), error: null }).then(resolve, reject);
      },
    };
    return q;
  } };
  const api = load('app/api/takeout/orders/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options.status }) } },
    '@supabase/supabase-js': { createClient: () => db },
  });
  const response = await api.GET({ url: 'https://test.invalid/api/takeout/orders?booking_code=TO-PROGRESS-TEST' });
  assert.equal(response.status, 200);
  return response.body.order;
}

function render(order) {
  let stateIndex = 0;
  const page = load('app/takeout/track/[bookingCode]/page.tsx', {
    react: { ...React, useState: initial => [stateIndex++ === 0 ? order : initial, () => {}], useMemo: fn => fn(), useEffect() {}, useRef: value => ({ current: value }) },
    'next/navigation': { useParams: () => ({ bookingCode: fixture.booking_code }) },
    '../../passengerProgress': progress,
    '../../fareProposal': fares,
    '../../TakeoutFareProposal': { __esModule: true, default: () => null },
  });
  return renderToStaticMarkup(page.default());
}

function chipDone(html, label) {
  const match = html.match(new RegExp('<div class="([^"]*)">' + label + '</div>'));
  assert(match, 'Missing progress chip: ' + label);
  return match[1].includes('border-emerald-300');
}

let passed = 0;
async function test(name, fn) { await fn(); console.log('PASS: ' + name); passed++; }
(async () => {
  await test('recorded arrival -> vendor ready retains At store through API, rendering and fresh reload', async () => {
    const before = await readOrder(fixture);
    assert(chipDone(render(before), 'At store'));
    const after = await readOrder({ ...fixture, vendor_status: 'pickup_ready', customer_status: 'ready_for_pickup' });
    assert.equal(after.driver_status, 'rider_arrived_vendor');
    for (const row of [after, JSON.parse(JSON.stringify(after))]) {
      const html = render(row);
      assert(chipDone(html, 'At store'));
      assert(!chipDone(html, 'Picked up'));
      assert(html.includes('Driver arrived at vendor'));
      assert(html.toLowerCase().includes('ready for pickup'));
    }
    assert.equal(after.takeout_total_payable, 139);
  });
  await test('vendor ready before arrival does not claim driver is at store', async () => {
    for (const driver_status of ['driver_accepted', 'arrived_customer_cash', 'cash_collected', 'vendor_bound', null]) {
      const html = render(await readOrder({ ...fixture, driver_status, vendor_status: 'pickup_ready', customer_status: 'ready_for_pickup' }));
      assert(!chipDone(html, 'At store'), String(driver_status));
      assert(html.toLowerCase().includes('ready for pickup'));
    }
  });
  await test('pickup and delivery advance despite stale vendor-ready status', async () => {
    for (const driver_status of ['picked_up', 'delivering']) {
      const html = render(await readOrder({ ...fixture, driver_status, vendor_status: 'pickup_ready', customer_status: 'ready_for_pickup' }));
      assert(chipDone(html, 'At store'));
      assert(chipDone(html, 'Picked up'));
      assert.equal(chipDone(html, 'Delivering'), driver_status === 'delivering');
      assert(!html.toLowerCase().includes('ready for pickup'));
    }
  });
  await test('completed, cancelled and timed out orders cannot show stale readiness', async () => {
    for (const status of ['completed', 'cancelled', 'vendor_timeout', 'expired']) {
      const row = { ...fixture, vendor_status: 'pickup_ready', customer_status: status };
      const result = progress.passengerProgress(row, 'pickup_ready');
      assert.equal(result.progressStatus, status);
      assert.equal(result.vendorReady, false);
      assert(!render(row).toLowerCase().includes('ready for pickup'));
    }
  });
  await test('saved arrival aliases work without mutating the API order', () => {
    for (const driver_status of ['arrived_vendor', 'arrived_at_vendor', 'at_vendor', 'rider_at_vendor']) {
      const row = Object.freeze({ ...fixture, driver_status, vendor_status: 'pickup_ready', customer_status: 'ready_for_pickup' });
      assert(chipDone(render(row), 'At store'));
      assert.equal(row.driver_status, driver_status);
    }
  });
  await test('ordinary states retain their existing progress and do not show vendor readiness', () => {
    for (const status of ['vendor_pending', 'vendor_accepted', 'driver_accepted', 'customer_confirmed', 'rider_arrived_vendor', 'picked_up', 'delivering']) {
      const result = progress.passengerProgress({ vendor_status: status }, status);
      assert.equal(result.progressStatus, status);
      assert.equal(result.vendorReady, false);
    }
  });
  console.log(passed + ' passenger progress checks passed. No network or live data used.');
})().catch(error => { console.error(error); process.exitCode = 1; });
