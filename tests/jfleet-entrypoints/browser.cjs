// Real Chromium + Next pages; ALL auth, business APIs and map services are fixtures.
// Loopback only. This is not an authenticated production or physical-Android test.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const base = process.env.JFLEET_TEST_BASE_URL || 'http://127.0.0.1:3100';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(base)) throw new Error('Browser fixture tests must use a loopback server');
const out = path.resolve('test-results/jfleet-entrypoints');
fs.mkdirSync(out, { recursive: true });
const checks = [], failures = [];
const ID = '11111111-1111-4111-8111-111111111111';
const PLAN = '22222222-2222-4222-8222-222222222222';
const REVIEW = '33333333-3333-4333-8333-333333333333';
const QID = '44444444-4444-4444-8444-444444444444';
const BOOK = '55555555-5555-4555-8555-555555555555';
const CODE = 'JFQ-UI-FIXTURE-NO-REAL-BOOKING';
const day = 86400000, start = Math.floor((Date.now() + 10*day)/day)*day, end = start + day;
const iso = n => new Date(n).toISOString();
const pht = n => new Date(n+28800000).toISOString().slice(0,16);
const clone = o => JSON.parse(JSON.stringify(o));
function fixture() {
  const points = [{label:'Lagawe TEST pickup',lat:16.80,lng:121.10,notes:'TEST only'}, {label:'Baguio TEST stop',lat:16.40,lng:120.60,notes:''}, {label:'Lagawe TEST pickup',lat:16.80,lng:121.10,notes:'Return to pickup'}];
  const route = {provider:'mapbox',profile:'driving',geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])},distance_m:150000,duration_s:10000,snapped_points:points.map(p=>({lat:p.lat,lng:p.lng,distance_m:0}))};
  const snapshot = {inquiry_id:ID,itinerary_id:PLAN,itinerary_version:1,route_plan_id:PLAN,points,route,details:{purpose:'family',vehicle_type:'van',trip_mode:'round_trip',start_epoch:start/1000,end_epoch:end/1000,passenger_count:8,cargo_description:null,cargo_weight_kg:null,luggage_notes:'8 TEST bags',special_notes:'UI fixture, no transport'}};
  return {enabled:true,authed:true,bookingError:false,status:'quote_requested',version:1,snapshot,reviewId:null,reviews:[],revisions:[],quotes:[],booking:null,posts:[],previewPosts:0,acceptPosts:0,staleAccept:false};
}
function row(s) {return {id:ID,inquiry_code:CODE,status:s.status,purpose:'family',requested_vehicle_type:'van',trip_mode:'round_trip',pickup_label:s.snapshot.points[0].label,passenger_count:8,scheduled_start_at:iso(start),scheduled_end_at:iso(end),quote_due_at:iso(Date.now()+10800000),current_itinerary_version:s.version};}
function bookingRow(s, onTrip=false) {return {id:onTrip?'66666666-6666-4666-8666-666666666666':BOOK,booking_code:onTrip?'JFB-TEST-ON-TRIP':'JFB-TEST-RESERVATION',inquiry_id:ID,scheduled_start_at:iso(start),scheduled_end_at:iso(end),original_quote_amount:32000,addon_total:0,reservation_percent:20,reservation_required_amount:6400,cancellation_free_until:iso(start-2*day),final_trip_value:32000,jride_commission_amount:3200,partner_net_amount:28800,status:onTrip?'on_trip':'reservation_pending',payment_status:onTrip?'fully_paid':'reservation_pending',cancellation_penalty_amount:0,refund_amount:0,addons:[],vehicle:null,driver:null};}
function detail(s) {return {ok:true,inquiry_id:ID,inquiry_code:CODE,status:s.status,partner_name:'TEST Transport - Browser Fixture',quote_due_at:iso(Date.now()+10800000),context_token:String(s.version).repeat(64),snapshot:s.snapshot,can_revise:!s.booking,actionable_quote_id:s.quotes[0]?.status==='sent'?s.quotes[0].id:null,terms:{reservation_percent:20,free_cancel_hours:48,late_cancel_percent:10,quote_tat_minutes:180,free_cancel_until_epoch:(start-2*day)/1000},quotes:s.quotes,reviews:s.reviews,revisions:s.revisions,booking:s.booking,map_token:null};}
async function attach(context,s) {
  await context.route('**/*',async r=>{
    const req=r.request(),url=new URL(req.url());
    if(url.origin!==base) return r.abort(); // No map, auth, payment or production traffic.
    if(!url.pathname.startsWith('/api/')) return r.continue();
    const respond=(body,status=200)=>r.fulfill({status,json:body,headers:{'Cache-Control':'no-store'}});
    const p=url.pathname,method=req.method();
    if(p==='/api/public/auth/session')return respond({ok:true,authed:s.authed,user:{id:'browser-fixture',name:'TEST Customer'},role:'passenger'});
    if(p==='/api/jfleet/status')return respond({ok:true,enabled:s.enabled,quote_tat_minutes:180,reservation_percent:20,free_cancel_hours:48,late_cancel_percent:10});
    if(p==='/api/jfleet/bookings')return s.bookingError?respond({ok:false,message:'FIXTURE booking service unavailable'},503):respond({ok:true,bookings:[bookingRow(s),bookingRow(s,true)]});
    if(p==='/api/jfleet/owner/dashboard')return respond({ok:true,partner:{id:REVIEW,display_name:'TEST Transport - Browser Fixture',status:'active',is_priority_pilot:true},inquiries:[row(s)],itineraries:[],itinerary_stops:[],quotes:[],bookings:[bookingRow(s)],payments:[],addons:[],vehicles:[],drivers:[]});
    if(p==='/api/jfleet/owner/routes'&&method==='GET')return url.searchParams.has('inquiry_id')?respond({ok:true,inquiry_code:CODE,status:s.status,quote_due_at:row(s).quote_due_at,snapshot:s.snapshot,snapshot_hash:String(s.version).repeat(64),approved_review_id:s.reviewId,history:s.reviews,map_token:null}):respond({ok:true,inquiries:[row(s)],has_more:false});
    if(p==='/api/jfleet/customer'&&method==='GET')return url.searchParams.has('id')?respond(detail(s)):respond({ok:true,inquiries:[row(s)]});
    if(p==='/api/jfleet/planner'&&method==='GET')return respond({ok:true,map_token:'pk.browser-fixture-no-real-map'});
    if(method==='POST'&&p.startsWith('/api/jfleet/')) {
      const b=req.postDataJSON();s.posts.push({path:p,body:b});
      if(p==='/api/jfleet/inquiries')throw new Error('Retired inquiry writer was used by UI');
      if(p==='/api/jfleet/owner/routes') {
        assert.equal(b.inquiry_id,ID);assert.equal(b.snapshot_hash,String(s.version).repeat(64));
        assert.equal(b.decision,'changes_requested');assert.ok(b.notes.length>=3);
        s.status='revision_requested';s.version++;s.reviews.unshift({id:REVIEW,decision:'changes_requested',notes:b.notes,created_at:iso(Date.now()),itinerary_id:PLAN,itinerary_version:s.snapshot.itinerary_version,snapshot_hash:b.snapshot_hash});
        return respond({ok:true,decision:b.decision});
      }
      if(p==='/api/jfleet/planner') {
        assert.equal(b.action,'preview');s.previewPosts++;
        return respond({ok:true,plan:{id:PLAN,expires_at:iso(Date.now()+1800000),points:b.points,route:s.snapshot.route}});
      }
      if(p==='/api/jfleet/customer') {
        assert.equal(b.inquiry_id,ID);assert.equal(b.context_token,String(s.version).repeat(64));assert.ok(b.reason.length>=3);
        s.version++;s.status='quote_requested';s.snapshot={...s.snapshot,itinerary_version:2,points:b.points,details:{...s.snapshot.details,passenger_count:b.details.passenger_count,start_epoch:Date.parse(b.details.scheduled_start_at)/1000}};
        s.revisions.unshift({id:PLAN,from_version:1,to_version:2,reason:b.reason,created_at:iso(Date.now())});
        return respond({ok:true,inquiry_id:ID,inquiry_code:CODE,quote_due_at:row(s).quote_due_at,itinerary_version:2});
      }
      if(p==='/api/jfleet/owner/quotes') {
        assert.equal(b.inquiry_id,ID);assert.equal(b.route_review_id,REVIEW);assert.equal(b.total_amount,32000);assert.ok(b.exclusions);
        s.version++;s.status='quote_ready';s.quotes=[{id:QID,version_no:2,status:'sent',display_status:'sent',total_amount:b.total_amount,currency:'PHP',valid_until:b.valid_until,inclusions:b.inclusions,exclusions:b.exclusions,pricing_notes:b.pricing_notes,fuel_basis_note:b.fuel_basis_note,sent_at:iso(Date.now()),reservation_required_amount:6400,snapshot:clone(s.snapshot),items:[]}];
        return respond({ok:true,version_no:2,total_amount:32000});
      }
      if(p==='/api/jfleet/quotes/accept') {
        s.acceptPosts++;assert.equal(b.inquiry_id,ID);assert.equal(b.quote_id,QID);assert.equal(b.context_token,String(s.version).repeat(64));assert.equal(b.terms_acknowledged,true);
        if(s.staleAccept)return respond({ok:false,message:'FIXTURE quotation changed. Reload before accepting.'},409);
        s.status='converted';s.booking=bookingRow(s);s.quotes[0].status='accepted';s.quotes[0].display_status='accepted';
        return respond({ok:true,booking_code:s.booking.booking_code,reservation_required_amount:6400});
      }
      throw new Error('Unexpected JFleet write '+p);
    }
    return respond({ok:true,enabled:false,items:[],orders:[],trips:[],bookings:[]});
  });
}
async function step(name,action) {await action();checks.push(name);console.log('PASS '+name);}
async function shown(locator) {await locator.waitFor({state:'visible',timeout:30000});}
async function run(browser,label,viewport) {
  const s=fixture(),context=await browser.newContext({viewport,isMobile:label==='mobile',hasTouch:label==='mobile',serviceWorkers:'block',timezoneId:'America/Los_Angeles'});
  await attach(context,s);const page=await context.newPage();page.setDefaultTimeout(20000);page.setDefaultNavigationTimeout(90000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  try {
    await step(label+' home canonical links and payment-pending distinction',async()=>{
      await page.goto(base+'/jfleet');await shown(page.getByRole('heading',{name:'Your JFleet Bookings'}));
      assert.equal(await page.locator('form').count(),0);
      assert.equal(await page.getByRole('button',{name:'Accept Quote',exact:true}).count(),0);
      const onTrip=page.locator('article').filter({hasText:'JFB-TEST-ON-TRIP'});
      assert.equal(await onTrip.getByRole('button',{name:'Cancel Booking'}).count(),0);
      assert.ok((await page.locator('body').innerText()).includes('PHT'));
      await page.screenshot({path:path.join(out,label+'-home.png'),fullPage:true});
    });
    await step(label+' booking read failure shown instead of false empty list',async()=>{
      s.bookingError=true;await page.reload();await shown(page.getByRole('alert').filter({hasText:'FIXTURE booking service unavailable'}));
      assert.equal(await page.getByText('No accepted quotations or bookings yet.',{exact:false}).count(),0);
      s.bookingError=false;await page.getByRole('button',{name:'Refresh bookings'}).click();await shown(page.getByText('JFB-TEST-RESERVATION',{exact:true}));
    });
    await step(label+' old home opens planner and unpinned request stays blocked',async()=>{
      await page.getByRole('link',{name:'Request a quote',exact:true}).click();await page.waitForURL('**/jfleet/request');
      await shown(page.getByRole('heading',{name:'Pickup and destinations'}));
      await page.getByLabel('Location or landmark').nth(0).fill('TEST pickup');await page.getByLabel('Location or landmark').nth(1).fill('TEST destination');
      await page.getByRole('button',{name:'Preview road route'}).click();await shown(page.getByRole('alert').filter({hasText:'Confirm a map pin'}));
      assert.equal(s.previewPosts,0);assert.equal(await page.getByRole('button',{name:'Request Quote',exact:true}).isDisabled(),true);
    });
    await step(label+' owner old form replaced and exact inquiry deep link works',async()=>{
      await page.goto(base+'/jfleet/owner');await shown(page.getByRole('heading',{name:'JFleet Owner Portal'}));
      assert.equal(await page.getByRole('button',{name:'Send Quote',exact:true}).count(),0);
      assert.equal(await page.getByRole('button',{name:'Confirm Payment',exact:true}).count(),1);
      await page.getByRole('link',{name:'Review route and prepare quotation'}).click();
      await page.waitForURL('**/jfleet/owner/routes?inquiry_id='+ID);await shown(page.getByRole('heading',{name:CODE+' - Itinerary v1'}));
      assert.equal(await page.getByRole('button',{name:'Approve route for quotation'}).isDisabled(),true);
      await page.screenshot({path:path.join(out,label+'-owner-review.png'),fullPage:true});
    });
    await step(label+' owner feedback reaches customer revision entry',async()=>{
      await page.getByLabel('Review notes / required changes').fill('Please clarify the passenger count.');
      await page.getByRole('button',{name:'Request changes',exact:true}).click();await shown(page.getByRole('status').filter({hasText:'Changes requested'}));
      await page.goto(base+'/jfleet');await shown(page.getByRole('link',{name:'View quotations and revisions'}));
      await page.getByRole('link',{name:'View quotations and revisions'}).click();await shown(page.getByRole('heading',{name:'My JFleet inquiries'}));
      await page.getByRole('link').filter({hasText:CODE}).click();await shown(page.getByText('Please clarify the passenger count.',{exact:true}));
      await page.getByRole('link',{name:'Revise itinerary / request new quote'}).click();await shown(page.getByRole('heading',{name:'Revise your JFleet inquiry'}));
      assert.equal(await page.getByLabel('Location or landmark').nth(0).inputValue(),'Lagawe TEST pickup');
    });
    await step(label+' revision preserves inquiry and edits invalidate preview acknowledgment',async()=>{
      await page.getByLabel('Reason for revision').fill('Confirm nine passengers.');await page.getByLabel('Number of passengers').fill('9');
      await page.getByRole('button',{name:'Preview road route'}).click();await shown(page.getByText('150.0 km',{exact:true}));
      const ack=page.getByRole('checkbox');await ack.check();assert.equal(await page.getByRole('button',{name:'Resubmit inquiry for owner review'}).isEnabled(),true);
      await page.getByLabel('Number of passengers').fill('10');assert.equal(await ack.isChecked(),false);assert.equal(await page.getByRole('button',{name:'Resubmit inquiry for owner review'}).isDisabled(),true);
      await page.getByRole('button',{name:'Preview road route'}).click();await shown(page.getByText('150.0 km',{exact:true}));await ack.check();
      await page.getByRole('button',{name:'Resubmit inquiry for owner review'}).click();await shown(page.getByRole('heading',{name:'Revised inquiry submitted'}));
      assert.equal(s.revisions.length,1);assert.equal(s.booking,null);assert.equal(s.posts.filter(p=>p.path==='/api/jfleet/customer').length,1);
      await page.screenshot({path:path.join(out,label+'-revision.png'),fullPage:true});
    });
    // A prior owner approval is a fixture. This does not pretend to exercise a live map approval.
    s.reviewId=REVIEW;s.status='under_review';
    await step(label+' reviewed owner quote carries the displayed approval ID',async()=>{
      await page.goto(base+'/jfleet/owner/routes?inquiry_id='+ID);await shown(page.getByRole('heading',{name:'Issue quotation for this approved route'}));
      await page.getByLabel('Total quotation (PHP)',{exact:true}).fill('32000');await page.getByLabel('Valid until (Philippines time)',{exact:true}).fill(pht(start-day));
      await page.getByLabel('Included',{exact:true}).fill('Vehicle, driver and approved itinerary fuel');await page.getByLabel('Excluded / customer-paid items',{exact:true}).fill('Tolls and parking');
      await page.getByLabel('Fuel pricing basis',{exact:true}).fill('Fixture quotation, no real hire');
      assert.equal(await page.getByRole('button',{name:'Send reviewed quotation'}).isDisabled(),true);
      await page.getByRole('checkbox',{name:'I confirm this price and its inclusions/exclusions apply to the displayed approved itinerary.'}).check();
      await page.getByRole('button',{name:'Send reviewed quotation'}).click();await shown(page.getByRole('status').filter({hasText:'Quotation v2 saved'}));
    });
    await step(label+' complete quote requires acknowledgment and shows total-based penalty',async()=>{
      await page.goto(base+'/jfleet/inquiries/'+ID);await shown(page.getByRole('heading',{name:'Complete quotation'}));
      await shown(page.getByText('Tolls and parking',{exact:true}));await shown(page.getByText('PHP 6,400.00',{exact:true}));
      assert.ok((await page.locator('body').innerText()).includes('PHP 3,200.00'));
      assert.equal(await page.getByRole('button',{name:'Accept quote v2 - PHP 32,000.00'}).isDisabled(),true);
      await page.screenshot({path:path.join(out,label+'-quotation.png'),fullPage:true});
    });
    await step(label+' stale quote response clears consent without claiming booking',async()=>{
      s.staleAccept=true;await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Accept quote v2 - PHP 32,000.00'}).click();
      await shown(page.getByRole('alert').filter({hasText:'FIXTURE quotation changed'}));assert.equal(s.booking,null);
      assert.equal(await page.getByRole('checkbox').isChecked(),false);s.staleAccept=false;
    });
    await step(label+' accepted response returns to reservation-pending booking',async()=>{
      await page.getByRole('button',{name:'Refresh inquiry'}).click();await shown(page.getByRole('button',{name:'Accept quote v2 - PHP 32,000.00'}));
      await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Accept quote v2 - PHP 32,000.00'}).click();
      await shown(page.getByRole('status').filter({hasText:'reservation pending'}));assert.equal(s.booking.status,'reservation_pending');
      await page.getByRole('link',{name:'View booking',exact:true}).click();await page.waitForURL(base+'/jfleet');await shown(page.getByText('JFB-TEST-RESERVATION',{exact:true}));
      const b=page.locator('article').filter({hasText:'JFB-TEST-RESERVATION'});await b.getByRole('link',{name:'View accepted quotation and itinerary history'}).click();await page.waitForURL('**/jfleet/inquiries/'+ID);
      assert.equal(s.posts.filter(p=>p.path==='/api/jfleet/inquiries').length,0);
    });
    await step(label+' responsive page has no horizontal overflow or uncaught page errors',async()=>{
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);
    });
    await step(label+' disabled and signed-out states stay nonoperational',async()=>{
      s.enabled=false;await page.goto(base+'/jfleet');await shown(page.getByText('JFleet is still being prepared for its pilot transport partner.',{exact:true}));assert.equal(await page.locator('form').count(),0);
      s.enabled=true;s.authed=false;await page.goto(base+'/jfleet/request');await shown(page.getByRole('link',{name:'Sign in to plan your trip'}));assert.equal(await page.locator('form').count(),0);
    });
  }catch(e){await page.screenshot({path:path.join(out,label+'-failure.png'),fullPage:true}).catch(()=>{});failures.push({viewport:label,message:e.message,page_errors:errors});throw e;}
  finally{fs.writeFileSync(path.join(out,label+'-requests.json'),JSON.stringify(s.posts,null,2));await context.close();}
}
(async()=>{
  const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  try {await run(browser,'desktop',{width:1280,height:900});await run(browser,'mobile',{width:390,height:844});}
  finally {await browser.close();const report={passed:checks.length,checks,failures,environment:'Chromium with real Next pages on loopback',viewports:'desktop and mobile emulation',authentication:'fixture, not real login',business_api:'fixture, no database calls',maps:'offline/unavailable fixture; no live routing verification',physical_android:'not tested',production_writes:0};fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
})().catch(e=>{console.error(e);process.exitCode=1;});
