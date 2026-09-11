const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const source = fs.readFileSync(path.join(root, 'app/takeout/orders/historyStatus.ts'), 'utf8');
const moduleScope = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: moduleScope.exports });
const { isActive, getDisplayStatus } = moduleScope.exports;

for (const field of ['customer_status', 'vendor_status', 'status']) {
  for (const status of ['completed', 'cancelled', 'canceled', 'vendor_timeout', 'expired']) {
    const order = { customer_status: 'pending', vendor_status: 'driver_assigned', status: 'searching', [field]: ' ' + status.toUpperCase() + ' ' };
    assert.equal(isActive(order), false, `${field}: ${status} must be in history`);
  }
}
console.log('PASS: explicit terminal states override stale progress in all three status fields');
for (const status of ['pending', 'driver_assigned', 'pickup_ready', 'picked_up', 'delivering', 'new_unknown_state', '', null]) {
  assert.equal(isActive({ status, created_at: '2000-01-01' }), true);
}
console.log('PASS: active and unknown states remain visible; age alone never closes an order');
const orders = [
  ...Array.from({ length: 4 }, (_, i) => ({ id: `timeout-${i}`, customer_status: 'vendor_timeout', vendor_status: 'vendor_timeout', status: 'cancelled' })),
  ...Array.from({ length: 4 }, (_, i) => ({ id: `complete-${i}`, status: 'completed' })),
  ...Array.from({ length: 2 }, (_, i) => ({ id: `cancel-${i}`, status: 'cancelled' })),
];
const before = JSON.stringify(orders);
assert.equal(orders.filter(isActive).length, 0);
assert.equal(orders.filter(order => !isActive(order)).length, 10);
assert.equal(JSON.stringify(orders), before);
assert.equal(getDisplayStatus(orders[0]), 'Expired');
assert.equal(getDisplayStatus({ status: 'expired' }), 'Expired');
assert.equal(getDisplayStatus({ status: 'canceled' }), 'Cancelled');
assert.equal(getDisplayStatus({ customer_status: 'preparing_order', status: 'completed' }), 'Completed');
console.log('PASS: four timeout orders move to Past; ten records remain unchanged with consistent labels');
