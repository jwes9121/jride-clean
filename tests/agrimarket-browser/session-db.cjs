// Run with AGRIMARKET_TEST_PGLITE_PATH pointing to an installed @electric-sql/pglite package.
// All rows below are local fixtures. No network or production credentials are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require(process.env.AGRIMARKET_TEST_PGLITE_PATH || '@electric-sql/pglite');
const root = path.resolve(__dirname, '../..');
async function main() {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema extensions; grant usage on schema extensions to service_role;
      create function extensions.digest(text,text) returns bytea language sql immutable as 'select sha256(convert_to($1,''UTF8''))';
      -- PGlite has no pgcrypto bcrypt extension. Stub only the crypt primitive;
      -- run the repository's existing credential verification function unchanged.
      create function extensions.crypt(text,text) returns text language sql immutable as
        'select case when $1=''123456'' then $2 else ''invalid'' end';
      create table public.agrimarket_producers(id uuid primary key,status text,accepting_orders boolean,
        contact_name text,vendor_name text,town text,barangay text);
      create table public.agrimarket_producer_credentials(id uuid primary key,producer_id uuid,access_code text,
        pin_hash text,status text,failed_attempts integer default 0,locked_until timestamptz,last_used_at timestamptz,updated_at timestamptz);
      create table public.agrimarket_browser_subscriptions(id uuid primary key,producer_id uuid,status text,updated_at timestamptz);
      create table public.agrimarket_browser_alert_jobs(subscription_id uuid,status text,last_error text);
      grant all on all tables in schema public to service_role;
      insert into public.agrimarket_producers values
        ('00000000-0000-4000-8000-000000000001','active',true,'Fixture','Fixture','Lagawe','Fixture'),
        ('00000000-0000-4000-8000-000000000002','active',true,'Other','Other','Lagawe','Fixture');
      insert into public.agrimarket_producer_credentials(id,producer_id,access_code,pin_hash,status) values
        ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000001','AGF-FIXTURE1','fixture-hash','active');
    `);
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations/20260829012740_agrimarket_producer_credential_verify_fix_v1.sql'),'utf8'));
    const migration = fs.readdirSync(path.join(root,'supabase/migrations')).find(name=>name.endsWith('_agrimarket_farmer_browser_sessions_v1.sql'));
    await db.exec(fs.readFileSync(path.join(root,'supabase/migrations',migration),'utf8'));
    const one = async (sql,params=[]) => (await db.query(sql,params)).rows[0];
    const login = async (hash,pin='123456') => (await one('select public.agrimarket_farmer_session_login_v1($1,$2,$3) as v',['AGF-FIXTURE1',pin,hash])).v;
    const read = async hash => (await one('select public.agrimarket_farmer_session_read_v1($1) as v',[hash])).v;
    const token='a'.repeat(64);
    await db.exec('set role service_role');
    assert.equal((await login(token)).access_code,'AGF-FIXTURE1');
    assert.equal((await read(token)).producer.id,'00000000-0000-4000-8000-000000000001');
    assert.equal(await read('b'.repeat(64)),null);
    console.log('PASS local SQL session login, restore and forged token rejection');
    await db.exec('reset role');
    const expiry=(await one('select expires_at-created_at as duration from public.agrimarket_farmer_browser_sessions')).duration;
    assert.equal(expiry,'30 days');
    await db.exec("update public.agrimarket_farmer_browser_sessions set expires_at=now()-interval '1 second'");
    assert.equal(await read(token),null);
    await db.exec('delete from public.agrimarket_farmer_browser_sessions');
    await login(token);
    await db.exec("update public.agrimarket_producer_credentials set pin_hash='rotated'");
    assert.equal(await read(token),null);
    console.log('PASS local SQL session expiry and PIN rotation invalidate remembered login');
    await login('c'.repeat(64));
    await db.exec("update public.agrimarket_producers set status='inactive'");
    assert.equal(await read('c'.repeat(64)),null);
    await db.exec("update public.agrimarket_producers set status='active'");
    await db.exec("update public.agrimarket_producer_credentials set status='revoked'");
    assert.equal(await read('c'.repeat(64)),null);
    await db.exec("update public.agrimarket_producer_credentials set status='active'");
    console.log('PASS local SQL producer and credential deactivation invalidate sessions');
    for(let i=0;i<5;i++) assert.equal(await login('d'.repeat(64),'000000'),null);
    assert.equal((await one('select failed_attempts from public.agrimarket_producer_credentials')).failed_attempts,5);
    assert.equal(await login('e'.repeat(64)),null);assert.equal(await read('c'.repeat(64)),null);
    await db.exec('update public.agrimarket_producer_credentials set locked_until=null,failed_attempts=0');
    console.log('PASS local SQL login retains existing PIN attempt lockout');
    await db.exec('delete from public.agrimarket_farmer_browser_sessions');
    for(let i=0;i<12;i++) await login(i.toString(16).padStart(64,'0'));
    assert.equal((await one('select count(*)::integer as n from public.agrimarket_farmer_browser_sessions')).n,10);
    console.log('PASS local SQL remembered device count is bounded');
    const own='00000000-0000-4000-8000-000000000004',other='00000000-0000-4000-8000-000000000005';
    await db.exec(`insert into public.agrimarket_browser_subscriptions values
      ('${own}','00000000-0000-4000-8000-000000000001','active',now()),
      ('${other}','00000000-0000-4000-8000-000000000002','active',now());
      insert into public.agrimarket_browser_alert_jobs values('${own}','pending',null),('${other}','pending',null);`);
    await login(token);await db.query('select public.agrimarket_farmer_session_logout_v1($1,$2)',[token,other]);
    assert.equal(await read(token),null);
    assert.equal((await one('select status from public.agrimarket_browser_subscriptions where id=$1',[other])).status,'active');
    await login(token);await db.query('select public.agrimarket_farmer_session_logout_v1($1,$2)',[token,own]);
    assert.equal((await one('select status from public.agrimarket_browser_subscriptions where id=$1',[own])).status,'disabled');
    assert.equal((await one('select status from public.agrimarket_browser_alert_jobs where subscription_id=$1',[own])).status,'expired');
    console.log('PASS local SQL sign-out revokes only the caller session and its own alert registration');
    for(const role of ['anon','authenticated']) {
      assert.equal((await one('select has_table_privilege($1,$2,$3) as allowed',[role,'public.agrimarket_farmer_browser_sessions','SELECT'])).allowed,false);
      for(const signature of ['agrimarket_farmer_session_login_v1(text,text,text)','agrimarket_farmer_session_read_v1(text)','agrimarket_farmer_session_logout_v1(text,uuid)'])
        assert.equal((await one('select has_function_privilege($1,$2,$3) as allowed',[role,'public.'+signature,'EXECUTE'])).allowed,false);
    }
    assert.equal((await one("select relrowsecurity from pg_class where oid='public.agrimarket_farmer_browser_sessions'::regclass")).relrowsecurity,true);
    console.log('PASS local SQL sessions and RPCs deny public client access');
    console.log('7 local session database test groups passed. Bcrypt primitive is stubbed; session SQL and existing verifier are executed.');
  } finally { await db.close(); }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
