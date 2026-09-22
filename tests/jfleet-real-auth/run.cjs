// Real GoTrue password login, SSR cookies, PostgREST, PostgreSQL and Next APIs.
// Only map geometry is a fixture. No auth/business API responses are intercepted.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const {spawn, execFileSync} = require('node:child_process');
const {createClient} = require('@supabase/supabase-js');
const {chromium} = require('playwright');
const OUT = path.resolve('test-results/jfleet-real-auth');
const BASE = 'http://127.0.0.1:3210';
const results = [], calls = [];
let browser, server, stage = 'setup';
const contexts = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function check(name, condition = true) {
  assert.ok(condition, name);
  results.push({name, passed: true});
  console.log('PASS ' + name);
}
function localUrl(value) {
  const u = new URL(value);
  assert.equal(u.protocol, 'http:');
  assert.ok(['127.0.0.1', 'localhost'].includes(u.hostname), 'Hosted Supabase is forbidden');
  return value;
}
async function sqlResult(query) {
  const r = await query;
  if (r.error) throw new Error('Local database request failed: ' + r.error.code + ' ' + r.error.message);
  return r.data;
}
async function api(ctx, method, pathname, data, expected = 200, headers = {}) {
  const r = await ctx.request.fetch(BASE + pathname, {method, data, headers, timeout: 90000});
  const b = await r.json();
  calls.push({method, path: pathname.split('?')[0], status: r.status()});
  assert.equal(r.status(), expected, method + ' ' + pathname + ': ' + String(b.code || b.error || b.message || '').slice(0, 220));
  return b;
}
async function newContext(width = 1280, height = 900) {
  const ctx = await browser.newContext({viewport: {width, height}, serviceWorkers: 'block'});
  // Deny external browser requests; do not replace any local response.
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(u.hostname)) return route.continue();
    return route.abort('blockedbyclient');
  });
  contexts.push(ctx);
  return ctx;
}
async function login(ctx, user) {
  const b = await api(ctx, 'POST', '/api/public/auth/login', {email: user.email, password: user.password});
  assert.equal(b.user_id, user.id);
  assert.ok(b.access_token && b.refresh_token, 'Real Auth tokens required');
  const s = await api(ctx, 'GET', '/api/public/auth/session');
  assert.equal(s.authed, true);
  assert.equal(s.user.id, user.id);
  assert.equal(s.auth_mode, 'cookie');
  return b;
}
async function main() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Disposable CI runners only');
  assert.ok(process.env.JFLEET_LOCAL_STACK.startsWith(process.env.RUNNER_TEMP + '/jfleet-auth-isolated-'));
  const status = JSON.parse(fs.readFileSync(process.env.JFLEET_LOCAL_STATUS, 'utf8'));
  const url = localUrl(status.API_URL);
  assert.ok(status.ANON_KEY && status.SERVICE_ROLE_KEY, 'Local legacy JWT keys required by the current application');
  assert.ok(!fs.existsSync(path.join(process.env.JFLEET_LOCAL_STACK, 'supabase/.temp/project-ref')));
  fs.mkdirSync(OUT, {recursive: true});
  const admin = createClient(url, status.SERVICE_ROLE_KEY, {auth: {persistSession: false, autoRefreshToken: false}});
  const anon = createClient(url, status.ANON_KEY, {auth: {persistSession: false, autoRefreshToken: false}});
  const user = {};
  for (const name of ['customer', 'other_customer', 'owner', 'other_owner']) {
    const email = 'jfleet-' + name.replace('_', '-') + '-' + crypto.randomBytes(5).toString('hex') + '@example.invalid';
    const password = crypto.randomBytes(24).toString('base64url');
    const made = await admin.auth.admin.createUser({email, password, email_confirm: true, user_metadata: {full_name: 'LOCAL TEST ' + name, role: name === 'other_customer' ? 'owner' : name}});
    if (made.error) throw new Error('Isolated Auth user creation failed: ' + made.error.message);
    user[name] = {id: made.data.user.id, email, password};
    await sqlResult(admin.from('passenger_profiles').insert({user_id: made.data.user.id, full_name: 'LOCAL TEST ' + name}));
  }
  check('Four generated users created through the real local Auth admin API');
  const partner = await sqlResult(admin.from('jfleet_partners').insert({partner_code: 'AUTH-LOCAL-A', legal_name: 'LOCAL TEST ONLY A', display_name: 'LOCAL TEST ONLY A', owner_user_id: user.owner.id, status: 'active', is_priority_pilot: true}).select().single());
  const otherPartner = await sqlResult(admin.from('jfleet_partners').insert({partner_code: 'AUTH-LOCAL-B', legal_name: 'LOCAL TEST ONLY B', display_name: 'LOCAL TEST ONLY B', owner_user_id: user.other_owner.id, status: 'active'}).select().single());
  const logPath = path.join(process.env.RUNNER_TEMP, 'jfleet-next-auth-private.log');
  const log = fs.openSync(logPath, 'w', 0o600);
  server = spawn(process.execPath, [path.resolve('node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', '3210'], {
    env: {PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'development', NEXT_TELEMETRY_DISABLED: '1', NEXT_PUBLIC_SUPABASE_URL: url, SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: status.ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY, JRIDE_JFLEET_ENABLED: 'true', AUTH_SECRET: crypto.randomBytes(32).toString('hex')},
    stdio: ['ignore', log, log]
  });
  fs.closeSync(log);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (server.exitCode !== null) throw new Error('Local Next server exited; no production fallback attempted');
    try { const r = await fetch(BASE + '/api/jfleet/status'); if (r.ok && (await r.json()).enabled === true) {ready = true; break;} } catch {}
    await delay(1500);
  }
  assert.ok(ready, 'Local Next server did not become ready');
  browser = await chromium.launch({headless: true});
  const unsigned = await newContext();
  for (const route of ['/api/jfleet/customer', '/api/jfleet/owner/dashboard', '/api/jfleet/owner/routes']) {
    await api(unsigned, 'GET', route, undefined, 401);
    check('Unauthenticated request denied: ' + route);
  }
  await api(unsigned, 'POST', '/api/public/auth/login', {email: user.customer.email, password: 'not-the-correct-password'}, 401);
  check('Wrong password rejected by the actual Auth login path');
  const customer = await newContext(390, 844), foreign = await newContext(), owner = await newContext(), ownerSecond = await newContext(), foreignOwner = await newContext();
  const customerLogin = await login(customer, user.customer);
  await login(foreign, user.other_customer);
  await login(owner, user.owner);
  await login(ownerSecond, user.owner);
  await login(foreignOwner, user.other_owner);
  check('Application login endpoint establishes real validated SSR cookie sessions');
  assert.equal((await api(owner, 'GET', '/api/jfleet/owner/dashboard')).partner.id, partner.id);
  assert.equal((await api(ownerSecond, 'GET', '/api/jfleet/owner/dashboard')).partner.id, partner.id);
  check('Two independently logged-in owner browser sessions remain usable together');
  await api(foreign, 'GET', '/api/jfleet/owner/dashboard', undefined, 403);
  check('User metadata claiming owner does not grant company access');
  const bearerCtx = await newContext();
  await api(bearerCtx, 'GET', '/api/jfleet/customer', undefined, 200, {Authorization: 'Bearer ' + customerLogin.access_token});
  check('Real bearer-token authentication works without a browser cookie');
  const parts = customerLogin.access_token.split('.');
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  payload.sub = user.owner.id;
  const forged = parts[0] + '.' + Buffer.from(JSON.stringify(payload)).toString('base64url') + '.' + parts[2];
  await api(unsigned, 'GET', '/api/jfleet/owner/routes', undefined, 401, {Authorization: 'Bearer ' + forged});
  check('Altered JWT principal is rejected by Auth signature validation');
  await api(owner, 'GET', '/api/jfleet/owner/routes', undefined, 401, {Authorization: 'Bearer ' + forged});
  check('A valid cookie cannot hide an invalid supplied bearer token');
  const denied = await anon.rpc('jfleet_begin_route_plan_v1', {p_user_id: user.customer.id, p_points: []});
  assert.ok(denied.error && denied.data === null);
  check('Anonymous direct invocation of a server-only JFleet RPC is denied');
  const points = [{label:'LOCAL TEST Pickup',lat:16.8,lng:121.1,notes:'Pickup instructions'}, {label:'LOCAL TEST Destination',lat:16.4,lng:120.6,notes:'Destination'}, {label:'LOCAL TEST Pickup',lat:16.8,lng:121.1,notes:'Return to pickup'}];
  const geometry = {provider:'mapbox',profile:'driving',geometry:{type:'LineString',coordinates:[[121.1,16.8],[120.6,16.4],[121.1,16.8]]},distance_m:120000,duration_s:10800,snapped_points:[]};
  async function plan(who, pins) {
    const b = await sqlResult(admin.rpc('jfleet_begin_route_plan_v1', {p_user_id: who.id, p_points: pins}));
    await sqlResult(admin.from('jfleet_route_plans').update({status:'ready', route: geometry}).eq('id', b.id));
    return b.id;
  }
  const details = {purpose:'family',requested_vehicle_type:'van',trip_mode:'round_trip',scheduled_start_at:new Date(Date.now()+10*86400000+28800000).toISOString().slice(0,16)+':00+08:00',scheduled_end_at:new Date(Date.now()+11*86400000+28800000).toISOString().slice(0,16)+':00+08:00',passenger_count:8,cargo_weight_kg:null,cargo_description:null,luggage_notes:'8 bags',special_notes:'LOCAL AUTH INTEGRATION ONLY'};
  const planId = await plan(user.customer, points);
  stage = 'inquiry and owner review';
  await api(foreign, 'POST', '/api/jfleet/planner', {action:'submit',plan_id:planId,points,details}, 404);
  check('Real foreign customer cannot submit another account route preview');
  const inquiry = await api(customer, 'POST', '/api/jfleet/planner', {action:'submit',plan_id:planId,points,details,passenger_user_id:user.other_customer.id}, 201);
  const iq = inquiry.inquiry_id;
  const persisted = await sqlResult(admin.from('jfleet_inquiries').select('passenger_user_id,partner_id').eq('id',iq).single());
  assert.equal(persisted.passenger_user_id,user.customer.id); assert.equal(persisted.partner_id,partner.id);
  check('Authenticated inquiry is persisted under server-validated customer identity');
  await api(foreign, 'GET', '/api/jfleet/customer?id='+iq, undefined, 404);
  await api(foreignOwner, 'GET', '/api/jfleet/owner/routes?inquiry_id='+iq, undefined, 404);
  check('Cross-customer and cross-company reads are denied with real sessions');
  const context = () => api(customer,'GET','/api/jfleet/customer?id='+iq);
  const ownerContext = () => api(owner,'GET','/api/jfleet/owner/routes?inquiry_id='+iq);
  async function approve() {
    const c = await ownerContext();
    return api(owner,'POST','/api/jfleet/owner/routes',{inquiry_id:iq,snapshot_hash:c.snapshot_hash,decision:'approved',notes:'LOCAL TEST simulated geometry reviewed by API',acknowledged:true});
  }
  async function quote(reviewId, amount, expected = 201) {
    return api(ownerSecond,'POST','/api/jfleet/owner/quotes',{inquiry_id:iq,route_review_id:reviewId,total_amount:amount,valid_until:new Date(Date.now()+86400000).toISOString(),inclusions:'TEST vehicle, driver and fuel',exclusions:'Tolls and parking',fuel_basis_note:'TEST fuel basis - no real quotation',pricing_notes:'TEST ONLY',items:[]},expected);
  }
  const approval = await approve();
  await quote(approval.review_id,10000);
  const old = await context();
  await quote(approval.review_id,11000);
  await api(customer,'POST','/api/jfleet/quotes/accept',{inquiry_id:iq,quote_id:old.actionable_quote_id,context_token:old.context_token,terms_acknowledged:true},409);
  check('A quotation changed on the second owner session invalidates earlier customer consent');
  const oc = await ownerContext();
  await api(owner,'POST','/api/jfleet/owner/routes',{inquiry_id:iq,snapshot_hash:oc.snapshot_hash,decision:'changes_requested',notes:'Clarify luggage and passenger count',acknowledged:false});
  const changed = await context();
  assert.equal(changed.reviews[0].notes,'Clarify luggage and passenger count');
  check('Actual owner feedback reaches the customer through the database');
  const pins2 = points.map(p=>({...p})); pins2[1].notes='Updated stop instructions';
  const plan2 = await plan(user.customer,pins2);
  const revision = {inquiry_id:iq,plan_id:plan2,points:pins2,details:{...details,passenger_count:10,luggage_notes:'10 small bags'},context_token:changed.context_token,reason:'Updated passenger count and luggage'};
  const revised = await api(customer,'POST','/api/jfleet/customer',revision);
  assert.equal(revised.inquiry_id,iq); assert.equal(revised.itinerary_version,2);
  const repeat = await api(customer,'POST','/api/jfleet/customer',revision);
  assert.equal(repeat.already_submitted,true);
  check('Real API resubmission creates itinerary v2 in the same inquiry and retry is idempotent');
  assert.ok(Math.abs(Date.parse(revised.quote_due_at)-Date.now()-10800000)<15000);
  check('Database resubmission restarts the three-hour response deadline');
  await quote(approval.review_id,12000,409);
  check('Owner cannot quote revised itinerary using a stale approval');
  const fresh = await approve();
  await quote(fresh.review_id,12000);
  const current = await context();
  await api(foreign,'POST','/api/jfleet/quotes/accept',{inquiry_id:iq,quote_id:current.actionable_quote_id,context_token:current.context_token,terms_acknowledged:true},404);
  await api(customer,'POST','/api/jfleet/quotes/accept',{inquiry_id:iq,quote_id:current.actionable_quote_id,context_token:current.context_token,terms_acknowledged:false},400);
  check('Acceptance requires the correct real customer and explicit acknowledgment');
  stage = 'real browser quotation acceptance';
  const page = await customer.newPage();
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto(BASE+'/jfleet/inquiries/'+iq,{waitUntil:'domcontentloaded',timeout:90000});
  const accept=page.getByRole('button',{name:/^Accept quote v/});
  await accept.waitFor({timeout:90000});
  assert.equal(await accept.isDisabled(),true);
  const body=await page.locator('body').innerText();
  for(const text of ['PHP 12,000.00','PHP 2,400.00','Tolls and parking','48 hours','10% of the total accepted quotation']) assert.ok(body.includes(text),text);
  check('Mobile-sized browser renders actual authenticated quotation and payment terms');
  await page.screenshot({path:path.join(OUT,'mobile-real-auth-quotation.png'),fullPage:true});
  await page.getByRole('checkbox').check();
  await accept.click();
  await page.getByRole('status').filter({hasText:'Quotation accepted'}).waitFor({timeout:90000});
  const accepted = await context();
  assert.ok(accepted.booking); assert.equal(accepted.booking.status,'reservation_pending');
  assert.equal(Number(accepted.booking.reservation_required_amount),2400);
  assert.equal(pageErrors.length,0);
  check('Browser acceptance uses real session and database and creates only a reservation-pending booking');
  const again=await api(customer,'POST','/api/jfleet/quotes/accept',{inquiry_id:iq,quote_id:current.actionable_quote_id,context_token:current.context_token,terms_acknowledged:true});
  assert.equal(again.already_converted,true);
  check('Accepted-quotation HTTP retry does not create a second booking');
  stage = 'owner payment and account isolation';
  const bookingId=accepted.booking.id;
  const pay={booking_id:bookingId,payment_kind:'reservation',amount:1200,payment_channel:'LOCAL TEST NO TRANSFER',idempotency_key:'LOCAL-TEST-PAYMENT-1'};
  await api(customer,'POST','/api/jfleet/owner/payments',pay,403);
  await api(foreignOwner,'POST','/api/jfleet/owner/payments',pay,409);
  check('Neither customer nor another operator can confirm this booking payment');
  const partial=await api(owner,'POST','/api/jfleet/owner/payments',pay);
  assert.equal(partial.booking_status,'reservation_pending');
  const minimum=await api(ownerSecond,'POST','/api/jfleet/owner/payments',{...pay,idempotency_key:'LOCAL-TEST-PAYMENT-2'});
  assert.equal(minimum.booking_status,'confirmed');assert.equal(Number(minimum.confirmed_original_payments),2400);
  check('Two owner sessions see the same ledger and exactly 20 percent confirms reservation');
  const repeated=await api(owner,'POST','/api/jfleet/owner/payments',{...pay,idempotency_key:'LOCAL-TEST-PAYMENT-2'});
  assert.equal(Number(repeated.confirmed_original_payments),2400);
  check('Repeated payment with the same transaction key does not double-count');
  const bookings=await api(customer,'GET','/api/jfleet/bookings');
  assert.equal(bookings.bookings[0].payment_status,'reservation_paid');
  const foreignBookings=await api(foreign,'GET','/api/jfleet/bookings');
  assert.equal(foreignBookings.bookings.length,0);
  check('Customer booking status reflects owner confirmation while another customer sees no booking');
  const ownerPage=await ownerSecond.newPage();
  await ownerPage.goto(BASE+'/jfleet/owner',{waitUntil:'domcontentloaded',timeout:90000});
  await ownerPage.getByText(accepted.booking.booking_code,{exact:true}).waitFor({timeout:90000});
  await ownerPage.screenshot({path:path.join(OUT,'desktop-real-auth-owner.png'),fullPage:true});
  check('Owner portal renders the persisted booking with a real independent cookie session');
  await sqlResult(admin.from('jfleet_partners').update({owner_user_id:null}).eq('id',partner.id));
  await api(owner,'GET','/api/jfleet/owner/dashboard',undefined,403);
  await api(ownerSecond,'GET','/api/jfleet/owner/dashboard',undefined,403);
  check('Removing owner account mapping revokes company access on both existing sessions');
  const count=await sqlResult(admin.from('jfleet_bookings').select('id,inquiry_id'));
  assert.equal(count.length,1);assert.equal(count[0].inquiry_id,iq);
  const profiles=await sqlResult(admin.from('jfleet_vehicles').select('id'));
  const drivers=await sqlResult(admin.from('jfleet_drivers').select('id'));
  assert.equal(profiles.length,0);assert.equal(drivers.length,0);
  check('No vehicles, drivers, operating permits or approvals were invented by the auth test');
  assert.equal((await api(unsigned,'GET','/api/public/auth/session')).authed,false);
  check('Unsigned browser remains unauthenticated after other account activity');
  stage='complete';
}
(async()=>{
  let failure=null;
  try {await main();}
  catch(e){failure={stage,message:String(e.message).slice(0,1200)};process.exitCode=1;console.error('FAIL '+stage+': '+failure.message);}
  finally {
    if(browser)await browser.close().catch(()=>{});
    if(server){server.kill('SIGTERM');await delay(500);if(server.exitCode===null)server.kill('SIGKILL');}
    fs.mkdirSync(OUT,{recursive:true});
    let commit='unknown';try{commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();}catch{}
    const report={commit,passed:results.length,failures:failure?[failure]:[],checks:results,requests:calls,
      authentication:'actual local Supabase GoTrue via unmodified application login API and SSR cookies',database:'actual local PostgreSQL and PostgREST with unmodified JFleet migrations',maps:'simulated route geometry; no live map-provider calls',browser:'Chromium desktop and 390x844 mobile viewport; not physical Android',production:'not contacted by this harness; no hosted keys or accounts used',limits:['No external Google/Facebook/phone OTP provider','No native device-session claim or refresh bridge','No physical device background GPS','No actual funds transferred','Ancillary passenger tables are a minimal test schema, not a full production clone']};
    fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(report,null,2));
    console.log('JFleet real-auth integration: '+results.length+' checks passed; '+(failure?1:0)+' failures.');
  }
})();
