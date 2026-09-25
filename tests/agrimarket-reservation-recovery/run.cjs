const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadTs(relativePath, dependencies = {}) {
  const filename = path.resolve(__dirname, "../..", relativePath);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, {
    module, exports: module.exports, Date, Number, String, Math, console,
    require(name) { if (name in dependencies) return dependencies[name]; throw Error(name); },
  }, { filename });
  return module.exports;
}

const { normalizeButchering } = loadTs("lib/agrimarket/butchering.ts");
const example = {
  species: "Pig", breed: "", description: "", butcher_start_at: "2026-09-27T02:00:00+08:00",
  butcher_end_at: null, order_cutoff_at: "2026-09-27T01:55:00+08:00",
  condition: "fresh", vehicle_requirement: "either", default_prep_minutes: 15,
  is_active: true, cuts: [{ name: "Head", price_per_kg: "200", available_kg: "2" }],
};
assert.equal(normalizeButchering(example).butcher_end_at, "2026-09-26T19:00:00.000Z");
assert.equal(normalizeButchering({ ...example, butcher_end_at: "2026-09-27T04:00:00+08:00" }).butcher_end_at, "2026-09-26T20:00:00.000Z");
assert.throws(() => normalizeButchering({ ...example, butcher_end_at: "2026-09-27T01:00:00+08:00" }));

const { scheduledHarvestAttention } = loadTs("lib/agrimarket/harvestAttention.ts");
const reservation = { fulfillment_mode: "scheduled_harvest", status: "awaiting_harvest",
  harvest_expected_start_at: "2026-09-26T18:00:00Z", harvest_expected_end_at: null };
const start = Date.parse(reservation.harvest_expected_start_at);
assert.equal(scheduledHarvestAttention(reservation, start - 31 * 60000), null);
assert.equal(scheduledHarvestAttention(reservation, start - 30 * 60000), "due_soon");
assert.equal(scheduledHarvestAttention(reservation, start + 59 * 60000), "in_window");
assert.equal(scheduledHarvestAttention(reservation, start + 60 * 60000), "overdue");
assert.equal(scheduledHarvestAttention({ ...reservation, status: "preparing" }, start + 60 * 60000), null);

async function routeCase({ denied = false, result = { ok: true, vehicle: "tricycle" } } = {}) {
  const calls = [];
  const route = loadTs("app/api/agrimarket/order-vehicle-switch/route.ts", {
    "../_lib/server": {
      agrimarketEnabled: () => true,
      requireAgrimarketPassenger: async () => denied
        ? { ok: false, response: { status: 401 } }
        : { ok: true, user: { id: "buyer-1" } },
      createServiceSupabase: () => ({ rpc: async (name, args) => {
        calls.push({ name, args }); return { data: result, error: null };
      } }),
      jsonNoStore: (status, body) => ({ status, body }),
    },
    "next/server": {},
  });
  const request = (body, origin = null) => ({ json: async () => body,
    headers: { get: () => origin }, nextUrl: { origin: "https://app.jride.net" } });
  return { calls, post: (body, origin) => route.POST(request(body, origin)) };
}

(async () => {
  const denied = await routeCase({ denied: true });
  assert.equal((await denied.post({ order_code: "AG-TEST", expected_vehicle: "motorcycle", expected_total: 446 })).status, 401);
  assert.equal(denied.calls.length, 0);

  const invalid = await routeCase();
  assert.equal((await invalid.post({ order_code: "AG-TEST", expected_vehicle: "motorcycle" })).status, 400);
  assert.equal(invalid.calls.length, 0);

  const crossOrigin = await routeCase();
  assert.equal((await crossOrigin.post({ order_code: "AG-TEST", expected_vehicle: "motorcycle", expected_total: 446 }, "https://other.example")).status, 403);
  assert.equal(crossOrigin.calls.length, 0);

  const allowed = await routeCase();
  assert.equal((await allowed.post({ order_code: "AG-TEST", expected_vehicle: "motorcycle", expected_total: 446 })).status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(allowed.calls[0])), { name: "agrimarket_customer_switch_to_tricycle_v1",
    args: { p_order_code: "AG-TEST", p_customer_user_id: "buyer-1", p_expected_vehicle: "motorcycle", p_expected_total: 446 } });

  const stale = await routeCase({ result: { ok: false, error: "AGRIMARKET_VEHICLE_SWITCH_STALE" } });
  assert.equal((await stale.post({ order_code: "AG-TEST", expected_vehicle: "motorcycle", expected_total: 446 })).status, 409);
  console.log("PASS: estimated window, reminder stages, and authenticated vehicle switch route");
})().catch(error => { console.error(error); process.exitCode = 1; });
