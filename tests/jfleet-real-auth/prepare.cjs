// Only prepares a disposable CI stack. Never use a linked/hosted project.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'This harness is restricted to disposable CI runners');
const root = process.env.JFLEET_LOCAL_STACK;
assert.ok(root && root.startsWith(process.env.RUNNER_TEMP + '/jfleet-auth-isolated-'));
const target = path.join(root, 'supabase');
assert.ok(fs.existsSync(path.join(target, 'config.toml')), 'Initialize the unlinked stack first');
assert.ok(!fs.existsSync(path.join(target, '.temp/project-ref')), 'Linked projects are forbidden');
const migrations = [
  '20260921150241_jfleet_core_v1.sql',
  '20260921150436_jfleet_fk_indexes_v1.sql',
  '20260921150800_jfleet_addon_flow_v1.sql',
  '20260922194157_jfleet_route_plans_v1.sql',
  '20260922202911_jfleet_owner_route_review_v1.sql',
  '20260922205916_jfleet_customer_revisions_v1.sql',
  '20260922210659_jfleet_customer_quote_fingerprint_v1.sql',
];
fs.mkdirSync(path.join(target, 'migrations'), {recursive: true});
const hashes = [];
for (const name of migrations) {
  const source = fs.readFileSync(path.join('supabase/migrations', name));
  fs.writeFileSync(path.join(target, 'migrations', name), source);
  hashes.push({name, sha256: crypto.createHash('sha256').update(source).digest('hex')});
}
// These are limited ancillary profile/read tables, not a production schema dump.
// No fake authentication functions or JFleet RPC replacements are installed.
fs.writeFileSync(path.join(target, 'migrations/20260920000000_test_profiles_only.sql'), `
create table public.passenger_profiles (user_id uuid primary key references auth.users(id),full_name text,phone text,created_at timestamptz default now());
create table public.passenger_verifications (user_id uuid primary key references auth.users(id),status text);
create table public.passenger_verification_requests (passenger_id uuid primary key references auth.users(id),status text);
create table public.passengers (id uuid primary key default gen_random_uuid(),auth_user_id uuid,user_id uuid,email text,is_verified boolean default false,verified boolean default false,verification_tier text,night_allowed boolean default false);
alter table public.passenger_profiles enable row level security;
alter table public.passenger_verifications enable row level security;
alter table public.passenger_verification_requests enable row level security;
alter table public.passengers enable row level security;
revoke all on public.passenger_profiles,public.passenger_verifications,public.passenger_verification_requests,public.passengers from anon,authenticated;
grant all on public.passenger_profiles,public.passenger_verifications,public.passenger_verification_requests,public.passengers to service_role;
`);
const config = path.join(target, 'config.toml');
let contents = fs.readFileSync(config, 'utf8');
contents = contents.replace(/^project_id\s*=.*$/m, 'project_id = "jfleet-auth-isolated"');
contents = contents.replace(/^major_version\s*=.*$/m, 'major_version = 17');
contents = contents.replace(/^site_url\s*=.*$/m, 'site_url = "http://127.0.0.1:3210"');
fs.writeFileSync(config, contents);
fs.mkdirSync('test-results/jfleet-real-auth', {recursive: true});
fs.writeFileSync('test-results/jfleet-real-auth/migrations.json', JSON.stringify({scope: 'disposable local stack only', migrations: hashes}, null, 2));
console.log('Prepared seven unmodified JFleet migrations and minimal ancillary test profiles. No hosted project linked.');

// Regression for the owner display defect found by real-session screenshots.
// Evaluate the actual shared helper and the actual owner wrapper, not a fixture.
const ts = require('typescript');
const {execFileSync} = require('node:child_process');
const ownerSource = fs.readFileSync('app/jfleet/owner/page.tsx', 'utf8');
const helperSource = fs.readFileSync('lib/jfleet/routeReview.ts', 'utf8');
const wrapper = ownerSource.match(/function dateTime\(value\?: string \| null\): string \{[\s\S]*?\n\}/);
assert.ok(wrapper, 'Expected owner dateTime wrapper not found');
const compiled = ts.transpileModule(helperSource + '\n' + wrapper[0], {
  compilerOptions: {target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS}
}).outputText;
const program = compiled + '\nconsole.log(JSON.stringify([' +
  'dateTime("2026-10-03T06:59:00+08:00"),' +
  'dateTime("2026-09-30T22:59:00Z"),dateTime(null),dateTime("invalid")' +
  ']));';
const expected = ['Oct 3, 2026, 6:59 AM PHT', 'Oct 1, 2026, 6:59 AM PHT', '-', '-'];
const timezoneChecks = [];
for (const zone of ['UTC', 'Asia/Manila', 'America/Los_Angeles']) {
  const actual = JSON.parse(execFileSync(process.execPath, ['-e', program], {
    encoding: 'utf8', env: {...process.env, TZ: zone}, timeout: 10000
  }).trim());
  assert.deepEqual(actual, expected, 'Owner schedule and cancellation cutoff must be Philippines time under ' + zone);
  timezoneChecks.push({browser_host_timezone: zone, actual, passed: true});
}
fs.writeFileSync('test-results/jfleet-real-auth/timezones.json', JSON.stringify({
  scope: 'actual owner dateTime wrapper and shared formatter executed in separate Node processes',
  passed: timezoneChecks.length,
  checks: timezoneChecks,
  owner_source_sha256: crypto.createHash('sha256').update(ownerSource).digest('hex'),
  shared_helper_sha256: crypto.createHash('sha256').update(helperSource).digest('hex')
}, null, 2));
console.log('PASS owner dates and cancellation cutoff match Philippines time in three host timezones');
