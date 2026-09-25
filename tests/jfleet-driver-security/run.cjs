'use strict';

const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');

const read = (p) => fs.readFileSync(p, 'utf8');
let passed = 0;
function check(name, value) {
  assert.ok(value, name);
  passed += 1;
  console.log('PASS ' + name);
}

const driverApi = read('app/api/jfleet/driver/location/route.ts');
const ownerApi = read('app/api/jfleet/owner/security/route.ts');
const adminApi = read('app/api/admin/jfleet/security/route.ts');
const ownerPage = read('app/jfleet/owner/security/page.tsx');
const adminPage = read('app/admin/jfleet/security/page.tsx');
const ownerHome = read('app/jfleet/owner/page.tsx');
const migration = read('supabase/migrations/20260925200806_jfleet_driver_security_v1.sql');

check('driver GPS uses security RPC', driverApi.includes('jfleet_driver_location_security_v1'));
check('driver GPS still gates feature first', driverApi.indexOf('jfleetFeatureFlagEnabled') < driverApi.indexOf('requireJfleetDriver'));
check('driver GPS uses authenticated server driver id', driverApi.includes('p_driver_id: auth.driver.id'));
check('driver GPS never trusts client driver id', !driverApi.includes('body?.driver_id'));

check('owner security scoped to owner partner', ownerApi.includes('.eq("partner_id", auth.partner.id)'));
check('owner security action uses authenticated owner', ownerApi.includes('p_owner_user_id: auth.user.id'));
check('owner security exposes no threshold writes', !ownerApi.includes('jfleet_security_policies").update'));
check('owner portal links security page', ownerHome.includes('href="/jfleet/owner/security"'));

check('JRide security requires staff', adminApi.includes('requireStaff(["admin", "dispatcher"])'));
check('JRide security disabled response is empty', adminApi.includes('enabled: false, events: []'));

check('policy disabled by default', migration.includes('enabled boolean not null default false'));
check('migration does not enable a partner policy', !/insert\s+into\s+public\.jfleet_security_policies/i.test(migration));
check('route distance is server-side', migration.includes('jfleet_point_route_distance_m_v1'));
check('route monitor uses immutable booking review', migration.includes('b.route_review_id'));
check('unrouted paid add-on pauses route judging', migration.includes('paid_addon_without_routed_itinerary'));
check('tracking gap scanner exists', migration.includes('jfleet_scan_tracking_gaps_v1'));
check('tracking gap cron runs once per minute', migration.includes("'jfleet_tracking_gap_scan_v1'") && migration.includes("'* * * * *'"));
check('one active event per booking/type', migration.includes('jfleet_security_one_active_event_idx'));
check('fresh GPS resolves tracking gap', migration.includes("'fresh_location_received'"));
check('route recovery resolves deviation', migration.includes("'route_recovered'"));
check('security RPCs revoked from clients', migration.includes('from public,anon,authenticated'));
check('owner action verifies partner owner', migration.includes('owner_user_id=p_owner_user_id'));

for (const [name, fileName, source] of [
  ['owner security page', 'app/jfleet/owner/security/page.tsx', ownerPage],
  ['admin security page', 'app/admin/jfleet/security/page.tsx', adminPage],
  ['driver location API', 'app/api/jfleet/driver/location/route.ts', driverApi],
  ['owner security API', 'app/api/jfleet/owner/security/route.ts', ownerApi],
  ['admin security API', 'app/api/admin/jfleet/security/route.ts', adminApi],
]) {
  check(name + ' is ASCII', !/[^\x00-\x7F]/.test(source));
  const result = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  });
  if (result.diagnostics.length) {
    console.error(result.diagnostics.map((d) => String(d.messageText)).join(' | '));
  }
  check(name + ' parses', result.diagnostics.length === 0);
}

check('owner screen warns when policy disabled', ownerPage.includes('Security thresholds are not enabled yet'));
check('owner screen shows monitoring pause', ownerPage.includes('Monitoring paused:'));
check('owner screen supports acknowledge', ownerPage.includes('"acknowledge"'));
check('JRide screen shows cross-partner feed', adminPage.includes('Cross-partner route deviation and GPS continuity feed'));

console.log('JFleet driver security checks: ' + passed + ' passed.');
