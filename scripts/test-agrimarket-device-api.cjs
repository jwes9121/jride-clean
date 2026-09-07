const {test}=require('node:test'); const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),ts=require('typescript');
const {createHash}=require('node:crypto');
function load(file,mocks){const module={exports:{}};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;new Function('require','module','exports',source)(name=>Object.hasOwn(mocks,name)?mocks[name]:require(name),module,module.exports);return module.exports;}
const id='82000000-0000-4000-8000-000000000011',driver='00000000-0000-4000-8000-000000000002',device='1111111111111111',secret='a'.repeat(64);
const hash=createHash('sha256').update(secret).digest('hex');
const token=`agdev.${id}.${secret}`;
const row={id,driver_id:driver,device_id:device,token_sha256:hash,status:'approved',created_at:new Date().toISOString()};
function resolver(record=row,error=null){
  const filters={}; const db={from(table){assert.equal(table,'agrimarket_driver_devices');const chain={select(){return chain},eq(k,v){filters[k]=v;return chain},async maybeSingle(){return {data:record&&Object.entries(filters).every(([k,v])=>record[k]===v)?record:null,error}}};return chain}};
  return load('lib/driver/resolveDriverRequest.ts',{'@/lib/supabaseAdmin':{supabaseAdmin:()=>db},'@supabase/supabase-js':{}}).resolveDriverRequest;
}
function request(access=token,phone=device,url='https://app.jride.net/api/driver/agrimarket/session'){return new Request(url,{headers:{Authorization:'Bearer '+access,'x-jride-device-id':phone}});}
test('approved device identifies the UUID without any email or Supabase account',async()=>{
  assert.deepEqual(await resolver()(request(),driver,{requireBearer:true}),{ok:true,driverId:driver,authMode:'device'});
});
test('wrong secret, missing phone or a copied credential on another phone fail closed',async()=>{
  for(const req of [request(`agdev.${id}.${'b'.repeat(64)}`),request(token,''),request(token,'2222222222222222'),request('agdev.malformed')]) assert.equal((await resolver()(req,driver,{requireBearer:true})).status,401);
});
test('caller cannot switch driver UUID or use an AgriMarket device token on other driver routes',async()=>{
  assert.equal((await resolver()(request(),'82000000-0000-4000-8000-000000000099',{requireBearer:true})).status,403);
  assert.equal((await resolver()(request(),driver)).status,401);
  assert.equal((await resolver()(request(token,device,'https://app.jride.net/api/driver/errand/action'),driver,{requireBearer:true})).status,401);
});
test('pending, expired and revoked devices cannot authenticate; database errors stay closed',async()=>{
  for(const [record,code] of [[{...row,status:'pending'},'DRIVER_DEVICE_PENDING'],[{...row,status:'pending',created_at:'2020-01-01'},'DRIVER_DEVICE_EXPIRED'],[{...row,status:'revoked'},'DRIVER_DEVICE_REVOKED']]) assert.equal((await resolver(record)(request(),driver,{requireBearer:true})).error,code);
  assert.equal((await resolver(row,{message:'fixture failure'})(request(),driver,{requireBearer:true})).status,503);
});
test('device enrollment only submits a pending request with a hash, never an approved identity',async()=>{
  let calls=0; const jsonNoStore=(status,body)=>Response.json(body,{status});
  const api=load('app/api/driver/agrimarket/device/route.ts',{'@/lib/supabaseAdmin':{supabaseAdmin:()=>({rpc:async(name,args)=>{calls++;assert.equal(name,'agrimarket_request_driver_device_v1');assert.equal(args.p_token_sha256,hash);assert.equal(args.p_actor_role,undefined);assert.equal(args.p_status,undefined);return {data:{id,status:'pending'}}}})},'@/app/api/agrimarket/_lib/server':{jsonNoStore}});
  const body={id,driver_id:driver,device_id:device,token_sha256:hash,status:'approved',role:'admin'};
  const good=await api.POST({json:async()=>body});assert.equal(good.status,200);assert.equal((await good.json()).device.status,'pending');
  assert.equal((await api.POST({json:async()=>({...body,token_sha256:'raw-token'})})).status,400);assert.equal(calls,1);
});
test('only authenticated admin confirmation can approve; caller-supplied actor is ignored',async()=>{
  let role='dispatcher',calls=[];const jsonNoStore=(status,body)=>Response.json(body,{status});
  const api=load('app/api/agrimarket/admin/driver-devices/route.ts',{'../../_lib/server':{jsonNoStore,requireAgrimarketStaff:async(adminOnly)=>{assert.equal(adminOnly,true);return role==='admin'?{ok:true,role,actor:'real-admin@example.test'}:{ok:false,response:jsonNoStore(403,{ok:false})}},createServiceSupabase:()=>({rpc:async(name,args)=>{calls.push(args);return {data:{status:'approved'}}}})}});
  const body={id,decision:'approve',note:'Driver and phone checked',device_confirmed:true,actor:'spoof',role:'admin'};
  assert.equal((await api.POST({json:async()=>body})).status,403);assert.equal(calls.length,0);
  role='admin';assert.equal((await api.POST({json:async()=>({...body,device_confirmed:false})})).status,400);
  assert.equal((await api.POST({json:async()=>body})).status,200);assert.equal(calls[0].p_actor,'real-admin@example.test');assert.equal(calls[0].p_actor_role,'admin');
});
