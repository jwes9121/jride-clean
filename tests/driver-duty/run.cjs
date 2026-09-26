// Exercise the real route handlers with an atomic in-memory Supabase adapter.
// No network, production credentials, or live driver writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const {randomUUID} = require('node:crypto');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const driver = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const other = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const initial = '00000000-0000-0000-0000-000000000000';
const copy = x => JSON.parse(JSON.stringify(x));
let passed = 0;
async function test(name, run) { await run(); passed++; console.log('PASS '+name); }
function database(location = {driver_id:driver,status:'online',lat:17.08,lng:121.12,duty_revision:randomUUID()}) {
  const db = {tables:{driver_locations:location?[copy(location)]:[],driver_profiles:[{driver_id:driver,vehicle_type:'tricycle'}],driver_device_locks:[{driver_id:driver,device_id:'emulator-test',last_seen:new Date().toISOString()}]}, writes:[], cancellations:[], beforeWrite:null, failRead:false, failWrite:false};
  db.auth = {getUser:async token=>({data:{user:token==='valid-token'?{id:driver}:null},error:null})};
  db.rpc = async()=>({data:null,error:null});
  db.from = table => {
    let mode='read',patch,single=false; const filters=[];
    const q = {
      select(){return q;},limit(){return q;},order(){return q;},abortSignal(){return q;},or(){return q;},in(){return q;},is(){return q;},gte(){return q;},lte(){return q;},
      eq(k,v){filters.push(row=>row[k]===v);return q;},
      update(v){mode='update';patch=v;return q;},insert(v){mode='insert';patch=v;return q;},
      maybeSingle(){single=true;return q;},single(){single=true;return q;},
      then(resolve,reject){return Promise.resolve().then(async()=>{
        const isDuty=table==='driver_locations';
        if(isDuty&&mode==='read'&&db.failRead)return {data:null,error:{message:'read failed'}};
        if(isDuty&&mode!=='read'&&db.failWrite)return {data:null,error:{code:'XX000',message:'write failed'}};
        if(isDuty&&mode!=='read'&&db.beforeWrite)await db.beforeWrite({mode,patch});
        const rows=db.tables[table]||(db.tables[table]=[]);
        let matches=rows.filter(row=>filters.every(fn=>fn(row)));
        if(mode==='insert') {
          if(rows.some(row=>row.driver_id===patch.driver_id))return {data:null,error:{code:'23505',message:'duplicate'}};
          const row=copy(patch);if(isDuty)row.duty_revision=randomUUID();rows.push(row);matches=[row];
        }
        if(mode==='update')for(const row of matches){Object.assign(row,copy(patch));if(isDuty)row.duty_revision=randomUUID();}
        if(mode!=='read')db.writes.push({table,mode,count:matches.length,patch:copy(patch)});
        return {data:copy(single?(matches[0]||null):matches),error:null};
      }).then(resolve,reject);},
    };return q;
  };return db;
}
function harness(db, options = {}) {
  const cache=new Map();
  const logs=[];
  const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only',SUPABASE_ANON_KEY:'test-anon',DRIVER_PING_SECRET:'test-secret'};
  function load(file){
    if(cache.has(file))return cache.get(file).exports;
    const module={exports:{}};cache.set(file,module);
    const req=name=>{
      if(name==='next/server')return {NextResponse:{json:(body,options={})=>({body,status:options.status||200,headers:options.headers})}};
      if(name==='@supabase/supabase-js')return {createClient:()=>db};
      if(name==='@/lib/driver-duty-check/onlineGuard')return {cancelPendingDutyChecksForOfflineDriver:async(_db,args)=>{db.cancellations.push(args);return {ok:true};}};
      if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
      return require(name);
    };
    const code=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
    vm.runInNewContext(code,{module,exports:module.exports,require:req,process:{env},URL,Date:options.Date||Date,Set,Number,AbortController,setTimeout,clearTimeout,console:{log(...args){logs.push(copy(args));},warn(){},error(){}},fetch:async()=>{throw Error('Unexpected network call');}},{filename:file});
    return module.exports;
  }
  const api=load('app/api/driver/location/ping/route.ts');
  function request(body={},options={}){
    const headers=new Headers(options.auth==='none'?{}:options.auth==='bearer'?{authorization:'Bearer valid-token'}:{'x-jride-driver-secret':'test-secret'});
    const url='https://test.invalid/api/driver/location/ping?driver_id='+(options.driver||driver);
    return {url,nextUrl:new URL(url),headers,json:async()=>body};
  }
  const ordered=(status,revision=db.tables.driver_locations[0]?.duty_revision||initial,extra={})=>({driver_id:driver,device_id:'emulator-test',status,duty_ordering_v1:true,duty_expected_revision:revision,...extra});
  return {api,request,ordered,load,logs};
}
(async()=>{
  await test('handshake authenticates and does not mutate duty or device locks',async()=>{
    const db=database(),h=harness(db);
    assert.equal((await h.api.GET(h.request({}, {auth:'none'}))).status,401);
    assert.equal((await h.api.POST(h.request(h.ordered('offline'),{auth:'none'}))).status,401);
    const r=await h.api.GET(h.request());assert.equal(r.status,200);assert.equal(r.body.ordering_version,1);assert.equal(r.body.duty_revision,db.tables.driver_locations[0].duty_revision);assert.equal(r.headers['Cache-Control'],'no-store');assert.equal(db.writes.length,0);
  });
  await test('bearer identity cannot read or update another driver',async()=>{
    const db=database(),h=harness(db);
    assert.equal((await h.api.GET(h.request({}, {auth:'bearer',driver:other}))).status,403);
    assert.equal((await h.api.POST(h.request(h.ordered('offline',undefined,{driver_id:other}),{auth:'bearer'}))).status,403);
    assert.equal((await h.api.GET(h.request({}, {auth:'bearer'}))).body.driver_id,driver);assert.equal(db.writes.length,0);
  });
  await test('missing presence returns a read-only initial revision',async()=>{
    const db=database(null),h=harness(db),r=await h.api.GET(h.request());
    assert.equal(r.body.duty_revision,initial);assert.equal(db.writes.length,0);
    const done=await h.api.POST(h.request(h.ordered('offline')));assert.equal(done.status,200);assert.equal(done.body.status,'offline');assert.notEqual(done.body.duty_revision,initial);assert.equal(db.cancellations.length,1);
  });
  await test('ordered offline acknowledges the committed revision and rejects replay',async()=>{
    const db=database(),h=harness(db),body=h.ordered('offline'),r=await h.api.POST(h.request(body));
    assert.equal(r.status,200);assert.equal(r.body.status,'offline');assert.equal(r.body.duty_expected_revision,body.duty_expected_revision);assert.notEqual(r.body.duty_revision,body.duty_expected_revision);assert.equal(r.body.duty_revision,db.tables.driver_locations[0].duty_revision);assert.equal(db.cancellations.length,1);
    const replay=await h.api.POST(h.request(body));assert.equal(replay.status,409);assert.equal(replay.body.code,'DUTY_REVISION_CONFLICT');
  });
  await test('delayed online cannot overwrite an offline request committed during its write',async()=>{
    const db=database(),h=harness(db),revision=db.tables.driver_locations[0].duty_revision;
    db.beforeWrite=async()=>{db.beforeWrite=null;const r=await h.api.POST(h.request(h.ordered('offline',revision)));assert.equal(r.status,200);};
    const late=await h.api.POST(h.request(h.ordered('online',revision)));
    assert.equal(late.status,409);assert.equal(db.tables.driver_locations[0].status,'offline');assert.equal(db.cancellations.length,1);
  });
  await test('two first pings cannot overwrite each other through an upsert',async()=>{
    const db=database(null),h=harness(db);
    const results=await Promise.all([h.api.POST(h.request(h.ordered('offline'))),h.api.POST(h.request(h.ordered('online')))]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);assert.equal(db.tables.driver_locations.length,1);
  });
  await test('online without GPS stays nonassignable and can then go offline',async()=>{
    const db=database(null),h=harness(db),pending=await h.api.POST(h.request(h.ordered('online')));
    assert.equal(pending.status,200);assert.equal(pending.body.status,'gps_pending');assert.equal(db.tables.driver_locations[0].status,'gps_pending');
    const offline=await h.api.POST(h.request(h.ordered('offline')));assert.equal(offline.body.status,'offline');assert.equal(db.cancellations.length,1);
  });
  await test('malformed ordering fails without writes',async()=>{
    for(const extra of [{duty_ordering_v1:false},{duty_expected_revision:'bad'},{duty_expected_revision:null},{duty_ordering_v1:undefined}]){
      const db=database(),h=harness(db),r=await h.api.POST(h.request(h.ordered('offline',undefined,extra)));assert.equal(r.status,400);assert.equal(db.writes.length,0);
    }
  });
  await test('active device lock still prevents a second phone changing duty',async()=>{
    const db=database(),h=harness(db);db.tables.driver_device_locks[0].device_id='physical-phone';
    const r=await h.api.POST(h.request(h.ordered('offline')));assert.equal(r.status,409);assert.equal(r.body.code,'DEVICE_LOCKED');assert.equal(db.tables.driver_locations[0].status,'online');assert.equal(db.writes.length,0);
  });
  await test('legacy clients remain supported without ordering fields',async()=>{
    const db=database(),h=harness(db),r=await h.api.POST(h.request({driver_id:driver,device_id:'emulator-test',status:'offline'}));
    assert.equal(r.status,200);assert.equal(r.body.status,'offline');assert.equal(r.body.ordering_version,undefined);assert.equal(db.tables.driver_locations[0].status,'offline');
  });
  await test('storage failures never acknowledge a duty change',async()=>{
    let db=database(),h=harness(db);db.failRead=true;assert.equal((await h.api.GET(h.request())).status,503);
    db=database();h=harness(db);db.failWrite=true;assert.equal((await h.api.POST(h.request(h.ordered('offline')))).status,500);assert.equal(db.tables.driver_locations[0].status,'online');assert.equal(db.cancellations.length,0);
    db=database();h=harness(db);db.tables.driver_locations[0].duty_revision=null;assert.equal((await h.api.GET(h.request())).status,503);assert.equal((await h.api.POST(h.request(h.ordered('offline')))).status,503);
  });
  await test('GPS diagnostic is tester-only, expires exactly, and excludes coordinates and secrets',async()=>{
    const h=harness(database());
    const build=h.load('lib/driver-gps-request-diagnostic.ts').driverGpsRequestDiagnostic;
    const input={driverId:'00000000-0000-4000-8000-000000000002',body:Object.freeze({lat:17.08,lng:121.12,accuracy_m:12.5,is_mock_location:false,client_version_name:'1.0.97',client_version_code:500000103,password:'sensitive',authorization:'sensitive'}),hasCoordinates:true,accuracyMeters:12.5,mockLocation:false,ordered:true,userAgent:'okhttp/4.12.0\r\n\u2603'+ 'x'.repeat(200),nowMs:Date.parse('2026-09-26T15:59:59.999Z')};
    const result=build(input);
    assert.equal(result.accuracy_meters,12.5);assert.equal(result.mock_location,false);
    assert.equal(result.accuracy_m_present,true);assert.equal(result.mock_flag_present,true);
    assert.equal(result.user_agent.length,160);assert.match(result.user_agent,/^[\x20-\x7E]*$/);
    const serialized=JSON.stringify(result);for(const secret of ['17.08','121.12','sensitive','password','authorization'])assert.ok(!serialized.includes(secret));
    assert.equal(build({...input,driverId:driver}),null);
    assert.equal(build({...input,nowMs:Date.parse('2026-09-26T16:00:00.000Z')}),null);
    assert.equal(build({...input,nowMs:NaN}),null);
  });
  await test('real ping preserves GPS metadata through parsing and RPC while diagnosing request shape',async()=>{
    const tester='00000000-0000-4000-8000-000000000002';
    class ActiveDate extends Date { static now(){return Date.parse('2026-09-25T23:00:00.000Z');} }
    for(const kind of ['measured','legacy','heartbeat']) {
      const db=database();for(const rows of Object.values(db.tables))for(const row of rows)if(row.driver_id===driver)row.driver_id=tester;
      const rpcCalls=[];db.rpc=(name,args)=>{rpcCalls.push({name,args:copy(args)});const p=Promise.resolve({data:true,error:null});p.abortSignal=()=>p;return p;};
      const h=harness(db,{Date:ActiveDate});
      const body=h.ordered('online',undefined,{driver_id:tester,client_version_name:'1.0.97',client_version_code:500000103,...(kind==='heartbeat'?{}:{lat:17.08,lng:121.12}),...(kind==='measured'?{accuracy_m:12.5,is_mock_location:false}:{})});
      const r=await h.api.POST(h.request(body));assert.equal(r.status,200);
      const logs=h.logs.filter(x=>x[0]==='[JRIDE_TEST_DRIVER_GPS_REQUEST_V1]');assert.equal(logs.length,1);
      const record=rpcCalls.find(x=>x.name==='jride_record_driver_location_observation_minute_v1');
      if(kind==='heartbeat'){assert.equal(record,undefined);assert.equal(logs[0][1].has_coordinates,false);}
      else {assert.ok(record);assert.equal(record.args.p_accuracy_meters,kind==='measured'?12.5:null);assert.equal(record.args.p_client_mock_location,kind==='measured'?false:null);}
      assert.equal(logs[0][1].accuracy_m_present,kind==='measured');
      assert.equal(logs[0][1].mock_flag_present,kind==='measured');
    }
  });
  await test('unauthenticated tester request cannot produce GPS diagnostic logging',async()=>{
    const db=database(),h=harness(db);
    const r=await h.api.POST(h.request({driver_id:'00000000-0000-4000-8000-000000000002',status:'online',lat:17.08,lng:121.12},{auth:'none'}));
    assert.equal(r.status,401);assert.equal(h.logs.filter(x=>x[0]==='[JRIDE_TEST_DRIVER_GPS_REQUEST_V1]').length,0);assert.equal(db.writes.length,0);
  });
  console.log(`\n${passed} driver duty regression groups passed.`);
})().catch(error=>{console.error(error);process.exitCode=1;});
