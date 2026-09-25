const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const migrationPath = path.join(
  root,
  'supabase/migrations/20260925010000_regular_ride_search_expiry_v1.sql',
);
const eventMigrationPath = path.join(
  root,
  'supabase/migrations/20260925011000_regular_ride_search_expiry_event_type_v1.sql',
);
const routePath = path.join(root, 'app/api/cron/ride-expiry-recovery/route.ts');

function read(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
}

function test(name, fn) {
  fn();
  console.log('PASS: ' + name);
}

const migration = read(migrationPath);
const eventMigration = read(eventMigrationPath);
const route = read(routePath);
let passed = 0;

test('migration defines a bounded stale-search expiry RPC', () => {
  assert.match(migration, /expire_stale_searching_ride_windows_v1/);
  assert.match(migration, /booking\.status = 'searching'/);
  assert.match(migration, /booking\.driver_id is null/);
  assert.match(migration, /booking\.assigned_driver_id is null/);
  assert.match(migration, /interval '5 minutes'/);
  assert.match(migration, /limit bounded_limit\s+for update skip locked/);
  passed += 1;
});

test('stale searches close through a compare-and-set cancellation', () => {
  assert.match(migration, /status = 'cancelled'/);
  assert.match(migration, /cancel_reason = 'No driver found within 5 minutes'/);
  assert.match(migration, /and booking\.status = 'searching'/);
  assert.match(migration, /returning booking\.id into updated_id/);
  assert.match(migration, /ride_reassignment_pending = false/);
  passed += 1;
});

test('automatic closure preserves promo and lifecycle accounting', () => {
  assert.match(migration, /jride_promo_release_for_booking/);
  assert.match(migration, /'no_driver_found_timeout'/);
  assert.match(migration, /'search_expired'/);
  assert.match(migration, /'searching',\s*'cancelled'/);
  passed += 1;
});

test('lifecycle schema allows the automatic search-expired event', () => {
  assert.match(eventMigration, /booking_lifecycle_events_event_type_check/);
  assert.match(eventMigration, /'search_expired'::text/);
  passed += 1;
});

test('the one-minute recovery route invokes and reports searching expiry', () => {
  assert.match(route, /expire_stale_searching_ride_windows_v1/);
  assert.match(route, /RIDE_SEARCH_EXPIRY_SWEEP_FAILED/);
  assert.match(route, /JRIDE_RIDE_SEARCH_EXPIRED/);
  assert.match(route, /searchExpiredCount/);
  passed += 1;
});

console.log(`\n${passed} regular ride search expiry regression groups passed.`);
