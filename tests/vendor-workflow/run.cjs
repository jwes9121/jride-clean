// Runs against the actual route handlers and order feed. No network or live data.
// From the repository root: node tests/vendor-workflow/run.cjs
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
let ts, babel;
try { ts = require('typescript'); } catch {
  if (!process.env.JRIDE_TEST_BABEL_BUNDLE) throw Error('Install repository dependencies first.');
  babel = require(process.env.JRIDE_TEST_BABEL_BUNDLE);
}
const compile = (source,file) => ts ? ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText : babel.babelTransform(source,file,false,[],[]).code;
const copy = value => JSON.parse(JSON.stringify(value));
const vendor = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const driver = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS ' + name); }

function database(rows = []) {
  const db = { tables: { bookings: copy(rows), vendor_onboarding_credentials:[{vendor_id:vendor,vendor_name:'Test vendor',town:'Lagawe',status:'active'}], driver_locations:[], driver_profiles:[], takeout_order_items:[] }, writes:[], reads:[], beforeUpdate:null };
  db.from = table => {
    let mode='read', patch, single=false, limit=Infinity, countOnly=false;
    const filters=[];
    const q = {
      select(_fields,opts) { if (opts?.head) countOnly=true; return q; },
      update(value) { mode='update'; patch=value; return q; },
      eq(key,value) { filters.push(row => row[key] === value); return q; },
      is(key,value) { filters.push(row => value === null ? row[key] == null : row[key] === value); return q; },
      in(key,values) { filters.push(row => values.includes(row[key])); return q; },
      not(key,op,value) { assert.equal(op,'in'); const values=value.slice(1,-1).split(','); filters.push(row => row[key] != null && !values.includes(row[key])); return q; },
      gt(key,value) { filters.push(row => row[key] > value); return q; },
      lte(key,value) { filters.push(row => row[key] <= value); return q; },
      or(expression) { const alternatives=expression.split(',').map(term => { const [key,op,...parts]=term.split('.'); const value=parts.join('.'); return row => op==='is' ? row[key]==null : row[key]===value; }); filters.push(row => alternatives.some(fn=>fn(row))); return q; },
      order() { return q; }, limit(value) { limit=value; return q; },
      single() { single=true; return q; }, maybeSingle() { single=true; return q; },
      then(resolve,reject) { return Promise.resolve().then(() => {
        if(mode==='update' && db.beforeUpdate) db.beforeUpdate({table,patch,db});
        const matches=(db.tables[table] || []).filter(row=>filters.every(fn=>fn(row))).slice(0,limit);
        if(mode==='update') { db.writes.push({table,patch:copy(patch),ids:matches.map(row=>row.id)}); for(const row of matches) Object.assign(row,copy(patch)); }
        else db.reads.push(table);
        return {data:countOnly?null:copy(single?(matches[0]||null):matches),error:null,count:matches.length};
      }).then(resolve,reject); },
    };
    return q;
  };
  db.auth={getUser:async()=>({data:{user:null}})};
  return db;
}
function booking(changes={}) { return {id:'order-1',booking_code:'TO-TEST-7816',vendor_id:vendor,service_type:'takeout',vendor_status:'vendor_pending',customer_status:'vendor_pending',status:'requested',created_at:new Date(Date.now()-60000).toISOString(),updated_at:new Date().toISOString(),assigned_driver_id:null,driver_id:null,pickup_lat:17.08,pickup_lng:121.12,dropoff_lat:17.09,dropoff_lng:121.13,takeout_items_subtotal:90,town:'Lagawe',takeout_customer_confirmed_at:null,...changes}; }
function harness(db, globals={}) {
  const cache = new Map();
  const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',VENDOR_SESSION_SECRET:'test-only-cookie-secret',TAKEOUT_ENABLED:'1'};
  function load(file) {
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const filename=path.join(root,file);
    const element=(type,props,key)=>({type,props:props||{},key});
    const mocks={ 'react/jsx-runtime':{jsx:element,jsxs:element,Fragment:'fragment'}, 'next/server':{NextResponse:{json:(body,options={})=>({status:options.status||200,body,headers:options.headers})}}, 'next/headers':{cookies:()=>({})}, '@supabase/auth-helpers-nextjs':{createRouteHandlerClient:()=>db}, '@supabase/supabase-js':{createClient:()=>db}, '@/auth':{auth:async()=>null} };
    const req=name=>{
      if(mocks[name])return mocks[name];
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      if(name.startsWith('.'))return load(path.posix.normalize(path.posix.join(path.posix.dirname(file),name))+'.ts');
      return require(name);
    };
    const context={module,exports:module.exports,require:req,process:{env},console,Buffer,URL,Headers,Date,AbortController,fetch:async()=>{throw Error('Unexpected network request');},setTimeout,clearTimeout,...globals};
    vm.runInNewContext(compile(fs.readFileSync(filename,'utf8'),filename),context,{filename});
    return module.exports;
  }
  const session=load('lib/vendorSession.ts');
  const token=session.signVendorSession(vendor);
  const request=(body={},options={})=>{
    const url=new URL('https://app.jride.net/api/vendor-orders'+(options.query===undefined?'?vendor_id='+vendor:options.query));
    const value=options.token===undefined?token:options.token;
    return {nextUrl:url,headers:new Headers({origin:options.origin||url.origin}),cookies:{get:key=>key==='jr_vendor_session'&&value?{value}:undefined},json:async()=>body};
  };
  return {load,request,token,session};
}

async function routes() {
  await test('missing, invalid, expired, and wrong-vendor sessions cannot read or mutate orders',async()=>{
    for(const token of ['', 'invalid']) for(const method of ['GET','POST']) { const db=database([booking()]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts'); const result=await api[method](h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'vendor_accepted'},{token}));assert.equal(result.status,401);assert.equal(db.writes.length,0);assert(!db.reads.includes('bookings')); }
    const db=database([booking()]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');
    for(const method of ['GET','POST']) {const result=await api[method](h.request({vendor_id:other,order_id:'order-1',vendor_status:'vendor_accepted'},{query:'?vendor_id='+other}));assert.equal(result.status,403);}
    db.tables.vendor_onboarding_credentials[0].status='disabled';assert.equal((await api.GET(h.request())).status,401);assert.equal(db.writes.length,0);
    const crypto=require('node:crypto');const body=Buffer.from(JSON.stringify({v:vendor,iat:0,exp:1})).toString('base64url');const expired=body+'.'+crypto.createHmac('sha256','test-only-cookie-secret').update(body).digest('base64url');assert.equal((await api.GET(h.request({}, {token:expired}))).status,401);
  });
  await test('signed vendor scope works and cross-origin updates are rejected',async()=>{
    const db=database([booking(),booking({id:'other-order',vendor_id:other})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');const result=await api.GET(h.request({}, {query:''}));assert.equal(result.status,200);assert.equal(result.body.orders.length,1);assert.equal(result.body.vendor_id,vendor);assert(result.body.server_now);assert.equal(result.headers['Cache-Control'],'private, no-store, max-age=0');assert.equal((await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'vendor_accepted'},{origin:'https://other.invalid'}))).status,403);
  });
  await test('passenger creation still reaches verified-passenger authorization, not vendor login',async()=>{
    const db=database(),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');const result=await api.POST(h.request({vendor_id:vendor,items:[{name:'Test',price:90,quantity:1}]},{token:''}));assert.equal(result.body.error,'PASSENGER_AUTH_REQUIRED');assert(!db.reads.includes('vendor_onboarding_credentials'));
  });
  await test('five-minute expiry never overwrites accepted, cancelled, or assigned orders',async()=>{
    const old=new Date(Date.now()-360000).toISOString();
    for(const state of ['vendor_accepted','driver_assigned','driver_accepted','cancelled']) {const db=database([booking({created_at:old})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');db.beforeUpdate=({db})=>{db.beforeUpdate=null;Object.assign(db.tables.bookings[0],{vendor_status:state,status:state==='cancelled'?'cancelled':'assigned',assigned_driver_id:state==='cancelled'?null:driver});};const result=await api.GET(h.request());assert.equal(result.status,200);assert.equal(result.body.orders[0].vendor_status,state);assert.equal(db.tables.bookings[0].vendor_status,state);}
    const db=database([booking({created_at:old})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');const result=await api.GET(h.request());assert.equal(result.body.orders[0].vendor_status,'vendor_timeout');assert.match(result.body.orders[0].cancel_reason,/5 minutes/);assert.equal(Date.parse(result.body.orders[0].vendor_accept_expires_at)-Date.parse(old),300000);
  });
  await test('acceptance loses safely to expiry, cancellation, and duplicate taps',async()=>{
    for(const state of ['cancelled','vendor_timeout','vendor_accepted']) {const db=database([booking()]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');db.beforeUpdate=({db})=>{db.beforeUpdate=null;db.tables.bookings[0].vendor_status=state;};const result=await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'vendor_accepted'}));assert.equal(result.status,409);assert.equal(db.tables.bookings[0].vendor_status,state);assert(!db.reads.includes('driver_locations'));}
    const db=database([booking({created_at:new Date(Date.now()-300000).toISOString()})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');assert.equal((await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'vendor_accepted'}))).body.error,'VENDOR_ACCEPT_EXPIRED');
  });
  await test('ready requires explicit customer approval and preserves driver/canonical/fee fields',async()=>{
    for(const state of ['vendor_accepted','driver_assigned','driver_accepted','cash_collected','preparing','rider_arrived_vendor']) for(const confirmed of [false,true]) {const db=database([booking({vendor_status:state,status:'fare_proposed',assigned_driver_id:driver,driver_id:driver,driver_status:'rider_arrived_vendor',takeout_total_payable:140,takeout_delivery_fee:40,takeout_customer_confirmed_at:confirmed?new Date().toISOString():null})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');const result=await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'pickup_ready'}));assert.equal(result.status,confirmed?200:409);assert.equal(db.tables.bookings[0].status,'fare_proposed');assert.equal(db.tables.bookings[0].driver_status,'rider_arrived_vendor');assert.equal(db.tables.bookings[0].takeout_total_payable,140);assert.equal(db.tables.bookings[0].takeout_delivery_fee,40);}
  });
  await test('ready cannot overwrite pickup, completion, or a reassignment',async()=>{
    for(const change of [{vendor_status:'picked_up'},{vendor_status:'completed',status:'completed'},{assigned_driver_id:other,driver_id:other},{takeout_customer_confirmed_at:null}]) {const db=database([booking({vendor_status:'driver_accepted',status:'accepted',assigned_driver_id:driver,driver_id:driver,takeout_customer_confirmed_at:new Date().toISOString()})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');db.beforeUpdate=({db})=>{db.beforeUpdate=null;Object.assign(db.tables.bookings[0],change);};const result=await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'pickup_ready'}));assert.equal(result.status,409);for(const [key,value] of Object.entries(change))assert.equal(db.tables.bookings[0][key],value);}
  });
  await test('vendor cannot complete a trip or cancel after assignment',async()=>{
    const db=database([booking({vendor_status:'pickup_ready',assigned_driver_id:driver,driver_id:driver})]),h=harness(db),api=h.load('app/api/vendor-orders/route.ts');for(const next of ['completed','cancelled'])assert.equal((await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:next,cancel_reason:'Test'}))).status,409);assert.equal(db.writes.length,0);
  });
  await test('full route sequence: accept, assign, driver accept, customer confirm, ready, pickup, delivery, complete',async()=>{
    const db=database([booking()]);db.tables.driver_locations=[{driver_id:driver,lat:17.08,lng:121.12,status:'online',updated_at:new Date().toISOString(),town:'Lagawe',home_town:'Lagawe'}];
    const h=harness(db),api=h.load('app/api/vendor-orders/route.ts'),driverApi=h.load('app/api/driver/takeout-status/route.ts');let result=await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'vendor_accepted'}));assert.equal(result.status,200);assert.equal(db.tables.bookings[0].vendor_status,'driver_assigned');assert.equal(db.tables.bookings[0].driver_id,driver);
    result=await driverApi.POST(h.request({driver_id:driver,order_id:'order-1',status:'driver_accepted'}));assert.equal(result.status,200);
    // Customer confirmation is set by the existing passenger flow, not vendor code.
    db.tables.bookings[0].takeout_customer_confirmed_at=new Date().toISOString();
    assert.equal((await api.POST(h.request({vendor_id:vendor,order_id:'order-1',vendor_status:'pickup_ready'}))).status,200);
    for(const status of ['picked_up','delivering','completed']) {result=await driverApi.POST(h.request({driver_id:driver,order_id:'order-1',status}));assert.equal(result.status,200);assert.equal(db.tables.bookings[0].vendor_status,status);}
    assert.equal(db.tables.bookings[0].status,'completed');assert(db.tables.bookings[0].completed_at);assert.equal(result.body.wallet_deduction.owner,'database_trigger');
  });
  await test('existing driver pickup path remains supported when the vendor did not press Ready',async()=>{
    const db=database([booking({vendor_status:'driver_accepted',status:'fare_proposed',assigned_driver_id:driver,driver_id:driver,takeout_customer_confirmed_at:new Date().toISOString()})]);
    const h=harness(db),api=h.load('app/api/driver/takeout-status/route.ts'),workflow=h.load('lib/vendorOrderWorkflow.ts');
    for(const status of ['picked_up','delivering','completed']) {
      const result=await api.POST(h.request({driver_id:driver,order_id:'order-1',status}));
      assert.equal(result.status,200);assert.equal(workflow.orderStatus(db.tables.bookings[0]),status);assert(!workflow.canMarkReady(db.tables.bookings[0]));
      if(status==='completed')assert.equal(result.body.wallet_deduction.owner,'database_trigger');
    }
  });
}

async function client() {
  const h=harness(database()),workflow=h.load('lib/vendorOrderWorkflow.ts');
  await test('UI deadline, preparation, final-status labels, and urgent ordering agree',async()=>{
    const now=Date.now(),order=booking();assert.equal(workflow.acceptDeadline(order)-Date.parse(order.created_at),300000);assert.equal(workflow.acceptDeadline({}),0);assert(!workflow.isPending({...order,created_at:new Date(now-300000).toISOString()},now));assert(!workflow.canMarkReady({...order,vendor_status:'driver_accepted',takeout_pricing_status:'accepted'}));assert(workflow.canMarkReady({...order,vendor_status:'driver_accepted',takeout_customer_confirmed_at:new Date().toISOString()}));assert.equal(workflow.orderStatus({...order,status:'cancelled'}),'cancelled');assert.equal(workflow.orderStage({...order,vendor_status:'picked_up'}).title,'Picked up');assert.equal(workflow.orderStage({...order,vendor_status:'delivering'}).title,'Out for delivery');const urgent={...order,id:'urgent',created_at:new Date(now-280000).toISOString()};assert.equal(workflow.sortActive([{...order,id:'active',vendor_status:'driver_accepted'},order,urgent],now)[0].id,'urgent');
  });
  await test('selected order stays stable; completed orders fall back to the most urgent active order',async()=>{
    const now=Date.now(),chosen=booking({id:'chosen',vendor_status:'driver_accepted'}),urgent=booking({id:'urgent',created_at:new Date(now-290000).toISOString()}),next=booking({id:'next'});
    assert.equal(workflow.selectedActiveOrder(workflow.sortActive([next,chosen,urgent],now),'chosen').id,'chosen');
    assert.equal(workflow.selectedActiveOrder(workflow.sortActive([next,{...chosen,status:'completed'},urgent],now),'chosen').id,'urgent');
    assert.equal(workflow.selectedActiveOrder([], 'chosen'),null);
    assert.equal(workflow.orderBadge(booking({vendor_status:'vendor_accepted'})),'Finding driver');
    assert.equal(workflow.orderBadge(booking({vendor_status:'driver_assigned',driver_id:driver})),'Driver confirmation');
    assert.equal(workflow.orderBadge(booking({vendor_status:'driver_accepted'})),'Driver setting fee');
    assert.equal(workflow.orderBadge(booking({vendor_status:'driver_accepted',takeout_fee_proposed_at:new Date().toISOString()})),'Customer approval');
    assert.equal(workflow.orderFreshness(now-5000,now,false,false),'Updated 5 seconds ago');
    assert.equal(workflow.orderFreshness(now-5000,now,true,false),'Connection needed');
    assert.equal(workflow.orderFreshness(now-5000,now,true,true),'Updating...');
  });
  await test('obsolete preparation instructions clear on ready, pickup, delivery, cancellation and completion',async()=>{
    const {reconcileOrderNotices}=h.load('lib/vendorOrderFeed.ts');
    const before=booking({vendor_status:'driver_accepted'}),approved={...before,takeout_customer_confirmed_at:new Date().toISOString()};
    const notice=reconcileOrderNotices([before],[approved],[]);assert.equal(notice.length,1);
    for(const status of ['pickup_ready','picked_up','delivering','cancelled','completed','vendor_timeout']) {
      const next={...approved,vendor_status:status};
      const result=reconcileOrderNotices([approved],[next],notice);
      assert(!result.some(item=>item.title.includes('prepare now')));
      assert.equal(result.length,['cancelled','completed','vendor_timeout'].includes(status)?1:0);
    }
    assert.equal(reconcileOrderNotices([before],[{...approved,vendor_status:'picked_up'}],[]).length,0);
    assert.equal(reconcileOrderNotices([],[{...approved,status:'completed',vendor_status:'completed'}],[]).length,0);
    const second={...approved,id:'other-active'};
    const both=reconcileOrderNotices([before,{...before,id:'other-active'}],[approved,second],[]);
    const updated=reconcileOrderNotices([approved,second],[{...approved,status:'completed',vendor_status:'completed'},second],both);
    assert.equal(updated.length,2);assert(updated.some(item=>item.orderId==='other-active'&&!item.closed));assert(updated.some(item=>item.orderId==='order-1'&&item.closed));
  });
  await test('fixed order panel exposes only valid actions and disables expiry, stale and duplicate submission',async()=>{
    const Focus=h.load('app/components/VendorOrderFocus.tsx').default;
    const flatten=node=>!node||typeof node!=='object'?[]:Array.isArray(node)?node.flatMap(flatten):[node,...flatten(node.props?.children)];
    const textOf=node=>node==null||typeof node==='boolean'?'':Array.isArray(node)?node.map(textOf).join(''):typeof node==='object'?textOf(node.props?.children):String(node);
    let calls=[];const now=Date.now();
    const render=(order,extra={})=>flatten(Focus({order,active:[order],now,disabled:false,savingId:'',driverPhone:'tel:+639000000000',onAccept:()=>calls.push('accept'),onDecline:()=>calls.push('decline'),onReady:()=>calls.push('ready'),onItems:()=>calls.push('items'),onSelect:id=>calls.push(id),...extra}));
    const base=booking({items:[{name:'Test item',quantity:1,price:90}]});
    const buttons=nodes=>nodes.filter(node=>node.type==='button');
    const find=(nodes,label)=>buttons(nodes).find(node=>textOf(node)===label);
    const newOrder=render(base);find(newOrder,'Accept order').props.onClick();assert.deepEqual(calls,['accept']);
    assert(find(render(base,{disabled:true}),'Accept order').props.disabled);
    assert(find(render({...base,created_at:new Date(now-300000).toISOString()}),'Accept order').props.disabled);
    assert(find(render({...base,items:[]}),'Accept order').props.disabled);
    const waiting={...base,vendor_status:'driver_accepted'};assert(!find(render(waiting),'Mark order ready'));
    const approved={...waiting,takeout_customer_confirmed_at:new Date().toISOString()};
    find(render(approved),'Mark order ready').props.onClick();assert.deepEqual(calls,['accept','ready']);
    assert(find(render(approved,{disabled:true,savingId:'order-1'}),'Confirming...').props.disabled);
    for(const status of ['pickup_ready','picked_up','delivering','completed','cancelled'])assert(!find(render({...approved,vendor_status:status}),'Mark order ready'));
    const multiple=render(approved,{active:[approved,{...base,id:'other-order'}]});const selector=multiple.find(node=>node.type==='select');selector.props.onChange({target:{value:'other-order'}});assert.equal(calls.at(-1),'other-order');
    assert(multiple.some(node=>node.type==='a'&&node.props.href==='tel:+639000000000'));
  });
  const events=()=>{const listeners=new Map();return {addEventListener:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},removeEventListener:(name,fn)=>listeners.get(name)?.delete(fn),fire:name=>listeners.get(name)?.forEach(fn=>fn())};};
  const window=events(),document={...events(),visibilityState:'visible'};
  const timers=new Map();let nextTimer=0;const requests=[];
  const fetch=(_url,options)=>new Promise((resolve,reject)=>requests.push({resolve,reject,signal:options.signal}));
  const setTimer=(fn,delay)=>{const id=++nextTimer;timers.set(id,{fn,delay});return id;};
  const hh=harness(database(),{window,document,fetch,setTimeout:setTimer,clearTimeout:id=>timers.delete(id)});
  const {createVendorOrderFeed}=hh.load('lib/vendorOrderFeed.ts');const feed=createVendorOrderFeed(vendor);
  const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
  const respond=(request,orders,status=200)=>request.resolve({ok:status===200,status,json:async()=>({ok:status===200,vendor_id:vendor,orders,server_now:new Date().toISOString()})});
  let stop1,stop2;
  await test('two consumers share one request; foreground return replaces suspended requests',async()=>{
    stop1=feed.subscribe(()=>{});stop2=feed.subscribe(()=>{});assert.equal(requests.length,1);respond(requests[0],[booking()]);await flush();assert(!feed.getSnapshot().stale);
    void feed.refresh();const delayed=requests.at(-1);document.visibilityState='hidden';document.fire('visibilitychange');assert(delayed.signal.aborted);assert(feed.getSnapshot().stale);document.visibilityState='visible';document.fire('visibilitychange');const fresh=requests.at(-1);respond(fresh,[booking({vendor_status:'driver_accepted'})]);await flush();respond(delayed,[booking()]);await flush();assert.equal(feed.getSnapshot().orders[0].vendor_status,'driver_accepted');assert(!feed.getSnapshot().stale);
  });
  await test('refresh failure retains data, disables actions, and schedules an automatic retry',async()=>{
    void feed.refresh();requests.at(-1).reject(Error('Network lost'));await flush();assert.equal(feed.getSnapshot().orders.length,1);assert(feed.getSnapshot().stale);assert(feed.getSnapshot().error);assert([...timers.values()].some(t=>t.delay===2000));window.fire('online');respond(requests.at(-1),[booking({vendor_status:'driver_accepted'})]);await flush();assert(!feed.getSnapshot().stale);
  });
  await test('completion replaces preparation notices instead of stacking contradictory instructions',async()=>{
    void feed.refresh();respond(requests.at(-1),[booking({vendor_status:'driver_accepted',takeout_customer_confirmed_at:new Date().toISOString()})]);await flush();assert.equal(feed.getSnapshot().notices.length,1);assert.match(feed.getSnapshot().notices[0].title,/prepare now/);void feed.refresh();respond(requests.at(-1),[booking({vendor_status:'completed',status:'completed'})]);await flush();assert.equal(feed.getSnapshot().notices.length,1);assert.match(feed.getSnapshot().notices[0].title,/completed/);void feed.refresh();respond(requests.at(-1),[booking({vendor_status:'completed',status:'completed'})]);await flush();assert.equal(feed.getSnapshot().notices.length,1);
    feed.dismissNotice(feed.getSnapshot().notices[0].id);void feed.refresh();respond(requests.at(-1),[booking({vendor_status:'completed',status:'completed'})]);await flush();assert.equal(feed.getSnapshot().notices.length,0);
  });
  await test('confirmed actions stop pending alerts and stale responses cannot restore them',async()=>{
    void feed.refresh();respond(requests.at(-1),[booking()]);await flush();void feed.refresh();const old=requests.at(-1);feed.acknowledge('order-1','vendor_accepted');respond(old,[booking()]);await flush();assert(!workflow.isPending(feed.getSnapshot().orders[0],Date.now()));assert(feed.getSnapshot().stale);
  });
  await test('unauthorized refresh clears order data; subscriptions clean up polling',async()=>{
    void feed.refresh();respond(requests.at(-1),[],401);await flush();assert.equal(feed.getSnapshot().orders.length,0);assert(feed.getSnapshot().authRequired);assert.equal(feed.getSnapshot().notices.length,0);stop1();stop2();assert.equal(timers.size,0);
  });
}

(async()=>{await routes();await client();console.log('\n'+passed+' vendor workflow test groups passed. No production orders changed.');})().catch(error=>{console.error(error);process.exitCode=1;});
