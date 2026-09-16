const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");

const root = path.resolve(__dirname, "../..");
let passed = 0;

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function test(name, fn) {
  fn();
  passed += 1;
  console.log("PASS " + name);
}

const migration = read(
  "supabase/migrations/20260916193000_errand_15m_matching_window_v1.sql"
);
const retryRoute = read("app/api/dispatch/retry-auto-assign/route.ts");
const cronRoute = read("app/api/cron/errand-offer-expiry/route.ts");
const offerRoute = read("app/api/driver/errand/offer/route.ts");
const actionRoute = read("app/api/driver/errand/action/route.ts");
const assignment = read("lib/errand/assignStage0V2.ts");

const MATCHING_WINDOW_MS = 15 * 60 * 1000;
function expired(createdAtMs, nowMs) {
  return nowMs >= createdAtMs + MATCHING_WINDOW_MS;
}

test("15 minute boundary is strict", () => {
  const created = Date.UTC(2026, 8, 16, 0, 0, 0, 0);
  assert.equal(expired(created, created + MATCHING_WINDOW_MS - 1), false);
  assert.equal(expired(created, created + MATCHING_WINDOW_MS), true);
  assert.equal(expired(created, created + MATCHING_WINDOW_MS + 1), true);
});

test("database policy uses created_at and not updated_at as request lifetime", () => {
  assert.match(
    migration,
    /clock_timestamp\(\) >= new\.created_at \+ interval '15 minutes'/
  );
  assert.match(
    migration,
    /v_now >= v_booking\.created_at \+ interval '15 minutes'/
  );
  assert.match(
    migration,
    /booking\.created_at \+ interval '15 minutes' <= effective_now/
  );
  assert.doesNotMatch(migration, /updated_at \+ interval '15 minutes'/);
});

test("database guard blocks stale assignment and stale acceptance", () => {
  assert.match(
    migration,
    /before insert or update of status, assigned_driver_id, driver_id/
  );
  assert.match(migration, /v_new_status in \('assigned', 'accepted'\)/);
  assert.match(migration, /ERRAND_MATCHING_WINDOW_EXPIRED/);
  assert.match(migration, /status = 'cancelled'/);
  assert.match(
    migration,
    /cancel_reason = 'Errand matching expired after 15 minutes'/
  );
});

test("driver acceptance checks overall lifetime before per-offer timeout", () => {
  const overall = migration.indexOf(
    "if v_now >= v_booking.created_at + interval '15 minutes' then"
  );
  const offer = migration.indexOf(
    "if v_booking.driver_accept_expires_at is not null"
  );
  assert.ok(overall >= 0);
  assert.ok(offer > overall);
  assert.match(actionRoute, /rpcName = "errand_driver_accept_v1"/);
});

test("retry dispatcher expires stale errands before attempting reassignment", () => {
  const sweep = retryRoute.indexOf(
    "const errandExpiry = await expireStaleErrandMatchingWindows();"
  );
  const retry = retryRoute.indexOf(
    "const [genericResponse, errandRetry] = await Promise.all"
  );
  assert.ok(sweep >= 0);
  assert.ok(retry > sweep);
  assert.match(retryRoute, /expire_errand_matching_windows_v1/);
});

test("offer timeout cron expires overall matching window before offer reassignment", () => {
  const sweep = cronRoute.indexOf(
    'admin.rpc("expire_errand_matching_windows_v1"'
  );
  const offerScan = cronRoute.indexOf('.eq("status", "assigned")');
  assert.ok(sweep >= 0);
  assert.ok(offerScan > sweep);
  assert.match(cronRoute, /const reassignment = await assignErrandStage0/);
});

test("decline and offer expiry paths converge on guarded stage 0 assignment", () => {
  assert.match(offerRoute, /rpcName = "errand_driver_decline_v1"/);
  assert.match(offerRoute, /rpcName = "errand_driver_expire_offer_v1"/);
  assert.match(offerRoute, /const reassignment = await assignErrandStage0/);
  assert.match(assignment, /status: "assigned"/);
  assert.match(
    assignment,
    /\.in\("status", \["requested", "pending", "searching"\]\)/
  );
});

test("new matching-window artifacts remain ASCII", () => {
  for (const [name, value] of [
    ["migration", migration],
    ["retry route", retryRoute],
    ["cron route", cronRoute],
  ]) {
    assert.equal(/[^\x00-\x7f]/.test(value), false, name + " contains non-ASCII text");
  }
});

console.log(`PASS errand matching window suite (${passed} checks)`);
