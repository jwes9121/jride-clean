const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const root = path.resolve(__dirname, '../..');
const start = Date.UTC(2026, 8, 12, 0, 0, 0);
let currentTime = start;
class ClockDate extends Date { static now() { return currentTime; } }

function load(file, mocks = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => mocks[name] || require(name), Date: ClockDate, console, setTimeout, clearTimeout }, { filename: file });
  return module.exports;
}

// Seed the existing first state slot to inspect the render before effects run.
// For the quote, this reproduces a page opened 45 seconds before quote arrival.
function seededReact(value) {
  let first = true;
  return { ...React, useState(initial) {
    if (first) { first = false; return React.useState(value); }
    return React.useState(initial);
  } };
}

const fare = load('app/takeout/fareProposal.ts');
const quote = {
  id: 'display-test', booking_code: 'TO-DISPLAY-TEST', service_type: 'takeout',
  status: 'assigned', vendor_status: 'driver_accepted', customer_status: 'driver_accepted',
  takeout_pricing_status: 'driver_fee_proposed', takeout_items_subtotal: 99,
  takeout_total_payable: 139, takeout_delivery_fee: 40,
  takeout_fee_proposed_at: new Date(start).toISOString(),
  takeout_fee_expires_at: new Date(start + 300000).toISOString(),
};
function renderQuote(now, staleClock = start - 45000, order = quote) {
  currentTime = now;
  const Component = load('app/takeout/TakeoutFareProposal.tsx', { react: seededReact(staleClock), './fareProposal': fare }).default;
  return renderToStaticMarkup(React.createElement(Component, { order, lines: [], busy: false, error: null, onConfirm() {} }));
}
function renderPassenger(order) {
  currentTime = start;
  const Component = load('app/takeout/track/[bookingCode]/page.tsx', {
    react: seededReact(order), 'next/navigation': { useParams: () => ({ bookingCode: quote.booking_code }) },
    '../../fareProposal': fare, '../../TakeoutFareProposal': { default: () => null, __esModule: true },
  }).default;
  return renderToStaticMarkup(React.createElement(Component));
}
const workflow = load('lib/vendorOrderWorkflow.ts');
const focus = load('app/components/VendorOrderFocus.tsx', { '@/lib/vendorOrderWorkflow': workflow });
const navigation = load('app/components/VendorNavigation.tsx');
function renderVendor(connection) {
  const feed = { orders: [{ ...quote, vendor_status: 'preparing', takeout_pricing_status: 'customer_confirmed', takeout_customer_confirmed_at: new Date(start).toISOString(), customer_name: 'Test customer', items: [{ name: 'Test meal', quantity: 1, price: 99 }], created_at: new Date(start).toISOString() }], notices: [], lastUpdated: start, serverOffset: 0, stale: connection !== 'fresh', refreshing: connection === 'updating', authRequired: connection === 'auth', error: connection === 'offline' ? 'Offline' : connection === 'auth' ? 'Sign in required' : '', refresh() {}, acknowledge() {}, dismissNotice() {} };
  const Component = load('app/vendor-orders/page.tsx', {
    '../components/VendorNavigation': navigation, '../components/VendorOrderFocus': focus,
    '../components/VendorOrderSound': { VendorOrderSoundControls: () => null },
    '../components/useVendorOrders': { useVendorIdentity: () => 'test-vendor', useVendorOrders: () => feed, useOrderClock: () => start },
    '@/lib/vendorOrderWorkflow': workflow,
  }).default;
  return renderToStaticMarkup(React.createElement(Component));
}

function run() {
  assert.match(renderQuote(start), /300 seconds remaining/);
  assert.match(renderQuote(start + 2000), /298 seconds remaining/);
  assert.doesNotMatch(renderQuote(start + 2000), /5:45/);
  assert.match(renderQuote(start + 275000), /25 seconds remaining/);
  assert.match(renderQuote(start + 275000, start + 275000), /25 seconds remaining/);
  assert.equal(renderQuote(start + 300000), '');
  console.log('PASS: first quote render uses current time; late arrival and reopening retain the original five-minute deadline; expired quote stays hidden');

  const pending = { ...quote, takeout_pricing_status: 'pricing_pending', vendor_status: 'vendor_accepted', customer_status: 'vendor_accepted' };
  assert.match(renderPassenger({ ...pending, vendor_status: 'vendor_pending', customer_status: 'vendor_pending' }), /Waiting for the store to confirm/);
  assert.match(renderPassenger(pending), /Looking for a nearby driver/);
  assert.match(renderPassenger({ ...pending, vehicle_type: 'motorcycle' }), /Looking for a nearby driver/);
  assert.match(renderPassenger({ ...pending, assigned_driver_id: 'driver-test' }), /Waiting for the driver to accept/);
  for (const patch of [{ driver_status: 'accepted' }, { vendor_status: 'driver_accepted' }, { customer_status: 'driver_accepted' }]) {
    const html = renderPassenger({ ...pending, assigned_driver_id: 'driver-test', ...patch });
    assert.match(html, /Your assigned driver is preparing the delivery quote/);
    assert.doesNotMatch(html, /Looking for a nearby driver|Waiting for the driver to accept/);
  }
  assert.doesNotMatch(renderPassenger({ ...pending, status: 'cancelled' }), /Looking for a nearby driver/);
  console.log('PASS: passenger distinguishes store confirmation, driver search, assignment and acceptance; requested vehicle alone is not assignment');

  for (const state of ['fresh', 'updating', 'offline', 'auth']) {
    const html = renderVendor(state);
    const button = html.match(/<button[^>]*>Mark order ready<\/button>/)?.[0];
    assert(button, state + ': ready control exists');
    assert.equal(button.includes('disabled=""'), state !== 'fresh', state + ': connection still guards actions');
    const top = html.split('<div class="vendor-workspace-content">')[0];
    assert.doesNotMatch(top, /vendor-focus-connection/);
    assert.match(top, /vendor-orders-freshness/);
    if (state === 'offline') assert.match(html, /Connection lost\. Order actions are paused/);
    if (state === 'auth') assert.match(html, /Sign in again/);
  }
  console.log('PASS: connection states share one top status line; stale and signed-out controls remain disabled with recovery messages');
}
if (require.main === module) run();
module.exports = { renderVendor };
