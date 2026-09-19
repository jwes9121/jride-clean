const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const filename = path.resolve(__dirname, "../../app/api/agrimarket/producer/orders/route.ts");
function load(mocks) {
  const module = { exports: {} };
  const source = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, { module, exports: module.exports, require: name => {
    if (!(name in mocks)) throw new Error("Unexpected dependency: " + name);
    return mocks[name];
  }, Date, console }, { filename });
  return module.exports;
}
const owner = "farm-a";
function makeHarness(load, options = {}) {
  const rows = options.rows || [];
  const calls = [];
  const db = {
    async rpc(name) { calls.push(name); return { error: options.expiryError ? { message: "expiry unavailable" } : null }; },
    from(table) {
      calls.push(table);
      let result = table === "agrimarket_orders" ? [...rows] : table === "agrimarket_order_items" ? (options.items || []) : [];
      let selected = [];
      const sorts = [];
      const q = {
        select(columns) { selected = columns.split(","); return q; },
        eq(column, value) { result = result.filter(row => row[column] === value); return q; },
        in(column, values) { result = result.filter(row => values.includes(row[column])); return q; },
        order(column, config) { sorts.push([column, config?.ascending]); return q; },
        range(from, to) { result = result.slice().sort((a,b) => {
          for (const [column, ascending] of sorts) {
            const d = String(a[column] || "").localeCompare(String(b[column] || ""));
            if (d) return ascending ? d : -d;
          }
          return 0;
        }).slice(from, to + 1); return q; },
        then(resolve, reject) { return Promise.resolve({
          data: result.map(row => Object.fromEntries(selected.map(key => [key, row[key]]))),
          error: options.orderError && table === "agrimarket_orders" ? { message: "read unavailable" } : null,
        }).then(resolve, reject); },
      };
      return q;
    },
  };
  const api = load({
    "../../_lib/server": {
      agrimarketFarmerPortalEnabled: () => true,
      agrimarketFarmerPortalDisabledResponse: () => ({ status: 503 }),
      agrimarketEnabled: () => true,
      createServiceSupabase: () => db,
      requireAgrimarketProducer: async () => options.denied
        ? { ok: false, response: { status: 401 } } : { ok: true, producer: { id: owner } },
      jsonNoStore: (status, body) => ({ status, body }),
    },
    "@/lib/agrimarket/schedule": { scheduledActivity: () => "harvest" },
    "next/server": {},
  });
  const request = (query = "") => ({ nextUrl: new URL("https://app.jride.net/api/agrimarket/producer/orders" + query) });
  return { get: query => api.GET(request(query)), calls };
}
function order(id, status, producer = owner) {
  return { id, order_code: id, producer_id: producer, status, created_at: "2026-09-20T00:00:00.000Z",
    product_subtotal: 100, fulfillment_mode: "always_available", cancel_reason: "customer_cancelled",
    cancelled_at: "2026-09-20T00:10:00.000Z", producer_timeout_at: "2026-09-20T00:05:00.000Z" };
}
async function runTests(load, assert, report) {
  const history = ["completed", "cancelled", "producer_rejected", "producer_timeout"];
  const active = ["awaiting_producer", "awaiting_harvest", "producer_accepted", "preparing",
    "awaiting_customer_reapproval", "ready_for_dispatch", "dispatching", "driver_assigned",
    "picked_up", "delivering", "delivered", "exception"];
  const rows = [...history, ...active].map((status, i) => order(String(i), status));
  const h = makeHarness(load, { rows: [...rows, order("other-farm-private", "cancelled", "farm-b")],
    items: [{ order_id: "1", product_id: "tomatoes", product_name: "Tomatoes", quantity: 1,
      unit_price: 100, line_total: 100, selling_unit: "kg" },
      { order_id: "other-farm-private", product_id: "private", product_name: "Private item" }] });
  const closed = await h.get("?view=history");
  assert.equal(closed.status, 200);
  assert.equal(JSON.stringify(closed.body.orders.map(row => row.status).sort()), JSON.stringify(history.slice().sort()));
  assert.equal(closed.body.orders.find(row => row.status === "cancelled").cancel_reason, "customer_cancelled");
  assert.equal(closed.body.orders.find(row => row.status === "cancelled").items[0].product_name, "Tomatoes");
  assert.equal(JSON.stringify(closed.body).includes("other-farm-private"), false);
  assert.equal(JSON.stringify(closed.body).includes("Private item"), false);
  report("history includes all terminal outcomes, reasons and items for the authenticated farmer only");
  const open = await h.get("?view=active");
  assert.equal(JSON.stringify(open.body.orders.map(row => row.status).sort()), JSON.stringify(active.slice().sort()));
  report("active requests, customer reapproval, delivered settlement and exceptions stay outside history");
  const legacy = await h.get();
  assert.equal(legacy.body.orders.length, history.length + active.length);
  report("default feed remains compatible and now includes previously hidden outcomes");
  const many = Array.from({ length: 57 }, (_,i) => order(String(i).padStart(3,"0"), history[i % history.length]));
  const paging = makeHarness(load, { rows: [...many, order("active", "awaiting_producer")] });
  const pages = await Promise.all([0,1,2].map(page => paging.get("?view=history&page=" + page)));
  assert.equal(JSON.stringify(pages.map(p => p.body.orders.length)), JSON.stringify([25,25,7]));
  assert.equal(JSON.stringify(pages.map(p => p.body.has_more)), JSON.stringify([true,true,false]));
  assert.equal(new Set(pages.flatMap(p => p.body.orders.map(row => row.order_code))).size, 57);
  assert.equal((await paging.get("?view=active")).body.orders[0].order_code, "active");
  report("history pages cover more than 50 orders without duplicates or crowding out active requests");
  for (const query of ["?view=unknown", "?view=history&page=-1", "?view=history&page=1.5", "?view=history&page=oops"]) {
    assert.equal((await h.get(query)).status, 400);
  }
  report("invalid views and page values are rejected");
  const denied = makeHarness(load, { denied: true });
  assert.equal((await denied.get("?view=history")).status, 401);
  assert.equal(denied.calls.length, 0);
  report("unauthenticated history requests never query orders");
  assert.equal((await makeHarness(load, { expiryError: true }).get("?view=history")).status, 503);
  assert.equal((await makeHarness(load, { orderError: true }).get("?view=history")).status, 500);
  report("database failures are surfaced instead of being reported as empty history");
}

runTests(load, assert, message => console.log("PASS " + message))
  .catch(error => { console.error(error); process.exitCode = 1; });
