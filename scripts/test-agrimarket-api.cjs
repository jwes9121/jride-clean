const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks = {}) {
  const cache = new Map();
  function read(abs) {
    if (cache.has(abs)) return cache.get(abs).exports;
    const module = { exports: {} }; cache.set(abs, module);
    const out=ts.transpileModule(fs.readFileSync(abs,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
    function req(name) {
      if (Object.hasOwn(mocks,name)) return mocks[name];
      if (name.startsWith('@/') || name.startsWith('.')) {
        let target=name.startsWith('@/')?path.join(root,name.slice(2)):path.resolve(path.dirname(abs),name);
        if (!path.extname(target)) target+='.ts';
        return read(target);
      }
      return require(name);
    }
    new Function('require','module','exports',out)(req,module,module.exports);
    return module.exports;
  }
  return read(path.join(root,file));
}
function db(rows) {
  return { from(table) { const result={data:rows[table]??null,error:null}; const chain=new Proxy({}, {get(_, key) { if (key==='then') return (resolve)=>resolve(result); return ()=>chain; }}); return chain; } };
}
const coords=load('lib/agrimarket/coordinates.ts');
test('farmer login routes are separate from protected passenger shopping',()=>{
  const {isAgrimarketFarmerPath}=load('lib/agrimarket/paths.ts');
  for(const route of ['/agrimarket/farmer','/agrimarket/producer','/agrimarket/producer/products','/agrimarket/join']) assert.equal(isAgrimarketFarmerPath(route),true);
  for(const route of ['/agrimarket','/agrimarket/order','/agrimarket/producer-other']) assert.equal(isAgrimarketFarmerPath(route),false);
});
test('pin parsing rejects absent/coerced/range errors and permits numeric coordinates including zero',()=>{
  for(const n of [null,undefined,'',' ',true,false,[],{},Infinity,NaN,91,-91]) assert.equal(coords.coordinate(n,90),null);
  assert.equal(coords.coordinate('16.82',90),16.82); assert.equal(coords.coordinate(0,90),0);
  assert.equal(coords.hasValidPin(16.8,181),false);
});
test('routing rejects a missing coordinate before requesting Mapbox',async()=>{
  const routing=load('app/api/agrimarket/_lib/routing.ts');
  await assert.rejects(routing.fetchAgrimarketDrivingRoute(null,121,16,121),/INVALID_ROUTE_COORDINATE/);
});
test('checkout fails closed for invalid pins and unresolved municipality',async()=>{
  const order=load('app/api/agrimarket/_lib/order.ts',{'./location':{reverseGeocodeIfugaoTown:async()=>null}});
  for(const pin of [{lat:null,lng:null},{lat:'',lng:121},{lat:100,lng:121}]) {
    await assert.rejects(order.loadAgrimarketOrderContext(db({passenger_addresses:pin}),'user','address',[],'motorcycle'),e=>e.code==='AGRIMARKET_DELIVERY_PIN_REQUIRED');
  }
  await assert.rejects(order.loadAgrimarketOrderContext(db({passenger_addresses:{lat:16.8,lng:121.1}}),'user','address',[],'motorcycle'),e=>e.code==='AGRIMARKET_DELIVERY_TOWN_UNRESOLVED');
});
test('pickup eligibility requires verified fields and vehicle access even with a roadside flag',()=>{
  const {pickupAccessError}=load('lib/agrimarket/pickupAccess.ts');
  const p={status:'active',accepting_orders:true,pickup_lat:16.8,pickup_lng:121.1,pickup_motorcycle_accessible:true,pickup_tricycle_accessible:false,pickup_roadside_handoff_required:true,pickup_driver_directions:'Use roadside pin'};
  assert.equal(pickupAccessError(p,'motorcycle'),null);
  assert.equal(pickupAccessError(p,'tricycle'),'AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE');
  assert.equal(pickupAccessError({...p,pickup_motorcycle_accessible:null},'motorcycle'),'AGRIMARKET_PICKUP_ACCESS_UNVERIFIED');
  assert.equal(pickupAccessError({...p,pickup_driver_directions:''},'motorcycle'),'AGRIMARKET_PICKUP_ACCESS_UNVERIFIED');
});
test('AgriMarket rejects shared secrets, invalid tokens and caller-selected driver identities',async()=>{
  process.env.DRIVER_PING_SECRET='test-shared-secret'; process.env.NEXT_PUBLIC_SUPABASE_URL='http://localhost:1'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='test-only';
  let authCalls=0;
  const {resolveDriverRequest}=load('lib/driver/resolveDriverRequest.ts',{
    '@supabase/supabase-js':{createClient:()=>({auth:{getUser:async(token)=>{authCalls++;return token==='valid'?{data:{user:{id:'driver-a'}}}:{data:null,error:'invalid'};}}})},
    '@/lib/supabaseAdmin':{supabaseAdmin:()=>db({driver_profiles:{driver_id:'driver-a'}})}
  });
  const secret=new Request('http://localhost',{headers:{'x-jride-driver-secret':'test-shared-secret'}});
  assert.equal((await resolveDriverRequest(secret,'driver-b',{requireBearer:true})).status,401);
  assert.equal(authCalls,0);
  const bearer=token=>new Request('http://localhost',{headers:{Authorization:'Bearer '+token}});
  assert.equal((await resolveDriverRequest(bearer('invalid'),'driver-a',{requireBearer:true})).status,401);
  assert.equal((await resolveDriverRequest(bearer('valid'),'driver-b',{requireBearer:true})).status,403);
  assert.equal((await resolveDriverRequest(bearer('valid'),'driver-a',{requireBearer:true})).driverId,'driver-a');
  assert.equal((await resolveDriverRequest(secret,'legacy-driver')).ok,true);
});
test('farmer portal can open for setup without opening marketplace or onboarding',()=>{
  const server=load('app/api/agrimarket/_lib/server.ts',{'@/auth':{},'@/utils/supabase/server':{},'@supabase/supabase-js':{}});
  process.env.AGRIMARKET_ENABLED='0'; process.env.AGRIMARKET_ONBOARDING_ENABLED='0'; process.env.AGRIMARKET_FARMER_PORTAL_ENABLED='1';
  assert.equal(server.agrimarketFarmerPortalEnabled(),true); assert.equal(server.agrimarketEnabled(),false); assert.equal(server.agrimarketOnboardingEnabled(),false);
  process.env.AGRIMARKET_FARMER_PORTAL_ENABLED='0'; assert.equal(server.agrimarketFarmerPortalEnabled(),false);
  process.env.AGRIMARKET_ENABLED='1'; assert.equal(server.agrimarketFarmerPortalEnabled(),true);
});
