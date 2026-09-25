const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
function harness(options = {}) {
  const calls = [];
  const owner = options.owner || A;
  const rows = options.rows || [
    { id: "ride-a", booking_code: "JR-A", created_by_user_id: A, service_type: "tricycle", status: "completed" },
    { id: "ride-b", booking_code: "JR-B", created_by_user_id: B, service_type: "motorcycle", status: "completed" },
    { id: "food-a", booking_code: "TO-A", created_by_user_id: A, service_type: "takeout", status: "completed" },
    { id: "food-b", booking_code: "TO-B", created_by_user_id: B, service_type: "takeout", status: "completed" },
  ];
  function query(table) {
    const filters = []; let one = false, mode = "read", limit = Infinity, rideOnly = false;
    const q = {
      select() { return q; }, eq(k, v) { filters.push([k, v]); return q; },
      in(k, values) { filters.push([k, values]); return q; },
      is(k, v) { filters.push([k, v]); return q; },
      or(value) { if (value.includes("service_type.in.")) rideOnly = true; return q; },
      limit(n) { limit = n; return q; }, order() { return q; },
      maybeSingle() { one = true; return q; }, single() { one = true; return q; },
      update() { mode = "update"; return q; }, insert() { mode = "insert"; return q; },
      then(resolve, reject) {
        return Promise.resolve().then(() => {
          calls.push({ table, filters, mode });
          if (options.queryError && table === "bookings") return { data: null, error: { code: "42501", message: "private database diagnostic" } };
          if (options.verificationError && table.startsWith("passenger_verif")) return { data: null, error: { code: "08006" } };
          let data = table === "bookings" ? rows :
            table === "passenger_verifications" ? (options.canonicalAbsent ? [] : [{ user_id: owner, status: options.status || "approved_admin" }]) :
            table === "passenger_verification_requests" ? [{ passenger_id: owner, status: options.legacyStatus || "submitted" }] : [];
          data = data.filter(row => filters.every(([key, val]) => Array.isArray(val) ? val.includes(row[key]) : row[key] === val));
          if (rideOnly) data = data.filter(row => ["ride","motorcycle","tricycle","kolong_kolong"].includes(row.service_type) || (row.service_type == null && row.booking_code.startsWith("JR-")));
          data = data.slice(0, limit);
          return { data: one ? (data[0] || null) : data, error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const user = { id: owner, user_metadata: { verified: true, verification_tier: "verified" } };
  const db = { from: query, rpc: async (name, args) => {
    calls.push({ rpc: name, args });
    return { data: { ok: !options.revoked }, error: options.deviceError ? { message: "offline" } : null };
  }};
  const bearer = { auth: { getUser: async token => ({ data: { user: token === "valid" ? user : null }, error: null }) } };
  const cookie = { auth: { getUser: async () => ({ data: { user: options.cookie ? user : null }, error: null }) } };
  class NextResponse {
    constructor(body, config = {}) { this.body = body; this.status = config.status || 200; this.headers = config.headers || {}; }
    static json(body, config) { return new NextResponse(body, config); }
  }
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
      reportDiagnostics: true,
    });
    assert.equal(code.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
    function req(name) {
      if (name === "next/server") return { NextResponse };
      if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: () => db };
      if (name === "@/utils/supabase/server") return { createClient: () => cookie };
      if (name === "@supabase/supabase-js") return { createClient: (_url, key) => key === "service" ? db : bearer };
      if (name === "@/auth") return { auth: async () => null };
      if (name === "@/lib/agrimarket/farmerSessionServer") return { readFarmerSession: async () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const stem = name.startsWith("@/") ? name.slice(2) : path.posix.join(path.posix.dirname(file), name);
        return load(path.extname(stem) ? stem : stem + ".ts");
      }
      return require(name);
    }
    vm.runInNewContext(code.outputText, { module, exports: module.exports, require: req, URL, Date, Headers, console,
      process: { env: { SUPABASE_URL: "https://fixture.invalid", NEXT_PUBLIC_SUPABASE_URL: "https://fixture.invalid",
        SUPABASE_SERVICE_ROLE_KEY: "service", NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon" } },
    }, { filename: file });
    return module.exports;
  }
  function request(query = "", authorization = "Bearer valid", body = {}) {
    const headers = new Headers();
    if (authorization !== null) headers.set("authorization", authorization);
    if (options.device) headers.set("x-device-id", "fixture-device");
    return { url: "https://fixture.invalid/?" + query, headers, json: async () => body };
  }
  return { load, request, calls, db };
}
(async () => {
  const ride = "app/api/rides/list/route.ts", food = "app/api/takeout/orders/route.ts";
  for (const file of [ride, food]) {
    await test(file + " rejects anonymous users before reading bookings", async () => {
      const h = harness(); const r = await h.load(file).GET(h.request("", null));
      assert.equal(r.status, 401); assert.equal(h.calls.length, 0);
    });
    await test(file + " rejects invalid bearer even with another valid cookie", async () => {
      const h = harness({ cookie: true }); const r = await h.load(file).GET(h.request("", "Bearer invalid"));
      assert.equal(r.status, 401); assert.equal(h.calls.length, 0);
    });
    await test(file + " uses token identity and ignores forged user_id", async () => {
      const h = harness(); const r = await h.load(file).GET(h.request("user_id=" + B));
      assert.equal(r.status, 200);
      const rows = r.body.data || r.body.orders;
      assert.equal(rows.length, 1); assert.equal(rows[0].created_by_user_id, A);
      assert(h.calls.filter(c => c.table === "bookings").every(c => c.filters.some(([k,v]) => k === "created_by_user_id" && v === A)));
    });
    await test(file + " new account starts empty", async () => {
      const h = harness({ owner: "new-account" }); const r = await h.load(file).GET(h.request());
      assert.equal(r.status, 200); assert.equal((r.body.data || r.body.orders).length, 0);
    });
    await test(file + " cannot open another passenger's booking code", async () => {
      const h = harness(); const r = await h.load(file).GET(h.request("booking_code=" + (file === ride ? "JR-B" : "TO-B")));
      assert.equal(r.status, 200); assert.equal((r.body.data || r.body.orders).length, 0);
    });
    await test(file + " supports validated cookie sessions", async () => {
      const h = harness({ cookie: true }); const r = await h.load(file).GET(h.request("", null));
      assert.equal(r.status, 200); assert.equal((r.body.data || r.body.orders).length, 1);
    });
    await test(file + " revoked device is blocked before bookings", async () => {
      const h = harness({ device: true, revoked: true }); const r = await h.load(file).GET(h.request());
      assert.equal(r.status, 401); assert(!h.calls.some(c => c.table));
    });
  }
  await test("ride list excludes owned takeout while preserving regular vehicle types", async () => {
    const h = harness(); const r = await h.load(ride).GET(h.request());
    assert.equal(r.body.data[0].booking_code, "JR-A");
  });
  await test("ride query failure does not fall back to an unscoped table", async () => {
    const h = harness({ queryError: true }); const r = await h.load(ride).GET(h.request());
    assert.equal(r.status, 503); assert.equal(h.calls.length, 1);
    assert(!JSON.stringify(r.body).includes("private database"));
  });
  for (const code of ["TO-A", "TO-B"]) {
    await test("receipt ownership: " + code, async () => {
      const h = harness(); const r = await h.load("app/api/orders/[bookingCode]/route.ts").GET(h.request(), { params: { bookingCode: code } });
      assert.equal(r.status, code === "TO-A" ? 200 : 404);
    });
    await test("rating ownership: " + code, async () => {
      const h = harness(); const r = await h.load("app/api/orders/[bookingCode]/rating/route.ts").POST(h.request("", "Bearer valid", { rating: 5 }), { params: { bookingCode: code } });
      assert.equal(r.status, code === "TO-A" ? 200 : 404);
      assert.equal(h.calls.some(c => c.table === "order_ratings"), code === "TO-A");
    });
  }
  for (const status of ["submitted", "pending_admin", "rejected", "unverified", "approved", "approved_admin", "verified"]) {
    await test("AgriMarket verified-only guard uses review status: " + status, async () => {
      const h = harness({ status }); const r = await h.load("app/api/agrimarket/_lib/server.ts").requireAgrimarketPassenger(h.request(), true);
      assert.equal(r.ok, ["approved", "approved_admin", "verified"].includes(status));
      if (!r.ok) assert.equal(r.response.status, 403);
    });
  }
  await test("unverified passengers retain access to their existing order reads", async () => {
    const h = harness({ status: "submitted" }); const r = await h.load("app/api/agrimarket/_lib/server.ts").requireAgrimarketPassenger(h.request());
    assert.equal(r.ok, true); assert(!h.calls.some(c => c.table));
  });
  await test("legacy approval is used only when canonical review is absent", async () => {
    let h = harness({ canonicalAbsent: true, legacyStatus: "approved" });
    assert.equal((await h.load("app/api/agrimarket/_lib/server.ts").requireAgrimarketPassenger(h.request(), true)).ok, true);
    h = harness({ status: "rejected", legacyStatus: "approved" });
    assert.equal((await h.load("app/api/agrimarket/_lib/server.ts").requireAgrimarketPassenger(h.request(), true)).ok, false);
  });
  await test("verification lookup failure fails closed", async () => {
    const h = harness({ verificationError: true }); const r = await h.load("app/api/agrimarket/_lib/server.ts").requireAgrimarketPassenger(h.request(), true);
    assert.equal(r.ok, false); assert.equal(r.response.status, 503);
  });
  await test("checkout and quote explicitly select verified-only authorization", () => {
    for (const p of ["quote", "orders"]) {
      const source = fs.readFileSync(path.join(root, "app/api/agrimarket/" + p + "/route.ts"), "utf8");
      assert(source.includes("requireAgrimarketPassenger(req, true)"));
    }
  });
  await test("history details no longer trust the shared trip cache", () => {
    for (const p of ["app/history/page.tsx", "app/history/[ref]/page.tsx"]) {
      const source = fs.readFileSync(path.join(root,p),"utf8");
      assert(!source.includes("JRIDE_LAST_TRIPS_V1"));
      assert(source.includes("passengerAuthHeaders()"));
    }
  });
  console.log(passed + " passenger history/privacy regression groups passed; all data is synthetic.");
})().catch(error => { console.error(error); process.exitCode = 1; });
