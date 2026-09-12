const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
const shared = '00000000-0000-4000-8000-000000000001';
const regular = '00000000-0000-4000-8000-000000000002';
const actor = 'Isolated device policy test';

(async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create table drivers(id uuid primary key);
      create table driver_profiles(driver_id uuid primary key);
      insert into drivers values('${shared}'),('${regular}');
      insert into driver_profiles select id from drivers;`);
    await db.exec(fs.readFileSync(path.join(root, 'supabase/migrations/20260906203740_agrimarket_driver_device_access_v1.sql'), 'utf8'));
    const filename = fs.readdirSync(path.join(root, 'supabase/migrations')).find(name => name.endsWith('_agrimarket_shared_test_driver_devices.sql'));
    assert(filename, 'shared Test Driver migration exists');
    await db.exec('begin;\n' + fs.readFileSync(path.join(root, 'supabase/migrations', filename), 'utf8') + '\ncommit;');

    async function request(driver, device, at = new Date().toISOString()) {
      const id = crypto.randomUUID(), secret = crypto.randomBytes(32).toString('hex');
      const hash = crypto.createHash('sha256').update(secret).digest('hex');
      const result = await db.query('select agrimarket_request_driver_device_v1($1,$2,$3,$4,$5,$6) as result', [id, driver, device, hash, 'test-only', at]);
      assert.equal(result.rows[0].result.status, 'pending');
      return { id, driver, device, secret, token: 'agdev.' + id + '.' + secret };
    }
    async function review(credential, decision = 'approve', role = 'admin') {
      return db.query('select agrimarket_review_driver_device_v1($1,$2,$3,$4,$5) as result', [credential.id, decision, actor, role, 'Verified isolated test fixture']);
    }
    async function status(credential) {
      return (await db.query('select status from agrimarket_driver_devices where id=$1', [credential.id])).rows[0].status;
    }

    const testA = await request(shared, '1111111111111111');
    const testB = await request(shared, '2222222222222222');
    await review(testA); await review(testB);
    assert.equal(await status(testA), 'approved');
    assert.equal(await status(testB), 'approved');
    assert.equal((await db.query("select count(*)::int as n from agrimarket_driver_device_events where event_type='revoked'")).rows[0].n, 0);
    await review(testB);
    assert.equal((await db.query("select count(*)::int as n from agrimarket_driver_device_events where event_type='approved'")).rows[0].n, 2);
    console.log('PASS: two shared Test Driver devices stay approved; approvals are audited and repeat approval is idempotent');

    const normalA = await request(regular, '3333333333333333');
    const normalB = await request(regular, '4444444444444444');
    await review(normalA); await review(normalB);
    assert.equal(await status(normalA), 'revoked');
    assert.equal(await status(normalB), 'approved');
    await assert.rejects(db.query("update agrimarket_driver_devices set status='approved' where id=$1", [normalA.id]), /duplicate key/);
    console.log('PASS: regular driver replacement still revokes the previous phone; the unique index prevents multiple approvals');

    const pending = await request(shared, '5555555555555555');
    await assert.rejects(review(pending, 'approve', 'dispatcher'), /AGRIMARKET_ADMIN_REQUIRED/);
    assert.equal(await status(pending), 'pending');
    const expired = await request(regular, '6666666666666666', new Date(Date.now() - 90000000).toISOString());
    await assert.rejects(review(expired), /DRIVER_DEVICE_REQUEST_EXPIRED/);
    await review(testA, 'revoke');
    await assert.rejects(review(testA), /DRIVER_DEVICE_REVOKED/);
    assert.equal(await status(testB), 'approved');
    console.log('PASS: admin-only review, request expiry and explicit revocation remain enforced for test accounts');

    const admin = { from(table) {
      assert.equal(table, 'agrimarket_driver_devices');
      const filters = [], values = [];
      const q = { select() { return q; }, eq(key, value) {
        assert(['id', 'token_sha256', 'device_id'].includes(key));
        values.push(value); filters.push(key + '=$' + values.length); return q;
      }, async maybeSingle() {
        const result = await db.query('select driver_id,device_id,status,created_at from agrimarket_driver_devices where ' + filters.join(' and '), values);
        return { data: result.rows[0] || null, error: null };
      } }; return q;
    } };
    const module = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(path.join(root, 'lib/driver/resolveDriverRequest.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
    vm.runInNewContext(code, { module, exports: module.exports, Date, URL, process: { env: {} }, require: name => name === '@/lib/supabaseAdmin' ? { supabaseAdmin: () => admin } : name === '@supabase/supabase-js' ? { createClient() { throw new Error('Unexpected user auth'); } } : require(name) });
    const { resolveDriverRequest } = module.exports;
    async function access(c, changes = {}) {
      const req = new Request('https://test.invalid/api/driver/agrimarket/session', { headers: { authorization: 'Bearer ' + (changes.token || c.token), 'x-jride-device-id': changes.device || c.device } });
      return resolveDriverRequest(req, changes.driver || c.driver, { requireBearer: true });
    }
    assert.equal((await access(testB)).ok, true);
    assert.equal((await access(pending)).error, 'DRIVER_DEVICE_PENDING');
    assert.equal((await access(expired)).error, 'DRIVER_DEVICE_EXPIRED');
    assert.equal((await access(testA)).error, 'DRIVER_DEVICE_REVOKED');
    assert.equal((await access(testB, { device: '9999999999999999' })).ok, false);
    assert.equal((await access(testB, { token: 'agdev.' + testB.id + '.' + 'a'.repeat(64) })).ok, false);
    assert.equal((await access(testB, { driver: regular })).error, 'DRIVER_IDENTITY_MISMATCH');
    console.log('PASS: the real request resolver still checks approval, expiry, revocation, credential secret, device ID and driver identity');

    for (const role of ['anon', 'authenticated']) {
      const result = await db.query("select has_table_privilege($1,'agrimarket_driver_devices','select') as can_read, has_function_privilege($1,'agrimarket_review_driver_device_v1(uuid,text,text,text,text,timestamptz)','execute') as can_review", [role]);
      assert.equal(result.rows[0].can_read, false);
      assert.equal(result.rows[0].can_review, false);
    }
    const rls = await db.query("select relrowsecurity from pg_class where oid='agrimarket_driver_devices'::regclass");
    assert.equal(rls.rows[0].relrowsecurity, true);
    console.log('PASS: client roles cannot read credentials or approve devices; RLS remains enabled');
    console.log('All device policy checks passed in isolated PostgreSQL. No live driver data used.');
  } finally { await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
