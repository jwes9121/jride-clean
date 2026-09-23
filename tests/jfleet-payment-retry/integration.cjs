// Real local Auth, SSR cookies, Next routes, IndexedDB and PostgreSQL.
// The only network fault injection drops requests/responses; no successful business response is mocked.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {spawn,execFileSync}=require('node:child_process');
const {createClient}=require('@supabase/supabase-js');const {chromium}=require('playwright');
const OUT=path.resolve('test-results/jfleet-payment-retry'),BASE='http://127.0.0.1:3210';
const checks=[],requests=[];let server,browser,stage='setup';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(name,condition=true){assert.ok(condition,name);checks.push(name);console.log('PASS '+name);}
async function db(query){const r=await query;if(r.error)throw Error('Local DB: '+r.error.code+' '+r.error.message);return r.data;}
async function api(ctx,method,p,data,status=200){const r=await ctx.request.fetch(BASE+p,{method,data,timeout:90000});const b=await r.json();assert.equal(r.status(),status,p+': '+String(b.code||b.message||b.error||''));return b;}
async function main(){
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.ok(process.env.JFLEET_LOCAL_STACK.startsWith(process.env.RUNNER_TEMP+'/jfleet-auth-isolated-'));
 const cfg=JSON.parse(fs.readFileSync(process.env.JFLEET_LOCAL_STATUS,'utf8'));const u=new URL(cfg.API_URL);assert.equal(u.protocol,'http:');assert.ok(['127.0.0.1','localhost'].includes(u.hostname));
 assert.ok(!fs.existsSync(path.join(process.env.JFLEET_LOCAL_STACK,'supabase/.temp/project-ref')));
 const admin=createClient(cfg.API_URL,cfg.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const users={};for(const name of ['owner','customer','other_owner']){const email='jfpay-'+name.replace('_','-')+'-'+crypto.randomBytes(5).toString('hex')+'@example.invalid',password=crypto.randomBytes(24).toString('base64url');
  const r=await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'LOCAL TEST '+name}});assert.ok(!r.error);users[name]={id:r.data.user.id,email,password};await db(admin.from('passenger_profiles').insert({user_id:r.data.user.id,full_name:'LOCAL TEST '+name}));}
 const partner=await db(admin.from('jfleet_partners').insert({partner_code:'PAY-LOCAL-A',legal_name:'LOCAL PAYMENT TEST A',display_name:'LOCAL PAYMENT TEST A',owner_user_id:users.owner.id,status:'active',is_priority_pilot:true}).select().single());
 await db(admin.from('jfleet_partners').insert({partner_code:'PAY-LOCAL-B',legal_name:'LOCAL PAYMENT TEST B',display_name:'LOCAL PAYMENT TEST B',owner_user_id:users.other_owner.id,status:'active'}));
 const log=fs.openSync(path.join(process.env.RUNNER_TEMP,'jfleet-next-auth-private.log'),'w',0o600);
 server=spawn(process.execPath,[path.resolve('node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port','3210'],{env:{PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NEXT_PUBLIC_SUPABASE_URL:cfg.API_URL,SUPABASE_URL:cfg.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:cfg.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:cfg.SERVICE_ROLE_KEY,JRIDE_JFLEET_ENABLED:'true',AUTH_SECRET:crypto.randomBytes(32).toString('hex')},stdio:['ignore',log,log]});fs.closeSync(log);
 let ready=false;for(let i=0;i<100;i++){assert.equal(server.exitCode,null);try{const r=await fetch(BASE+'/api/jfleet/status');if(r.ok&&(await r.json()).enabled){ready=true;break;}}catch{}await sleep(1000);}assert.ok(ready);
 browser=await chromium.launch({headless:true});
 async function context(width=1280){const c=await browser.newContext({viewport:{width,height:width===390?844:900},serviceWorkers:'block'});await c.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort('blockedbyclient'));return c;}
 async function login(ctx,name){const b=await api(ctx,'POST','/api/public/auth/login',{email:users[name].email,password:users[name].password});assert.equal(b.user_id,users[name].id);assert.equal((await api(ctx,'GET','/api/public/auth/session')).user.id,users[name].id);}
 const owner=await context(),customer=await context(390),other=await context(),unsigned=await context();
 await login(owner,'owner');await login(customer,'customer');await login(other,'other_owner');
 check('Actual JRide password login establishes isolated owner/customer cookie sessions');
 await api(unsigned,'POST','/api/jfleet/owner/payments',{},401);check('Unauthenticated payment requests are denied');
 const points=[{label:'LOCAL Pickup',lat:16.8,lng:121.1,notes:''},{label:'LOCAL Destination',lat:16.4,lng:120.6,notes:''},{label:'LOCAL Pickup',lat:16.8,lng:121.1,notes:''}];
 const plan=await db(admin.rpc('jfleet_begin_route_plan_v1',{p_user_id:users.customer.id,p_points:points}));
 await db(admin.from('jfleet_route_plans').update({status:'ready',route:{provider:'mapbox',profile:'driving',geometry:{type:'LineString',coordinates:[[121.1,16.8],[120.6,16.4],[121.1,16.8]]},distance_m:120000,duration_s:10800,snapped_points:[]}}).eq('id',plan.id));
 const pht=days=>new Date(Date.now()+days*86400000+28800000).toISOString().slice(0,16)+':00+08:00';
 const details={purpose:'family',requested_vehicle_type:'van',trip_mode:'round_trip',scheduled_start_at:pht(10),scheduled_end_at:pht(11),passenger_count:8,cargo_weight_kg:null,cargo_description:null,luggage_notes:'TEST',special_notes:'LOCAL PAYMENT TEST ONLY'};
 const iq=await api(customer,'POST','/api/jfleet/planner',{action:'submit',plan_id:plan.id,points,details},201);
 const review=await api(owner,'GET','/api/jfleet/owner/routes?inquiry_id='+iq.inquiry_id);
 const approved=await api(owner,'POST','/api/jfleet/owner/routes',{inquiry_id:iq.inquiry_id,snapshot_hash:review.snapshot_hash,decision:'approved',notes:'TEST simulated route',acknowledged:true});
 await api(owner,'POST','/api/jfleet/owner/quotes',{inquiry_id:iq.inquiry_id,route_review_id:approved.review_id,total_amount:12000,valid_until:new Date(Date.now()+86400000).toISOString(),inclusions:'TEST vehicle driver fuel',exclusions:'None',fuel_basis_note:'TEST',pricing_notes:'TEST',items:[]},201);
 const quote=await api(customer,'GET','/api/jfleet/customer?id='+iq.inquiry_id);
 const booking=await api(customer,'POST','/api/jfleet/quotes/accept',{inquiry_id:iq.inquiry_id,quote_id:quote.actionable_quote_id,context_token:quote.context_token,terms_acknowledged:true});const bid=booking.booking_id;
 check('Real API inquiry and quotation acceptance create reservation-pending test booking',booking.status==='reservation_pending');
 const ledger=()=>db(admin.from('jfleet_payments').select('id,idempotency_key,amount,payment_reference').eq('booking_id',bid).order('created_at'));
 const page=await owner.newPage(),pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 page.on('request',r=>{if(r.method()==='POST'&&r.url()===BASE+'/api/jfleet/owner/payments'){const b=r.postDataJSON();requests.push({key:b.idempotency_key,amount:b.amount,reference:b.payment_reference});}});
 const form=()=>page.getByTestId('payment-form-'+bid);
 async function open(p=page){await p.goto(BASE+'/jfleet/owner',{waitUntil:'domcontentloaded',timeout:90000});await p.getByTestId('payment-form-'+bid).waitFor({timeout:90000});}
 async function fill(p,amount,reference){const f=p.getByTestId('payment-form-'+bid);await f.getByLabel('Amount received (PHP)',{exact:true}).fill(String(amount));await f.getByLabel('Payment channel',{exact:true}).fill('LOCAL TEST CASH');await f.getByLabel('Payment reference',{exact:true}).fill(reference);}
 async function slot(p=page){return p.evaluate(({scope})=>new Promise((resolve,reject)=>{const r=indexedDB.open('jride-jfleet-owner-payments-v1',1);r.onerror=()=>reject(Error('IDB read failed'));r.onsuccess=()=>{const d=r.result,t=d.transaction('requests','readonly'),q=t.objectStore('requests').get(scope);q.onsuccess=()=>resolve(q.result);t.oncomplete=()=>d.close();};}),{scope:users.owner.id+':'+partner.id+':'+bid});}
 async function confirmed(p=page){await p.getByTestId('payment-form-'+bid).getByText(/Confirmed receipt:/).waitFor({timeout:90000});}
 async function another(p=page){p.once('dialog',d=>d.accept());await p.getByTestId('payment-form-'+bid).getByRole('button',{name:'Record another payment',exact:true}).click();await p.getByTestId('payment-form-'+bid).getByRole('button',{name:'Confirm Payment',exact:true}).waitFor();}
 await open();await fill(page,1200,'BEFORE-COMMIT');
 stage='lost request before server';
 await page.route(BASE+'/api/jfleet/owner/payments',r=>r.abort('failed'),{times:1});
 await form().getByRole('button',{name:'Confirm Payment',exact:true}).click();await form().getByRole('alert').waitFor();
 const first=await slot();assert.equal(first.phase,'pending');assert.equal((await ledger()).length,0);
 check('Request persisted before a dropped outbound call; ledger remains empty');
 await page.reload();await form().getByRole('button',{name:'Retry saved payment',exact:true}).waitFor();assert.equal((await slot()).request.idempotency_key,first.request.idempotency_key);
 check('Reload restores exactly the same request key and frozen amount');
 assert.ok(await form().getByLabel('Amount received (PHP)',{exact:true}).isDisabled());assert.equal(await form().getByRole('button',{name:'Record another payment',exact:true}).count(),0);
 check('Unresolved payment cannot be edited or reset into a second entry');
 await form().getByRole('button',{name:'Check saved payment',exact:true}).click();await form().getByText(/No receipt is visible yet/).waitFor();assert.equal((await slot()).phase,'pending');
 check('Receipt not-found keeps the unresolved key rather than permitting a replacement');
 await form().getByRole('button',{name:'Retry saved payment',exact:true}).click();await confirmed();assert.equal((await ledger()).length,1);
 check('Retry after pre-server loss records one payment using the original key');
 await page.reload();await confirmed();check('A confirmed receipt survives reload and cannot be silently resubmitted');
 stage='lost response after commit';
 await another();assert.equal(await form().getByLabel('Amount received (PHP)',{exact:true}).inputValue(),'');
 check('Explicit different-payment action opens a blank form');
 await fill(page,1200,'AFTER-COMMIT');let committedResponse;
 await page.route(BASE+'/api/jfleet/owner/payments',async r=>{const actual=await r.fetch();assert.equal(actual.status(),200);committedResponse=await actual.json();await r.abort('failed');},{times:1});
 await form().getByRole('button',{name:'Confirm Payment',exact:true}).click();await form().getByRole('alert').waitFor();assert.ok(committedResponse.receipt);assert.equal((await ledger()).length,2);
 const second=await slot();assert.equal(second.phase,'pending');assert.notEqual(second.request.idempotency_key,first.request.idempotency_key);
 check('Server committed payment while browser lost response; saved intent remains unresolved');
 await page.reload();await form().getByRole('button',{name:'Retry saved payment',exact:true}).waitFor();await form().getByRole('button',{name:'Retry saved payment',exact:true}).click();await confirmed();
 const rows=await ledger();assert.equal(rows.length,2);assert.equal(rows.reduce((n,r)=>n+Number(r.amount),0),2400);assert.equal((await slot()).request.idempotency_key,second.request.idempotency_key);
 check('Lost-response reload and retry keeps two legitimate payments, not a third');
 const customerBooking=(await api(customer,'GET','/api/jfleet/bookings')).bookings.find(b=>b.id===bid);assert.equal(customerBooking.payment_status,'reservation_paid');
 check('Two distinct PHP 1200 payments still meet the unchanged PHP 2400 reservation minimum');
 for(const change of [{amount:1300},{payment_reference:'changed'},{payment_channel:'changed'},{notes:'changed'}])await api(owner,'POST','/api/jfleet/owner/payments',{...second.request,...change},409);
 check('Reusing a key with changed amount or metadata is rejected');
 await api(owner,'POST','/api/jfleet/owner/payments',{...second.request,idempotency_key:undefined},400);assert.equal((await ledger()).length,2);
 check('Legacy requests without a key cannot cause a new payment entry');
 await api(other,'POST','/api/jfleet/owner/payments',second.request,409);
 const lookup='?'+new URLSearchParams({owner_user_id:users.owner.id,partner_id:partner.id,booking_id:bid,idempotency_key:second.request.idempotency_key});
 await api(other,'GET','/api/jfleet/owner/payments'+lookup,undefined,409);
 check('Another owner cannot replay or retrieve the saved account-bound payment');
 stage='two-tab contention';
 await another();await fill(page,600,'TWO-TABS');
 const tab2=await owner.newPage();await open(tab2);await fill(tab2,600,'TWO-TABS');
 await Promise.all([form().getByRole('button',{name:'Confirm Payment',exact:true}).click(),tab2.getByTestId('payment-form-'+bid).getByRole('button',{name:'Confirm Payment',exact:true}).click()]);await confirmed();await confirmed(tab2);
 assert.equal((await ledger()).length,3);assert.equal((await slot()).request.idempotency_key,(await slot(tab2)).request.idempotency_key);
 check('Competing tabs share one atomically saved key and credit only once');
 await another();const gen=(await slot()).generation;
 tab2.once('dialog',d=>d.accept());await tab2.getByTestId('payment-form-'+bid).getByRole('button',{name:'Record another payment',exact:true}).click();
 await tab2.getByTestId('payment-form-'+bid).getByRole('alert').waitFor();assert.equal((await slot()).generation,gen);
 check('A stale tab cannot erase or reset the newer form generation');
 stage='account change and closed-booking recovery';
 await fill(page,500,'ACCOUNT-CHANGE');await page.route(BASE+'/api/jfleet/owner/payments',r=>r.abort('failed'),{times:1});
 await form().getByRole('button',{name:'Confirm Payment',exact:true}).click();await form().getByRole('alert').waitFor();const fourth=await slot();
 await login(owner,'other_owner');await form().getByRole('button',{name:'Retry saved payment',exact:true}).click();await form().getByText(/logged-in owner changed/).waitFor();assert.equal((await ledger()).length,3);
 check('Switching login with an old form open cannot submit under the new owner');
 await login(owner,'owner');await page.route(BASE+'/api/jfleet/owner/payments',async r=>{const actual=await r.fetch();assert.equal(actual.status(),200);await r.abort('failed');},{times:1});
 await form().getByRole('button',{name:'Retry saved payment',exact:true}).click();await form().getByRole('alert').waitFor();assert.equal((await ledger()).length,4);
 await api(customer,'POST','/api/jfleet/bookings/cancel',{booking_id:bid,reason:'LOCAL TEST no actual money moved'});
 await page.reload();await form().getByRole('button',{name:'Check saved payment',exact:true}).waitFor();await form().getByRole('button',{name:'Check saved payment',exact:true}).click();await confirmed();
 const recovered=await api(owner,'POST','/api/jfleet/owner/payments',fourth.request);assert.equal(recovered.replayed,true);assert.equal((await ledger()).length,4);
 check('Payment committed before cancellation can still be recovered without a new credit');
 assert.equal(await form().getByRole('button',{name:'Record another payment',exact:true}).count(),0);check('Closed booking permits receipt recovery but no new payment form');
 stage='storage unavailable';
 const unavailable=await context(390);await login(unavailable,'owner');await unavailable.addInitScript(()=>Object.defineProperty(window,'indexedDB',{value:undefined}));
 const blocked=await unavailable.newPage();let postCount=0;blocked.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/jfleet/owner/payments'))postCount++;});
 await open(blocked);await blocked.getByTestId('payment-form-'+bid).getByRole('alert').waitFor();assert.equal(postCount,0);check('Unavailable durable storage fails closed without a payment POST');
 assert.equal(pageErrors.length,0);check('No uncaught errors in the tested owner page');
 fs.mkdirSync(OUT,{recursive:true});await page.screenshot({path:path.join(OUT,'owner-recovered-payment-desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(OUT,'owner-recovered-payment-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));check('Recovered payment form fits the 390px mobile viewport');
 check('No vehicles or driver approvals were created',(await db(admin.from('jfleet_vehicles').select('id'))).length===0&&(await db(admin.from('jfleet_drivers').select('id'))).length===0);
 const finalRows=await ledger();fs.writeFileSync(path.join(OUT,'ledger-summary.json'),JSON.stringify({payments:finalRows.length,total_original_payments:finalRows.reduce((n,r)=>n+Number(r.amount),0),unique_keys:new Set(finalRows.map(r=>r.idempotency_key)).size,actual_funds_transferred:false},null,2));
 stage='complete';
}
(async()=>{let failure=null;try{await main();}catch(e){failure={stage,message:String(e.message).slice(0,1200)};process.exitCode=1;console.error('FAIL '+stage+': '+failure.message);}finally{
 if(browser)await browser.close().catch(()=>{});if(server){server.kill('SIGTERM');await sleep(500);if(server.exitCode===null)server.kill('SIGKILL');}
 fs.mkdirSync(OUT,{recursive:true});const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
 fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify({commit,passed:checks.length,checks,failures:failure?[failure]:[],requests,auth:'actual isolated Supabase Auth and existing JRide login',database:'actual isolated PostgreSQL/PostgREST; existing seven migrations unchanged',browser:'Chromium desktop and 390px viewport; not physical Android',fault_injection:'drop before server or after actual commit; successful local responses not mocked',maps:'saved simulated geometry; no map-provider use',limits:['Recovery depends on this browser storage; clearing it destroys saved request identity','Independent new entries on different devices need operational reconciliation','Side-trip payment form is not modified by this increment','No actual money transfer or production mutation']},null,2));
 console.log('JFleet payment retry integration: '+checks.length+' checks passed; '+(failure?1:0)+' failures.');}})();
