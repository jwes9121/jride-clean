const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '../..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0;
async function test(name, run) { await run(); console.log('PASS ' + name); passed++; }
function load(file, mocks, globals = {}) {
 const module = { exports: {} };
 const compiled = ts.transpileModule(read(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, reportDiagnostics: true });
 assert.equal(compiled.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0);
 vm.runInNewContext(compiled.outputText, {module, exports: module.exports, require: name => { if(name in mocks) return mocks[name]; if(name.endsWith('.css')) return {}; return require(name); }, console, Date, JSON, Error, Number, String, URL, URLSearchParams, Headers, AbortSignal, Event, ...globals});
 return module.exports;
}
const origin = 'https://app.jride.net';
function row(locked = false) { return { id: 'own-farm', contact_name: 'Test Farmer', contact_phone: '09991234567', barangay: 'Pugol', town:'Lamut', town_editable: !locked, vendor_name: 'Chosen Farm', vendor_name_locked_at: locked ? '2026-09-23T00:00:00Z' : null, vendor_name_locked: locked, pickup_label: 'Pickup gate', pickup_lat:16.65,pickup_lng:121.22, pickup_motorcycle_accessible:true,pickup_tricycle_accessible:false,pickup_roadside_handoff_required:false,pickup_driver_directions:'Meet at the gate.', accepting_orders:true, store_open:true, pickup_verified:true, profile_complete:true}; }
function apiHarness(opt = {}) {
 const calls=[]; const current = {...row(opt.locked), ...opt.row};
 const db={from:table=> { const q={select(){return q},eq(){return q},limit(){return q},maybeSingle:async()=>({data:current,error:null})}; return q; }, rpc:async(name,args)=> { calls.push({name,args}); if(opt.error) return {error:{message:opt.error}}; current.vendor_name_locked_at='2026-09-23T00:00:00Z'; return {data:[{application_id:'test'}],error:null}; }};
 const api = load('app/api/agrimarket/producer/profile/route.ts',{
  '../../_lib/server': {agrimarketFarmerPortalEnabled:()=>true, agrimarketFarmerPortalDisabledResponse:()=>({status:503}),createServiceSupabase:()=>db,jsonNoStore:(status,body)=>({status,body}),requireAgrimarketProducer:async()=>opt.denied?{ok:false,response:{status:401}}:{ok:true,accessCode:'AGF-TEST',producer:{id:current.id,town:current.town}}},
  '../../_lib/admin-farmer-location':{reverseGeocodeFarmerPin:async()=>({launch_eligible:true,town:opt.resolvedTown||'Lamut',label:'Pickup gate'})},
  '@/lib/agrimarket/farmer-towns':{
    isAgrimarketActiveTown:value=>['Lagawe','Hingyon','Banaue','Lamut'].includes(value),
    canonicalAgrimarketBarangay:(town,value)=>(town==='Lamut'&&['Pugol','Poblacion West'].includes(value))||(town==='Banaue'&&value==='Poblacion')?value:null
  },
  '@/lib/agrimarket/farmer-profile-validation':{
    driverDirectionsError:({directions})=>String(directions||'').trim().length>=8?null:'Add clearer driver directions or a landmark of at least 8 characters.'
  }
 });
 return {api,calls,req:(extra={},requestOrigin=origin)=>({headers:new Headers({origin:requestOrigin}),nextUrl:new URL(origin+'/api/agrimarket/producer/profile'),text:async()=>JSON.stringify({...current,...extra})})};
}
function nodes(node, predicate, found=[]) { if(!node || typeof node!=='object')return found; if(predicate(node))found.push(node); for(const child of [node.props?.children].flat(Infinity))nodes(child,predicate,found); return found; }
const flush=()=>new Promise(r=>setImmediate(r));
function uiHarness(opt={}) {
 const slots=[],effects=[],requests=[],navigations=[],notices=[]; let index=0,tree;
 let current={...row(opt.locked),profile_complete:opt.complete===true};
 const react={useState(v){const i=index++;if(!(i in slots))slots[i]=typeof v==='function'?v():v;return [slots[i],n=>{slots[i]=typeof n==='function'?n(slots[i]):n}]},useRef(v){const i=index++;if(!(i in slots))slots[i]={current:v};return slots[i]},useEffect(fn,deps){const i=index++;if(!slots[i]||deps.some((d,n)=>!Object.is(d,slots[i][n]))){effects.push(fn);slots[i]=deps}}};
 const jsx=(type,props)=>({type,props});
 const Page=load('app/agrimarket/producer/profile/page.tsx',{
  react,'react/jsx-runtime':{jsx,jsxs:jsx},'next/navigation':{useRouter:()=>({replace:url=>navigations.push(url)})},'next/link':()=>null,
  '@/components/agrimarket/FarmerPickupMap':{__esModule:true,default:()=>null,emptyFarmerPin:()=>({lat:null,lng:null,launch_eligible:false})},
  '@/lib/agrimarket/farmerSessionClient':{farmerSessionHeaders:()=>({'x-test':'farmer'})},
  '@/lib/agrimarket/farmer-towns':{
    AGRIMARKET_ACTIVE_TOWNS:['Lagawe','Hingyon','Banaue','Lamut'],
    agrimarketBarangays:town=>town==='Lamut'?['Pugol','Poblacion West']:[],
    canonicalAgrimarketBarangay:(town,value)=>town==='Lamut'&&['Pugol','Poblacion West'].includes(value)?value:null
  },
  '@/lib/agrimarket/farmer-profile-validation':{
    driverDirectionsError:({directions})=>String(directions||'').trim().length>=8?null:'Add clearer driver directions or a landmark of at least 8 characters.'
  },
  '../FarmerWorkspace':{FarmerFeedback:()=>null,FarmerLogin:()=>null,FarmerUnavailable:()=>null,FarmerWorkspace:()=>null},
  '../useFarmerSession':{useFarmerSession:()=>({sessionCode:'AGF-TEST',invalidate:()=>{}})}
 }, {window:{dispatchEvent:()=>{},setTimeout,clearTimeout},sessionStorage:{setItem:(key,value)=>notices.push({key,value})},fetch:async(url,options={})=>{requests.push({url,options});
   if(String(url).startsWith('/api/agrimarket/producer/profile-check?')) return {status:200,ok:true,json:async()=>({ok:true,phone_available:opt.phoneTaken!==true,store_name_available:opt.storeTaken!==true})};
   if(options.method==='POST'){if(opt.saveFailure)return {status:409,ok:false,json:async()=>({ok:false,message:'Save rejected'})};current={...current,profile_complete:true,vendor_name_locked:true};}
   return {status:200,ok:true,json:async()=>({ok:true,profile:current,message:'Saved; current approval unchanged.'})};}}).default;
 function render(){index=0;tree=Page();while(effects.length)effects.shift()();return tree}
 function find(p){return nodes(tree,p)[0]}
 render();
 return {render,find,requests,navigations,notices,async ready(){await flush();render()},get tree(){return tree}};
}
(async()=>{
 await test('profile uses atomic V4 RPC, trusted farmer and selected active town',async()=>{const h=apiHarness();const res=await h.api.POST(h.req({confirm_vendor_name:true,producer_id:'another'}));assert.equal(res.status,200);assert.equal(res.body.profile.vendor_name_locked,true);assert.equal(h.calls[0].name,'agrimarket_farmer_save_profile_v4');assert.equal(h.calls[0].args.p_producer_id,'own-farm');assert.equal(h.calls[0].args.p_town,'Lamut');assert.equal(h.calls[0].args.p_barangay,'Pugol');assert.equal(h.calls[0].args.p_confirm_vendor_name,true);});
 await test('missing confirmation cannot be coerced true by an old or string payload',async()=>{for(const value of [undefined,'true',1,false]){const h=apiHarness({error:'AGRIMARKET_FARM_NAME_CONFIRMATION_REQUIRED'});const res=await h.api.POST(h.req({confirm_vendor_name:value}));assert.equal(res.status,409);assert.equal(h.calls[0].args.p_confirm_vendor_name,false);}});
 await test('locked-name errors retain a clear customer message and block success',async()=>{const h=apiHarness({locked:true,error:'AGRIMARKET_FARM_NAME_LOCKED'});const res=await h.api.POST(h.req({vendor_name:'Other'}));assert.equal(res.status,409);assert.match(res.body.message,/locked/);assert.equal(res.body.ok,false);});
 await test('same-town store-name collision returns a specific customer message',async()=>{const h=apiHarness({error:'AGRIMARKET_STORE_NAME_TAKEN'});const res=await h.api.POST(h.req());assert.equal(res.status,409);assert.equal(res.body.error,'AGRIMARKET_STORE_NAME_TAKEN');assert.match(res.body.message,/already exists/);});
 await test('barangay must belong to the selected municipality',async()=>{const h=apiHarness();const res=await h.api.POST(h.req({barangay:'Not a barangay'}));assert.equal(res.status,400);assert.equal(res.body.error,'AGRIMARKET_FARMER_BARANGAY_INVALID');assert.equal(h.calls.length,0);});
 await test('unauthenticated and cross-origin profiles never call save RPC',async()=>{const h=apiHarness({denied:true});assert.equal((await h.api.POST(h.req())).status,401);assert.equal(h.calls.length,0);const k=apiHarness();assert.equal((await k.api.POST(k.req({},'https://other.test'))).status,403);assert.equal(k.calls.length,0);});
 await test('invalid phone or null coordinates cannot save or claim profile completion',async()=>{let h=apiHarness();for(const val of [null,''])assert.equal((await h.api.POST(h.req({pickup_lat:val}))).status,400);assert.equal(h.calls.length,0);h=apiHarness({row:{contact_phone:'0917654321',pickup_lat:null}});const x=await h.api.GET(h.req());assert.equal(x.body.profile.profile_complete,false);assert.equal(x.body.profile.pickup_verified,false);});
 await test('Kiangan is rejected and a locked municipality cannot be changed by the farmer',async()=>{let h=apiHarness({resolvedTown:'Kiangan'});let res=await h.api.POST(h.req({town:'Kiangan'}));assert.equal(res.status,400);assert.equal(h.calls.length,0);h=apiHarness({locked:true,resolvedTown:'Banaue',error:'AGRIMARKET_FARMER_TOWN_LOCKED'});res=await h.api.POST(h.req({town:'Banaue',barangay:'Poblacion'}));assert.equal(res.status,409);assert.match(res.body.message,/locked/);});
 await test('first setup shows only the four active municipality choices',async()=>{const h=uiHarness();await h.ready();const select=h.find(n=>n.type==='select'&&n.props.value==='Lamut');assert(select);const options=nodes(select,n=>n.type==='option').map(n=>n.props.value);assert.deepEqual(options,['Lagawe','Hingyon','Banaue','Lamut']);assert(!options.includes('Kiangan'));});
 await test('first setup uses a barangay dropdown and blocks known phone/store conflicts before confirmation',async()=>{let h=uiHarness();await h.ready();const barangay=h.find(n=>n.type==='select'&&n.props.value==='Pugol');assert(barangay);assert(nodes(barangay,n=>n.type==='option').some(n=>n.props.value==='Poblacion West'));h=uiHarness({phoneTaken:true});await h.ready();await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();assert(!h.find(n=>n.props?.['aria-label']==='Confirm farm name'));h=uiHarness({storeTaken:true});await h.ready();await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();assert(!h.find(n=>n.props?.['aria-label']==='Confirm farm name'));});
 await test('first Save only requests confirmation and shows the exact chosen name',async()=>{const h=uiHarness();await h.ready();await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();assert.equal(h.requests.filter(r=>r.options.method==='POST').length,0);assert(h.find(n=>n.props?.['aria-label']==='Confirm farm name'));assert(h.find(n=>n.type==='p' && n.props.children==='Chosen Farm'));});
 await test('confirmed successful save exits editor, returns farmer home, preserves status note',async()=>{const h=uiHarness();await h.ready();await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();h.find(n=>n.type==='button'&&n.props.children==='Confirm and save').props.onClick();await flush();h.render();assert.equal(h.requests.filter(r=>r.options.method==='POST').length,1);assert.equal(JSON.parse(h.requests.at(-1).options.body).confirm_vendor_name,true);assert.deepEqual(h.navigations,['/agrimarket/producer']);assert(!h.find(n=>n.type==='form'));assert.equal(h.notices.length,1);});
 await test('failed save retains review and never redirects or locks in UI',async()=>{const h=uiHarness({saveFailure:true});await h.ready();await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});h.render();h.find(n=>n.type==='button'&&n.props.children==='Confirm and save').props.onClick();await flush();h.render();assert.equal(h.navigations.length,0);assert(h.find(n=>n.props?.['aria-label']==='Confirm farm name'));assert.equal(h.notices.length,0);});
 await test('reopened locked profile starts read-only and contact editing keeps name read-only',async()=>{const h=uiHarness({locked:true,complete:true});await h.ready();assert(!h.find(n=>n.type==='form'));h.find(n=>n.type==='button'&&n.props.children==='Update contact / pickup details').props.onClick();h.render();assert(h.find(n=>n.type==='input'&&n.props.value==='Chosen Farm').props.readOnly);await h.find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await flush();assert.equal(JSON.parse(h.requests.at(-1).options.body).confirm_vendor_name,false);});
 await test('prefilled complete but unlocked name is not silently confirmed',async()=>{const h=uiHarness({complete:true});await h.ready();assert(!h.find(n=>n.type==='form'));assert(h.find(n=>n.type==='button'&&n.props.children==='Review and confirm farm/store name'));assert.equal(h.requests.filter(r=>r.options.method==='POST').length,0);});
 await test('products page no longer offers alternate name writer',()=>{const source=read('app/agrimarket/producer/products/page.tsx');assert(!source.includes('set_vendor_name'));assert(source.includes('View farm profile'));const api=read('app/api/agrimarket/producer/products/route.ts');const branch=api.slice(api.indexOf('if (action === "set_vendor_name")'),api.indexOf('} else if (action === "set_active")'));assert(branch.includes('return jsonNoStore(409'));assert(!branch.includes('.update('));});
 await test('migration guards both the name and lock timestamp without backfilling names',()=>{const file=fs.readdirSync(path.join(root,'supabase/migrations')).find(n=>n.endsWith('_agrimarket_confirmed_farm_name_v1.sql'));const sql=read('supabase/migrations/'+file);assert(sql.includes('FOR UPDATE'));assert(sql.includes('NEW.vendor_name IS DISTINCT FROM OLD.vendor_name'));assert(sql.includes('NEW.vendor_name_locked_at IS DISTINCT FROM OLD.vendor_name_locked_at'));assert(sql.includes('FROM PUBLIC,anon,authenticated'));assert(!sql.includes('DISABLE TRIGGER'));assert.equal((sql.match(/SET vendor_name_locked_at=/g)||[]).length,1);});
 console.log('Farm name/profile: '+passed+' groups passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
