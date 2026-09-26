const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");

const root = path.resolve(__dirname, "../..");
let passed = 0;

function test(name, run) {
  run();
  passed += 1;
  console.log("PASS " + name);
}

function loadResolver() {
  const file = path.join(root, "lib/driver/standbyDispatch.ts");
  const source = fs.readFileSync(file, "utf8");
  const module = { exports: {} };
  const req = (name) => {
    if (name === "@/lib/location/coordinateValidity") {
      return {
        parseUsableCoordinatePair(lat, lng) {
          const a = Number(lat);
          const b = Number(lng);
          if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
          if (a < -90 || a > 90 || b < -180 || b > 180) return null;
          if (a === 0 && b === 0) return null;
          return { lat: a, lng: b };
        },
      };
    }
    return require(name);
  };
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;
  vm.runInNewContext(code, {
    module,
    exports: module.exports,
    require: req,
    Date,
    Number,
    String,
    Map,
    Set,
    Error,
  }, { filename: file });
  return module.exports;
}

const api = loadResolver();
const now = Date.parse("2026-09-27T00:00:00.000Z");
const driver = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function location(updatedAt, lat = 16.68, lng = 121.22) {
  return {
    driver_id: driver,
    lat,
    lng,
    town: "Lamut",
    updated_at: updatedAt,
  };
}

function standby(overrides = {}) {
  return {
    driver_id: driver,
    home_lat: 16.6800373,
    home_lng: 121.2273725,
    town: "Lamut",
    confirmed_at: "2026-09-26T23:50:00.000Z",
    expires_at: "2026-09-27T00:20:00.000Z",
    consumed_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

test("fresh live GPS always wins over active standby", () => {
  const result = api.resolveDriverDispatchLocationCandidate(
    location("2026-09-26T23:59:30.000Z"),
    standby(),
    now,
    120
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "live_gps");
  assert.equal(result.lat, 16.68);
});

test("stale live GPS can use explicitly confirmed standby", () => {
  const result = api.resolveDriverDispatchLocationCandidate(
    location("2026-09-26T23:40:00.000Z"),
    standby(),
    now,
    120
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "standby");
  assert.equal(result.lat, 16.6800373);
  assert.equal(result.standbyConfirmedAt, "2026-09-26T23:50:00.000Z");
});

test("a later accepted GPS fix permanently supersedes standby", () => {
  const result = api.resolveDriverDispatchLocationCandidate(
    location("2026-09-26T23:55:00.000Z"),
    standby(),
    Date.parse("2026-09-27T00:10:00.000Z"),
    120
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "live_gps_newer_than_standby");
});

test("expired standby cannot dispatch", () => {
  const result = api.resolveDriverDispatchLocationCandidate(
    location("2026-09-26T23:40:00.000Z"),
    standby({ expires_at: "2026-09-26T23:59:59.000Z" }),
    now,
    120
  );
  assert.equal(result.ok, false);
  assert.equal(result.reason, "standby_expired");
});

test("consumed or cancelled standby cannot be reused", () => {
  for (const row of [
    standby({ consumed_at: "2026-09-26T23:55:00.000Z" }),
    standby({ cancelled_at: "2026-09-26T23:55:00.000Z" }),
  ]) {
    const result = api.resolveDriverDispatchLocationCandidate(
      location("2026-09-26T23:40:00.000Z"),
      row,
      now,
      120
    );
    assert.equal(result.ok, false);
  }
});

test("standby can cover missing live coordinates without becoming GPS", () => {
  const result = api.resolveDriverDispatchLocationCandidate(
    location("2026-09-26T23:40:00.000Z", null, null),
    standby(),
    now,
    120
  );
  assert.equal(result.ok, true);
  assert.equal(result.source, "standby");
});

test("standby storage is separate from driver_locations", () => {
  const migration = fs.readFileSync(
    path.join(root, "supabase/migrations/20260927003000_driver_standby_dispatch_v1.sql"),
    "utf8"
  );
  assert.match(migration, /create table if not exists public\.driver_standby_sessions/i);
  assert.doesNotMatch(migration, /alter table public\.driver_locations/i);

  const route = fs.readFileSync(
    path.join(root, "app/api/driver/standby-location/route.ts"),
    "utf8"
  );
  assert.doesNotMatch(route, /from\("driver_locations"\)\s*\.update/s);
  assert.doesNotMatch(route, /from\("driver_locations"\)\s*\.upsert/s);
});

test("all initial dispatch paths resolve and consume standby", () => {
  for (const file of [
    "app/api/dispatch/auto-assign/route.ts",
    "lib/errand/assignStage0V2.ts",
    "lib/agrimarket/dispatch.ts",
  ]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.match(source, /resolveDriverDispatchLocations/);
    assert.match(source, /consumeDriverStandbyLocation/);
  }
});

test("standby activation verifies the saved Home town server-side", () => {
  const route = fs.readFileSync(
    path.join(root, "app/api/driver/standby-location/route.ts"),
    "utf8"
  );
  assert.match(route, /api\.mapbox\.com\/geocoding\/v5\/mapbox\.places/);
  assert.match(route, /types=place/);
  assert.match(route, /HOME_LOCATION_TOWN_MISMATCH/);
  assert.match(route, /HOME_OUTSIDE_SERVICE_TOWN/);
});

test("standby remains initial-dispatch only", () => {
  const treeFiles = [
    "app/api/driver/location/ping/route.ts",
    "lib/driver-tracking.ts",
  ];
  for (const file of treeFiles) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.doesNotMatch(source, /driver_standby_sessions/);
    assert.doesNotMatch(source, /resolveDriverDispatchLocations/);
  }
});

test("leaving online duty cancels active standby", () => {
  const migration = fs.readFileSync(
    path.join(
      root,
      "supabase/migrations/20260927013000_driver_standby_cancel_on_duty_exit_v1.sql"
    ),
    "utf8"
  );

  assert.match(
    migration,
    /after\s+insert\s+or\s+update\s+of\s+status[\s\S]*on\s+public\.driver_locations/i
  );
  assert.match(
    migration,
    /not\s+in\s*\(\s*'online'\s*,\s*'available'\s*,\s*'idle'\s*,\s*'waiting'\s*\)/i
  );
  assert.match(migration, /update\s+public\.driver_standby_sessions/i);
  assert.match(migration, /cancel_reason\s*=\s*'duty_left_online'/i);
  assert.match(migration, /consumed_at\s+is\s+null/i);
  assert.match(migration, /cancelled_at\s+is\s+null/i);
  assert.match(migration, /expires_at\s*>\s*now\(\)/i);
});

console.log("\n" + passed + " driver standby regression groups passed.");
