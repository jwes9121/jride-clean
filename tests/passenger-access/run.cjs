// Exercise real route code with private tables/RPCs denied to public clients.
// All identities, data, and tokens below are fixtures; there is no network access.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const assert=require('node:assert/strict'), ts=require('typescript');
const root=path.resolve(__dirname,'../..');
const uid='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const clone=x=>JSON.parse(JSON.stringify(x));
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
function harness(options={}) {
 const calls=[],denied=[],session={access_token:'access-fixture',refresh_token:'refresh-fixture',expires_in:3600};
 const user={id:uid,email:'fixture@example.invalid',user_metadata:{full_name:'Fixture Passenger',verified:true,role:'admin',is_admin:true},app_metadata:options.appMetadata||{}};
 let valid=options.valid!==false;
 const tables={passenger_verifications:[{user_id:uid,status:options.status||'approved_admin'}],passenger_free_ride_audit:[{passenger_id:uid,status:'used'}],passenger_promo_credits:[{id:'credit-fixture',reserved_booking_id:'booking-fixture',user_id:uid,status:'reserved',credit_amount:40,program_code:'ANDROID_FIRST_RIDE_40'}],bookings:[{id:'booking-fixture',booking_code:'FIXTURE',created_by_user_id:uid,assigned_driver_id:uid,status:'fare_proposed',proposed_fare:50,driver_fee_proposal_expires_at:new Date(Date.now()+60000).toISOString(),promo_status:'reserved'}],...options.tables};
 function client(privileged=false,cookie=false){
  const db={auth:{admin:{getUserById:async()=>({data:{user}})},
   getUser:async token=>({data:{user:(token ? token==='valid-token'&&valid : cookie&&options.cookie!==false&&valid)?user:null},error:null}),
   signInWithPassword:async()=>({data:valid?{user,session}:{user:null,session:null},error:valid?null:{message:'Invalid login'}}),
   refreshSession:async({refresh_token})=>({data:valid&&refresh_token==='valid-refresh'?{user,session}:{user:null,session:null},error:null}),
   getSession:async()=>({data:{session}})
  }};
  db.rpc=async(name,args)=>{
   if(!privileged){denied.push(name);return {data:null,error:{code:'42501',message:'permission denied'}};}
   calls.push({name,args:clone(args)});
   if(name==='jride_promo_get_status')assert.deepEqual(Object.keys(args).sort(),['p_device_id','p_program_code','p_user_id']);
   if(options.rpcError)return {data:null,error:{message:'Unavailable'}};
   return {data:options.revoked&&name.includes('validate_device')?{ok:false,error:'ACCOUNT_ACTIVE_ON_ANOTHER_DEVICE'}:{ok:true,action:'claimed',auth_version:1,credit_exists:true},error:null};
  };
  db.from=table=>{
   let mode='read',patch,single=false;const filters=[];
   const q={select(){return q},limit(){return q},order(){return q},gte(){return q},lte(){return q},gt(){return q},
    eq(k,v){filters.push([k,v]);return q},is(k,v){filters.push([k,v]);return q},
    update(v){mode='update';patch=v;return q},insert(v){mode='insert';patch=v;return q},delete(){mode='delete';return q},
    maybeSingle(){single=true;return q},single(){single=true;return q},
    then(resolve,reject){return Promise.resolve().then(()=>{
     if(!privileged&&table.startsWith('passenger_')){denied.push(table);return {data:null,error:{code:'42501',message:'permission denied'}};}
     calls.push({table,mode,filters:clone(filters),patch});
     let rows=(tables[table]||[]).filter(r=>filters.every(([k,v])=>(r[k]??null)===v));
     if(mode==='update')rows.forEach(r=>Object.assign(r,patch));
     if(mode==='insert'){rows=[patch];(tables[table]||=[]).push(patch)}
     return {data:clone(single?(rows[0]||null):rows),error:null,count:rows.length};
    }).then(resolve,reject)}
   };return q;
  };return db;
 }
 const publicClient=client(false),cookieClient=client(false,true),privateClient=client(true);
 class NextResponse {constructor(body,status=200,headers={}){this.body=body;this.status=status;this.headers=headers;this.cookies={set(){}}}static json(body,opts={}){return new NextResponse(body,opts.status||200,opts.headers)}}
 const cache=new Map();
 function load(file,expose=false){
  const key=file+expose;if(cache.has(key))return cache.get(key).exports;
  const module={exports:{}};cache.set(key,module);
  const req=name=>{
   if(name==='next/server')return {NextResponse};
   if(name==='next/headers')return {cookies:()=>({getAll:()=>[]})};
   if(name==='@supabase/ssr')return {createServerClient:()=>cookieClient};
   if(name==='@supabase/auth-helpers-nextjs')return {createRouteHandlerClient:()=>cookieClient};
   if(name==='@/utils/supabase/server')return {createClient:()=>cookieClient};
   if(name==='@supabase/supabase-js')return {createClient:(_url,key)=>key==='test-service'?privateClient:publicClient};
   if(name==='@/auth')return {auth:async()=>null};
   if(name.startsWith('@/'))return load(name.slice(2)+'.ts');
   return require(name);
  };
  let source=fs.readFileSync(path.join(root,file),'utf8');
  if(expose)source+='\nexport const __test = {getTokenUserAndVerified};';
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require:req,process:{env:{SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',NEXT_PUBLIC_SUPABASE_ANON_KEY:'test-anon',DRIVER_PING_SECRET:'driver-fixture'}},URL,Date,Intl,Set,Map,Number,AbortController,setTimeout,clearTimeout,console,fetch:async()=>{throw Error('Unexpected network');}},{filename:file});return module.exports;
 }
 function request(body={},headers={'authorization':'Bearer valid-token','x-device-id':'device-fixture'}){const url='https://fixture.invalid/?device_id=device-fixture';return {url,nextUrl:new URL(url),headers:new Headers(headers),cookies:{getAll:()=>[]},json:async()=>body};}
 return {load,request,calls,denied,publicClient,privateClient,tables};
}
(async()=>{
 await test('login claims only the authenticated account and still reads verification after public access is denied',async()=>{
  const h=harness(),r=await h.load('app/api/public/auth/login/route.ts').POST(h.request({email:'fixture@example.invalid',password:'fixture-password',device_id:'device-fixture',user_id:other}));
  assert.equal(r.status,200);assert.equal(r.body.verified,true);assert.equal(r.body.user_id,uid);assert.equal(h.calls.find(c=>c.name?.includes('claim_device')).args.p_user_id,uid);assert.equal(h.denied.length,0);
 });
 await test('failed login and refresh cannot reach private data',async()=>{
  for(const route of ['login','refresh']){const h=harness({valid:false});const r=await h.load(`app/api/public/auth/${route}/route.ts`).POST(h.request({email:'fixture@example.invalid',password:'fixture-password',refresh_token:'valid-refresh',device_id:'device-fixture'}));assert.equal(r.status,401);assert.equal(h.calls.length,0);}
 });
 await test('native and browser sessions read private records using their validated identity',async()=>{
  for(const headers of [undefined,{}]){const h=harness(),r=await h.load('app/api/public/auth/session/route.ts').GET(h.request({},headers));assert.equal(r.status,200);assert.equal(r.body.authed,true);assert.equal(r.body.verified,true);assert.equal(h.denied.length,0);assert.ok(h.calls.some(c=>c.name==='jride_promo_get_status'));}
 });
 await test('invalid native bearer cannot fall back to a browser cookie',async()=>{
  const h=harness(),r=await h.load('app/api/public/auth/session/route.ts').GET(h.request({}, {'authorization':'Bearer invalid-token','x-device-id':'device-fixture'}));assert.equal(r.body.authed,false);assert.equal(h.calls.length,0);
 });
 await test('revoked sessions stay rejected by session, refresh, and Agrimarket',async()=>{
  for(const route of ['session','refresh','agri']){const h=harness({revoked:true});let r;if(route==='agri'){r=await h.load('app/api/agrimarket/_lib/server.ts').requireAgrimarketPassenger(h.request());assert.equal(r.ok,false);r=r.response;}else {const api=h.load(`app/api/public/auth/${route}/route.ts`);r=route==='session'?await api.GET(h.request()):await api.POST(h.request({refresh_token:'valid-refresh',device_id:'device-fixture'}));}assert.equal(r.status,401);assert.equal(h.denied.length,0);}
 });
 await test('refresh and logout use the token owner rather than request user_id',async()=>{
  let h=harness();let r=await h.load('app/api/public/auth/refresh/route.ts').POST(h.request({refresh_token:'valid-refresh',device_id:'device-fixture',user_id:other}));assert.equal(r.status,200);assert.equal(h.calls[0].args.p_user_id,uid);
  h=harness();r=await h.load('app/api/public/auth/logout/route.ts').POST(h.request({user_id:other}));assert.equal(r.status,200);assert.equal(h.calls[0].args.p_user_id,uid);assert.equal(h.denied.length,0);
 });
 await test('Agrimarket authorizes only validated accounts before private session lookup',async()=>{
  for(const valid of [true,false]){const h=harness({valid});const r=await h.load('app/api/agrimarket/_lib/server.ts').requireAgrimarketPassenger(h.request());assert.equal(r.ok,valid);assert.equal(h.calls.length,valid?1:0);assert.equal(h.denied.length,0);}
 });
 await test('both ride booking routes retain verification with public table access denied',async()=>{
  for(const file of ['app/api/public/passenger/book/route.ts','app/api/passenger/book/route.ts']){const h=harness(),api=h.load(file,true);let r=await api.__test.getTokenUserAndVerified(h.publicClient,'valid-token');assert.equal(r.verified,true);assert.equal(r.user.id,uid);assert.equal(h.denied.length,0);const count=h.calls.length;r=await api.__test.getTokenUserAndVerified(h.publicClient,'invalid-token');assert.equal(r.user,null);assert.equal(h.calls.length,count);}
 });
 await test('can-book and free-ride stay scoped to the signed-in passenger',async()=>{
  for(const route of ['can-book','free-ride']){const h=harness(),r=await h.load(`app/api/public/passenger/${route}/route.ts`).GET(h.request());assert.equal(r.status,200);assert.equal(r.body.authed,true);assert.equal(h.denied.length,0);assert.ok(h.calls.filter(c=>c.table?.startsWith('passenger_')).every(c=>c.filters.some(([,v])=>v===uid)));if(route==='free-ride')assert.equal(r.body.verified,true);}
 });
 await test('fare acceptance reads reserved promo only after matching booking ownership',async()=>{
  let h=harness(),r=await h.load('app/api/public/passenger/fare/accept/route.ts').POST(h.request({booking_code:'FIXTURE'}));assert.equal(r.status,200);assert.equal(r.body.promo_discount,40);assert.equal(h.denied.length,0);
  h=harness({tables:{bookings:[{id:'booking-fixture',booking_code:'FIXTURE',created_by_user_id:other}]}});r=await h.load('app/api/public/passenger/fare/accept/route.ts').POST(h.request({booking_code:'FIXTURE'}));assert.equal(r.status,404);assert.equal(h.calls.filter(c=>c.table==='passenger_promo_credits').length,0);
 });
 await test('dispatch settlement rejects unauthenticated and unrelated cookie users before private RPCs',async()=>{
  for(const options of [{valid:false},{tables:{bookings:[{id:'booking-fixture',booking_code:'FIXTURE',assigned_driver_id:other,status:'on_trip'}]}}]){const h=harness(options),r=await h.load('app/api/dispatch/status/route.ts').POST(h.request({booking_code:'FIXTURE',status:'completed'},{}));assert.ok([401,403].includes(r.status));assert.equal(h.calls.filter(c=>c.name).length,0);}
 });
 await test('assigned driver settlement preserves promo completion through server access',async()=>{
  const h=harness();Object.assign(h.tables.bookings[0],{status:'on_trip'});const r=await h.load('app/api/dispatch/status/route.ts').POST(h.request({booking_code:'FIXTURE',status:'completed'},{}));assert.equal(r.status,200);assert.ok(h.calls.some(c=>c.name==='jride_promo_finalize_completed_booking'));assert.equal(h.denied.length,0);
 });
 await test('verification submission ignores forged approval and passenger identity',async()=>{
  const h=harness(),api=h.load('app/api/public/passenger/verification/request/route.ts');
  const r=await api.POST(h.request({passenger_id:other,status:'approved',full_name:'Fixture Passenger',town:'Lagawe',id_front_path:'fixture/id.jpg',selfie_with_id_path:'fixture/selfie.jpg'}));
  assert.equal(r.status,200);const write=h.calls.find(c=>c.table==='passenger_verification_requests'&&c.mode==='insert');assert.equal(write.patch.passenger_id,uid);assert.equal(write.patch.status,'submitted');assert.equal(h.denied.length,0);
  const read=await api.GET(h.request());assert.equal(read.body.authed,true);assert.equal(read.body.passenger_id,uid);
 });
 await test('unapproved metadata cannot claim verified free-ride eligibility',async()=>{
  const h=harness({status:'submitted'}),r=await h.load('app/api/public/passenger/free-ride/route.ts').GET(h.request());assert.equal(r.body.verified,false);
 });
 await test('editable profile metadata cannot approve passenger verification as staff',async()=>{
  for(const route of ['decide','forward']){const h=harness(),r=await h.load(`app/api/admin/verification/${route}/route.ts`).POST(h.request({passenger_id:other,decision:'approved'}));assert.equal(r.status,403);assert.equal(h.calls.filter(c=>c.mode&&c.mode!=='read').length,0);}
 });
 await test('storage failures never validate a session'  ,async()=>{
  const h=harness({rpcError:true}),r=await h.load('app/api/public/auth/session/route.ts').GET(h.request());assert.equal(r.status,503);assert.equal(r.body.authed,false);
 });
 console.log(`\n${passed} passenger access regression groups passed.`);
})().catch(e=>{console.error(e);process.exitCode=1});
