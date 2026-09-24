const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const root = path.resolve(__dirname, "../..");
let count = 0;
async function test(name, run) { await run(); console.log("PASS " + name); count++; }
function load(file, mocks = {}, cache = new Map()) {
  if (cache.has(file)) return cache.get(file);
  const module = { exports: {} };
  const result = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    reportDiagnostics: true,
  });
  assert.equal(result.diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0, file);
  vm.runInNewContext(result.outputText, {
    module, exports: module.exports, URL, Date, console, process: { env: { SUPABASE_URL: "https://fixture.supabase.co" } },
    require(name) {
      if (name in mocks) return mocks[name];
      if (name.startsWith("@/") || name.startsWith(".")) {
        let target = name.startsWith("@/") ? name.slice(2) : path.posix.join(path.posix.dirname(file), name);
        if (!path.extname(target)) target += ".ts";
        return load(target, mocks, cache);
      }
      return require(name);
    },
  }, { filename: file });
  cache.set(file, module.exports);
  return module.exports;
}
const uid = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const profile = {
  user_id: uid, display_name: "Display Alias", verified_full_name: "Approved Name", phone: "09123456789",
  town: "Banaue", barangay: null, account_created_at: "2026-08-01T00:00:00Z", verification_status: "approved",
  verified_at: "2026-08-02T00:00:00Z", verification_submitted_at: "2026-08-01T00:00:00Z",
  verification_source: "passenger_verification_requests", verification_record_id: uid, id_type: null,
  has_id_front: true, has_id_back: false, has_selfie: true, identity_name_mismatch: true, verification_record_conflict: false,
};
const requestRow = { passenger_id: uid, id_front_path: "id_front/" + uid + "/id.jpg", id_back_path: null,
  selfie_with_id_path: "selfie_with_id/" + uid + "/selfie.jpg", updated_at: "2026-08-02T00:00:00Z" };
const lookupRoute = "app/api/admin/analytics/v3/passengers/route.ts";
const evidenceRoute = "app/api/admin/passenger-verifications/evidence/route.ts";
const pendingRoute = "app/api/admin/passenger-verifications/pending/route.ts";
function harness(options = {}) {
  const calls = [];
  const tables = {
    passenger_identity_v1: options.missing ? [] : [{ ...profile, id_number: "MUST_NOT_LEAK", id_front_path: "MUST_NOT_LEAK" }],
    passenger_recent_activity_v1: options.activities || [],
    passenger_verification_requests: options.request === null ? [] : [options.request || requestRow],
    passenger_verifications: options.legacy ? [options.legacy] : [],
    ...options.tables,
  };
  function builder(table, rows) {
    let columns, mode = "read";
    const filters = [];
    const q = {
      select(value) { columns = value; calls.push({ select: value, table }); return q; },
      eq(key, value) { filters.push([key, value]); calls.push({ filter: key, value, table }); return q; },
      order(key, value) { calls.push({ order: key, value, table }); return q; },
      limit(value) { calls.push({ limit: value, table }); return q; },
      insert(value) { mode = "insert"; calls.push({ insert: value, table }); return q; },
      then(resolve) {
        if (options.failTable === table || (table === "admin_audit_logs" && options.auditFailure)) return Promise.resolve({ error: { message: "PRIVATE_DATABASE_ERROR" }, data: null }).then(resolve);
        let data = (rows || []).filter((row) => filters.every(([k, v]) => row[k] === v));
        if (columns) data = data.map((row) => Object.fromEntries(columns.split(",").filter((key) => key in row).map((key) => [key, row[key]])));
        return Promise.resolve({ error: null, data: mode === "insert" ? null : data }).then(resolve);
      },
      async maybeSingle() { const result = await q; return { ...result, data: result.data?.[0] || null }; },
    };
    return q;
  }
  const db = {
    from(table) { calls.push({ table }); return builder(table, tables[table]); },
    rpc(name, args) { calls.push({ rpc: name, args }); return builder("rpc", options.matches || [profile]); },
    storage: { from(bucket) { return { async createSignedUrl(file, ttl) {
      calls.push({ sign: file, bucket, ttl });
      return options.signFailure ? { error: { message: "PRIVATE_STORAGE_ERROR" } } : { data: { signedUrl: "https://fixture.supabase.co/signed-test" } };
    } }; } },
  };
  const user = options.anonymous ? null : { id: "staff-google-subject", email: "staff@example.test", role: options.role || "admin" };
  const mocks = {
    "@/auth": { auth: async () => user ? { user } : null },
    "@/lib/supabaseAdmin": { supabaseAdmin: () => { calls.push({ client: true }); return db; } },
    "next/server": { NextResponse: { json: (body, init) => ({ body, status: init.status, headers: init.headers }) } },
  };
  function req(query = "", body = {}) {
    return { url: "https://app.example.test/api" + query, headers: { get: (name) => name === "origin" ? (options.origin || "https://app.example.test") : null }, json: async () => body };
  }
  return { calls, get: (query) => load(lookupRoute, mocks).GET(req(query)),
    evidence: (body = { passenger_id: uid, kind: "id_front" }) => load(evidenceRoute, mocks).POST(req("", body)),
    pending: () => load(pendingRoute, mocks).GET() };
}
(async () => {
  await test("anonymous callers cannot search, inspect profiles, list queue or open evidence", async () => {
    const h = harness({ anonymous: true });
    for (const r of [await h.get("?q=Name"), await h.get("?passenger_id=" + uid), await h.pending(), await h.evidence()]) {
      assert.equal(r.status, 401); assert.match(r.headers["Cache-Control"], /no-store/);
    }
    assert.equal(h.calls.length, 0);
  });
  await test("passenger and ordinary user sessions cannot obtain passenger identities", async () => {
    for (const role of ["passenger", "user"]) { const h = harness({ role }); assert.equal((await h.get("?q=Name")).status, 403); assert.equal((await h.pending()).status, 403); assert.equal(h.calls.length, 0); }
  });
  await test("dispatcher cannot obtain evidence even with a valid UUID and email", async () => {
    const h = harness({ role: "dispatcher" }); assert.equal((await h.evidence()).status, 403); assert.equal(h.calls.length, 0);
  });
  await test("search validates length and profile UUID before database access", async () => {
    for (const q of ["?q=x", "?q=" + "x".repeat(121), "?passenger_id=bad", ""]) {
      const h = harness(); assert.equal((await h.get(q)).status, 400); assert.equal(h.calls.length, 0);
    }
  });
  await test("search binds the exact input to the canonical RPC and caps returned accounts", async () => {
    const h = harness({ role: "dispatcher", matches: Array.from({ length: 26 }, (_, i) => ({ ...profile, display_name: String(i) })) });
    const text = "x),status.eq.approved,%_";
    const r = await h.get("?q=" + encodeURIComponent(text));
    assert.equal(r.status, 200); assert.equal(r.body.rows.length, 25); assert.equal(r.body.has_more, true);
    assert.equal(h.calls.find((c) => c.rpc).args.p_query, text);
    assert.equal(h.calls.find((c) => c.rpc).rpc, "search_passenger_identity_v1");
    assert.equal(h.calls.some((c) => ["passenger_profiles", "passenger_verifications", "passenger_verification_requests"].includes(c.table)), false);
  });
  await test("profile projects safe fields and bounds activity to the requested account", async () => {
    const h = harness({ role: "dispatcher" }), r = await h.get("?passenger_id=" + uid);
    assert.equal(r.status, 200); assert.equal(r.body.profile.display_name, "Display Alias"); assert.equal(r.body.profile.verified_full_name, "Approved Name");
    assert.equal(r.body.can_view_evidence, false); assert.equal(JSON.stringify(r.body).includes("MUST_NOT_LEAK"), false);
    assert.ok(h.calls.some((c) => c.table === "passenger_recent_activity_v1" && c.filter === "user_id" && c.value === uid));
    assert.ok(h.calls.some((c) => c.table === "passenger_recent_activity_v1" && c.limit === 51));
  });
  await test("missing profiles return 404 without scanning activity", async () => {
    const h = harness({ missing: true }); assert.equal((await h.get("?passenger_id=" + uid)).status, 404);
    assert.equal(h.calls.some((c) => c.table === "passenger_recent_activity_v1"), false);
  });
  await test("identity errors fail closed and do not leak database error text", async () => {
    const h = harness({ failTable: "passenger_identity_v1" }), r = await h.get("?passenger_id=" + uid);
    assert.equal(r.status, 503); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
  });
  await test("activity failures are explicit while the verified profile remains usable", async () => {
    const r = await harness({ failTable: "passenger_recent_activity_v1" }).get("?passenger_id=" + uid);
    assert.equal(r.status, 200); assert.ok(r.body.profile); assert.ok(r.body.activity_error);
  });
  await test("activity truncation is disclosed", async () => {
    const r = await harness({ activities: Array.from({ length: 51 }, (_, n) => ({ user_id: uid, activity_id: String(n) })) }).get("?passenger_id=" + uid);
    assert.equal(r.body.activity.length, 50); assert.equal(r.body.activity_has_more, true);
  });
  await test("cross-origin evidence requests fail before database access", async () => {
    const h = harness({ origin: "https://untrusted.example" }); assert.equal((await h.evidence()).status, 403); assert.equal(h.calls.length, 0);
  });
  await test("invalid evidence selectors fail before database access", async () => {
    for (const body of [{ passenger_id: "invalid", kind: "id_front" }, { passenger_id: uid, kind: "../private" }]) {
      const h = harness(); assert.equal((await h.evidence(body)).status, 400); assert.equal(h.calls.length, 0);
    }
  });
  await test("evidence access is audited before a 60-second link is issued", async () => {
    const h = harness(), r = await h.evidence();
    assert.equal(r.status, 200); assert.match(r.headers["Cache-Control"], /no-store/);
    const auditIndex = h.calls.findIndex((c) => c.insert), signIndex = h.calls.findIndex((c) => c.sign);
    assert.ok(auditIndex >= 0 && auditIndex < signIndex); assert.equal(h.calls[signIndex].ttl, 60);
    assert.equal(h.calls[auditIndex].insert.entity_id, uid); assert.equal(h.calls[auditIndex].insert.actor, "staff@example.test");
    assert.equal(JSON.stringify(h.calls[auditIndex]).includes("id.jpg"), false); assert.equal(JSON.stringify(r.body).includes("id_front_path"), false);
  });
  await test("audit failure prevents all signing and returns a retryable error", async () => {
    const h = harness({ auditFailure: true }), r = await h.evidence();
    assert.equal(r.status, 503); assert.equal(h.calls.some((c) => c.sign), false); assert.equal(r.body.url, undefined);
  });
  await test("storage failure never exposes a link or provider error", async () => {
    const r = await harness({ signFailure: true }).evidence(); assert.equal(r.status, 503);
    assert.equal(r.body.url, undefined); assert.equal(JSON.stringify(r.body).includes("PRIVATE"), false);
  });
  await test("request records suppress stale legacy evidence fallback", async () => {
    const h = harness({ request: { ...requestRow, id_front_path: null }, legacy: { user_id: uid, id_photo_url: uid + "/legacy.jpg" } });
    assert.equal((await h.evidence()).status, 404); assert.equal(h.calls.some((c) => c.table === "passenger_verifications"), false);
  });
  await test("other passengers' paths fail closed without audit or signing", async () => {
    const h = harness({ request: { ...requestRow, id_front_path: "id_front/" + other + "/id.jpg" } });
    assert.equal((await h.evidence()).status, 409); assert.equal(h.calls.some((c) => c.sign || c.insert), false);
  });
  await test("legacy private-bucket public-format URL is re-signed after ownership validation", async () => {
    const h = harness({ request: null, legacy: { user_id: uid, id_photo_url: "https://fixture.supabase.co/storage/v1/object/public/passenger-ids/" + uid + "/id.jpg" } });
    assert.equal((await h.evidence()).status, 200); assert.equal(h.calls.find((c) => c.sign).sign, uid + "/id.jpg");
  });
  await test("queue returns presence flags without paths or automatic signed URLs for either staff role", async () => {
    for (const role of ["admin", "dispatcher"]) {
      const h = harness({ role, request: { ...requestRow, status: "submitted", full_name: "Submitted Name" } }), r = await h.pending();
      assert.equal(r.status, 200); assert.equal(r.body.rows.submitted[0].can_view_evidence, role === "admin");
      assert.equal(r.body.rows.submitted[0].has_id_front, true); assert.equal(JSON.stringify(r.body).includes("id_front/"), false);
      assert.equal(JSON.stringify(r.body).includes("signed_url"), false); assert.equal(h.calls.some((c) => c.sign), false);
    }
  });
  await test("evidence path parser rejects external URLs, traversal and malformed ownership", () => {
    const { evidenceLocation } = load("lib/passenger/identity.ts");
    const base = "https://fixture.supabase.co";
    for (const bad of ["https://evil.example/id.jpg", "id_front/" + other + "/id.jpg", uid + "/../id.jpg", uid + "/%2e%2e", uid + "/a?token=x", uid + "\\id.jpg", uid + "/id.jpg\nprivate"]) {
      assert.equal(evidenceLocation(bad, uid, "id_front", true, base), null);
    }
    assert.ok(evidenceLocation("id_front/" + uid + "/a.jpg", uid, "id_front", false, base));
    assert.ok(evidenceLocation(uid + "/a.jpg", uid, "id_front", false, base));
  });
  await test("lookup page renders the search controls without embedding passenger data", () => {
    const page = load("app/admin/analytics-v3/passengers/page.tsx", { "@/app/components/PassengerEvidence": { default: () => null } }).default;
    const html = require("react-dom/server").renderToStaticMarkup(require("react").createElement(page));
    assert.match(html, /Passenger Lookup/); assert.match(html, /passenger-search/); assert.match(html, /booking\/order code/);
    assert.equal(html.includes(uid), false);
  });
  await test("legacy raw-path signer cannot bypass passenger evidence auditing", async () => {
    let clients = 0;
    const api = load("app/api/admin/verification/file-url/route.ts", {
      "@/auth": { auth: async () => ({ user: { role: "admin" } }) },
      "../../../../../auth": { auth: async () => ({ user: { role: "admin" } }) },
      "@supabase/supabase-js": { createClient: () => { clients++; throw new Error("Must not create a signer"); } },
      "next/server": { NextResponse: { json: (body, init) => ({ body, status: init.status, headers: init.headers }) } },
    });
    for (const bucket of ["passenger-ids", "passenger-selfies"]) {
      const r = await api.GET({ url: "https://app.example.test/api?bucket=" + bucket + "&path=" + uid + "/id.jpg" });
      assert.equal(r.status, 410); assert.match(r.headers["Cache-Control"], /no-store/);
    }
    for (const [bucket, objectPath] of [
      ["passenger%2dids", uid + "/id.jpg"],
      ["other", "../passenger-ids/" + uid + "/id.jpg"],
      ["other", "%2e%2e/passenger-ids/" + uid + "/id.jpg"],
      ["other/../passenger-ids", uid + "/id.jpg"],
    ]) {
      const r = await api.GET({ url: "https://app.example.test/api?bucket=" + encodeURIComponent(bucket) + "&path=" + encodeURIComponent(objectPath) });
      assert.equal(r.status, 400);
    }
    assert.equal(clients, 0);
  });
  console.log("PASS passenger lookup: " + count + " checks");
  // A public, non-sensitive build receipt makes hosted test execution verifiable.
  if (process.env.VERCEL_GIT_COMMIT_SHA) {
    fs.writeFileSync(path.join(root, "public/passenger-lookup-build.json"), JSON.stringify({
      suite: "passenger-lookup", status: "passed", checks: count,
      source_sha: process.env.VERCEL_GIT_COMMIT_SHA,
    }) + "\n");
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
