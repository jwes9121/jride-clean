const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm"), ts = require("typescript");
const root = path.resolve(__dirname, "../..");
const forgot = "app/api/public/auth/forgot-password/route.ts";
const reset = "app/api/public/auth/reset-password/route.ts";
const email = "mailbox@example.test";
const A = { id: "account-a", email: "p_639171110001@phone.jride.local", user_metadata: { contact_email: email, phone: "+639171110001" } };
const B = { id: "account-b", email: "p_639172220002@phone.jride.local", user_metadata: { contact_email: "second@example.test", phone: "+639172220002" } };
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log("PASS " + name); }
function harness(options = {}) {
  const users = options.users || [A, B], sent = [], inserts = [], updates = [], marks = [];
  const tokenRows = options.tokenRows || [{ id: "reset-row", user_id: A.id, token: "fixture-token", used: false, expires_at: "2099-01-01T00:00:00Z" }];
  const admin = {
    auth: { admin: {
      listUsers: async ({ page, perPage }) => options.listError
        ? { data: null, error: { message: "internal auth diagnostic" } }
        : { data: { users: options.infinitePages ? Array.from({ length: perPage }, (_, i) => ({ id: "filler-" + page + "-" + i, email: "other@example.test" }))
            : users.slice((page - 1) * perPage, page * perPage) }, error: null },
      updateUserById: async (id, values) => {
        updates.push({ id, values });
        return options.updateError ? { data: null, error: { message: "update failed" } }
          : { data: { user: users.find(u => u.id === id) }, error: null };
      },
    } },
    from(table) {
      assert.equal(table, "password_reset_tokens");
      return {
        insert: async row => { inserts.push(row); return { error: null }; },
        select() { return { eq(key, value) { return { limit: async () => ({ data: tokenRows.filter(r => r[key] === value), error: null }) }; } }; },
        update(values) { return { eq: async (key, value) => { marks.push({ key, value, values }); return { error: null }; } }; },
      };
    },
  };
  class NextResponse {
    constructor(body, config = {}) { this.body = body; this.status = config.status || 200; }
    static json(body, config) { return new NextResponse(body, config); }
  }
  const cache = new Map();
  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} }; cache.set(file, module);
    const compiled = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
      reportDiagnostics: true,
    });
    assert.equal(compiled.diagnostics.filter(d => d.category === ts.DiagnosticCategory.Error).length, 0, file);
    function req(name) {
      if (name === "next/server") return { NextResponse };
      if (name === "@supabase/supabase-js") return { createClient: () => admin };
      if (name === "@/utils/email/sendEmail") return { sendEmail: async payload => { sent.push(payload); return { id: "mail" }; } };
      if (name.startsWith("@/")) return load(name.slice(2) + ".ts");
      return require(name);
    }
    vm.runInNewContext(compiled.outputText, { module, exports: module.exports, require: req, Date, console,
      process: { env: { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-service" } },
    }, { filename: file });
    return module.exports;
  }
  return { sent, inserts, updates, marks, load, post: (file, body) => load(file).POST({ json: async () => body }) };
}
(async () => {
  await test("mismatched mobile and recovery email never sends a reset for another account", async () => {
    const h = harness(), r = await h.post(forgot, { phone: "09172220002", email });
    assert.equal(r.status, 200); assert.equal(r.body.ok, true);
    assert.equal(h.inserts.length, 0); assert.equal(h.sent.length, 0);
  });
  await test("normal mobile formats resolve to the same recovery account", async () => {
    for (const phone of ["09171110001", "+639171110001", "639171110001", "9171110001", "0917 111 0001"]) {
      const h = harness(), r = await h.post(forgot, { phone, email: " MAILBOX@EXAMPLE.TEST " });
      assert.equal(r.status, 200); assert.equal(h.inserts.length, 1); assert.equal(h.inserts[0].user_id, A.id);
      assert.equal(h.sent.length, 1); assert(h.sent[0].html.includes("mobile number ending 0001"));
    }
  });
  await test("a shared recovery email selects only the supplied mobile account", async () => {
    const sharedB = { ...B, user_metadata: { ...B.user_metadata, contact_email: email } };
    const h = harness({ users: [A, sharedB] });
    await h.post(forgot, { phone: "09172220002", email });
    assert.equal(h.inserts.length, 1); assert.equal(h.inserts[0].user_id, B.id);
    assert(h.sent[0].html.includes("mobile number ending 0002"));
  });
  await test("email-only legacy requests work for a unique linked account", async () => {
    const h = harness(); await h.post(forgot, { email });
    assert.equal(h.inserts[0].user_id, A.id); assert.equal(h.sent.length, 1);
  });
  await test("email-only shared mailboxes never select the first account", async () => {
    const sharedB = { ...B, user_metadata: { contact_email: email } };
    const h = harness({ users: [A, sharedB] }); const r = await h.post(forgot, { email });
    assert.equal(r.status, 200); assert.equal(h.sent.length, 0); assert.equal(h.inserts.length, 0);
  });
  await test("duplicate recovery emails on later pages are also rejected", async () => {
    const filler = Array.from({ length: 99 }, (_, i) => ({ id: "filler-" + i, email: "unrelated@example.test" }));
    const h = harness({ users: [A, ...filler, { ...B, user_metadata: { contact_email: email } }] });
    await h.post(forgot, { email });
    assert.equal(h.sent.length, 0); assert.equal(h.inserts.length, 0);
  });
  await test("recovery finds the exact mobile account on a later page", async () => {
    const filler = Array.from({ length: 100 }, (_, i) => ({ id: "filler-" + i, email: "unrelated@example.test" }));
    const h = harness({ users: [...filler, A] }); await h.post(forgot, { phone: "09171110001", email });
    assert.equal(h.inserts[0].user_id, A.id);
  });
  await test("unknown and mismatched details return the same private confirmation", async () => {
    const h = harness();
    const mismatch = await h.post(forgot, { phone: "09172220002", email });
    const unknown = await h.post(forgot, { phone: "09173330003", email: "unknown@example.test" });
    assert.equal(JSON.stringify(mismatch.body), JSON.stringify(unknown.body));
    assert.equal(h.sent.length, 0);
  });
  await test("invalid mobile values never start recovery", async () => {
    for (const phone of ["123", "08171110001", "+12025550123"]) {
      const h = harness(), r = await h.post(forgot, { phone, email });
      assert.equal(r.status, 400); assert.equal(h.inserts.length, 0);
    }
  });
  await test("editable phone metadata cannot redirect recovery to a different auth identity", async () => {
    const h = harness({ users: [{ ...A, user_metadata: { contact_email: email, phone: "+639172220002" } }] });
    await h.post(forgot, { phone: "09172220002", email });
    assert.equal(h.inserts.length, 0);
  });
  await test("lookup failure does not send a reset or expose internal diagnostics", async () => {
    const h = harness({ listError: true }), r = await h.post(forgot, { phone: "09171110001", email });
    assert.equal(r.status, 503); assert.equal(h.sent.length, 0);
    assert(!JSON.stringify(r.body).includes("internal auth"));
  });
  await test("a truncated directory search cannot assume a unique recovery mailbox", async () => {
    const h = harness({ infinitePages: true }); await h.post(forgot, { email });
    assert.equal(h.inserts.length, 0); assert.equal(h.sent.length, 0);
  });
  await test("reset changes only the token owner and identifies its mobile suffix", async () => {
    const h = harness(), r = await h.post(reset, { token: "fixture-token", new_password: "synthetic-password", user_id: B.id });
    assert.equal(r.status, 200); assert.equal(h.updates.length, 1); assert.equal(h.updates[0].id, A.id);
    assert.equal(h.marks[0].value, "reset-row"); assert.equal(h.marks[0].values.used, true);
    assert(r.body.message.includes("ending 0001")); assert(!JSON.stringify(r.body).includes("639171110001"));
  });
  await test("invalid, expired and used links never update a password", async () => {
    for (const tokenRows of [[], [{ id: "x", token: "fixture-token", user_id: A.id, used: true, expires_at: "2099-01-01T00:00:00Z" }],
      [{ id: "x", token: "fixture-token", user_id: A.id, used: false, expires_at: "2000-01-01T00:00:00Z" }]]) {
      const h = harness({ tokenRows }), r = await h.post(reset, { token: "fixture-token", new_password: "synthetic-password" });
      assert.equal(r.status, 400); assert.equal(h.updates.length, 0);
    }
  });
  await test("failed password updates never mark a reset completed", async () => {
    const h = harness({ updateError: true }), r = await h.post(reset, { token: "fixture-token", new_password: "synthetic-password" });
    assert.equal(r.status, 500); assert.equal(h.marks.length, 0);
  });
  console.log("Passenger password recovery: " + passed + " test groups passed.");
})().catch(error => { console.error(error); process.exitCode = 1; });
