const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
function load(file, mocks) {
  const module = { exports: {} };
  const js = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(js, { module, exports: module.exports, Date, console, require(name) {
    if (name in mocks) return mocks[name];
    if (name.startsWith('@/')) return load(name.slice(2) + '.ts', mocks);
    return require(name);
  } });
  return module.exports;
}
const order = {
  id: 'order-a', order_code: 'AG-TEST-A', producer_id: 'farm-a', customer_user_id: 'customer-a', delivery_address_id: 'address-a',
  delivery_label: 'Booked destination', delivery_lat: 16.8, delivery_lng: 121.1,
  status: 'awaiting_producer', product_subtotal: '410', total_payable: '1104', heavy_load_fee: '30',
  farmer_to_customer_distance_km: '12.5', farmer_to_customer_duration_seconds: 1800,
  route_distance_km: null, route_duration_seconds: null, estimated_cargo_weight_kg: null,
  required_vehicle_type: 'kolong_kolong', assignment_anchor: 'customer', route_plan: 'cash_first',
  cash_collection_required: true, cash_collection_amount: '410', selected_vehicle_type: null,
  customer_approved_total: '900', customer_reapproval_proposed_total: '1104',
  customer_reapproval_required_at: '2026-09-20T01:00:00Z', confirmed_cargo_weight_band: '101_200',
};
function harness({ denied = false, failTable, mismatch = false, missing = false } = {}) {
  const calls = [];
  const rows = {
    agrimarket_orders: [order, { ...order, id: 'order-b', producer_id: 'farm-b', customer_user_id: 'customer-b', delivery_address_id: 'address-b' }],
    agrimarket_order_items: [{ order_id: 'order-a', product_id: 'rice', product_name: 'Rice', quantity: '2', selling_unit: 'sack', unit_price: '205', line_total: '410', cargo_class: 'bulk_sack', condition_required: 'dry' }],
    passenger_verifications: missing ? [] : [{ user_id: 'customer-a', full_name: 'Test Customer', phone: 'PRIVATE PHONE' }, { user_id: 'customer-b', full_name: 'OTHER FARM CUSTOMER', phone: 'OTHER PHONE' }],
    passenger_addresses: [{ id: 'address-a', created_by_user_id: mismatch ? 'customer-b' : 'customer-a', label: 'Edited label', address_text: 'Saved address', landmark: 'Saved landmark' }],
    agrimarket_producers: [{ id: 'farm-a', vendor_name: 'Test Farm', town: 'Hingyon', barangay: 'Test area' }],
  };
  const db = {
    rpc: async name => { assert.equal(name, 'agrimarket_expire_pending_orders_v1'); return { error: null }; },
    from(table) {
      calls.push(table);
      let data = [...(rows[table] || [])];
      let columns = [];
      const q = {
        select(value) { columns = value.split(','); return q; },
        eq(key, value) { data = data.filter(row => row[key] === value); return q; },
        in(key, values) { data = data.filter(row => values.includes(row[key])); return q; },
        order() { return q; }, limit(n) { data = data.slice(0,n); return q; },
        range(a,b) { data = data.slice(a,b+1); return q; },
        then(resolve, reject) { return Promise.resolve({ data: data.map(row => Object.fromEntries(columns.map(key => [key, row[key]]))), error: table === failTable ? { message: 'read failed' } : null }).then(resolve,reject); },
      }; return q;
    },
  };
  const mocks = {
    '../../_lib/server': {
      agrimarketEnabled: () => true, agrimarketFarmerPortalEnabled: () => true,
      createServiceSupabase: () => db, jsonNoStore: (status, body) => ({ status, body }),
      requireAgrimarketStaff: async () => denied ? { ok: false, response: { status: 401 } } : { ok: true, role: 'admin' },
      requireAgrimarketProducer: async () => denied ? { ok: false, response: { status: 401 } } : { ok: true, producer: { id: 'farm-a' } },
    },
    '@/lib/agrimarket/dispatch': {}, '@/lib/agrimarket/schedule': { scheduledActivity: () => 'harvest' },
    'next/server': {},
  };
  return {
    admin: () => load('app/api/agrimarket/admin/dispatch/route.ts', mocks).GET(),
    farmer: () => load('app/api/agrimarket/producer/orders/route.ts', mocks).GET({ nextUrl: new URL('https://test.invalid/?view=active') }), calls,
  };
}
async function main() {
  const admin = await harness().admin();
  assert.equal(admin.status,200);
  const a = admin.body.orders[0];
  assert.equal(a.items[0].quantity,2); assert.equal(a.items[0].line_total,410);
  assert.equal(a.customer.phone,'PRIVATE PHONE'); assert.equal(a.customer.delivery_label,'Booked destination');
  assert.equal(a.farmer_area.name,'Test Farm'); assert.equal(a.details.heavy_load_fee,30);
  assert.equal(a.details.route_distance_km,null); assert.equal(a.details.estimated_cargo_weight_kg,null);
  assert.equal(a.details.customer_reapproval_proposed_total,1104);
  console.log('PASS admin receives item, customer, route, cargo, fee and approval details; unknowns stay null');
  const farmer = await harness().farmer();
  assert.equal(farmer.status,200); assert.equal(farmer.body.orders.length,1);
  const f = farmer.body.orders[0];
  assert.equal(f.customer.name,'Test Customer'); assert.equal(f.customer.delivery_label,'Booked destination');
  assert.equal(f.farmer_to_customer_distance_km,12.5); assert.equal(f.cash_collection_required,true);
  for (const forbidden of ['PRIVATE PHONE','OTHER FARM CUSTOMER','OTHER PHONE','Saved landmark','delivery_lat','company_settlement_due']) assert(!JSON.stringify(farmer.body).includes(forbidden),forbidden);
  console.log('PASS farmer sees only owned orders and role-appropriate customer/delivery context');
  const mismatched = (await harness({mismatch:true}).admin()).body.orders[0];
  assert.equal(mismatched.customer.address_text,null); assert.equal(mismatched.customer.landmark,null);
  assert.equal(mismatched.customer.delivery_label,'Booked destination');
  assert.equal((await harness({missing:true}).farmer()).body.orders[0].customer.name,null);
  console.log('PASS missing profiles and mismatched address ownership never invent or leak details');
  for (const method of ['admin','farmer']) {
    const h = harness({denied:true}); assert.equal((await h[method]()).status,401); assert.equal(h.calls.length,0);
    for (const failTable of ['passenger_verifications','passenger_addresses','agrimarket_order_items']) assert.equal((await harness({failTable})[method]()).status,500);
  }
  console.log('PASS both endpoints reject unauthorized access and expose detail-read failures');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { AgrimarketOrderDetails } = load('app/admin/livetrips/components/AgrimarketOrderDetails.tsx', {});
  const html = renderToStaticMarkup(React.createElement(AgrimarketOrderDetails,{order:a}));
  for (const expected of ['Rice','2','Customer to farmer','Kolong-Kolong','PHP 1104.00','Distance unavailable','Open booked delivery pin','Saved landmark']) assert(html.includes(expected),expected);
  assert(!html.includes('<details open')); assert(!html.includes('undefined')); assert(!html.includes('NaN'));
  const empty = renderToStaticMarkup(React.createElement(AgrimarketOrderDetails,{order:{...a,details:{},items:[],customer:null,cash_collection_required:false}}));
  assert(!empty.includes('Open booked delivery pin')); assert(!empty.includes('Customer to farmer')); assert(empty.includes('Item details unavailable'));
  console.log('PASS expandable admin details render real values, cash-first context and safe missing-data states');
}
main().catch(error => { console.error(error); process.exitCode=1; });
