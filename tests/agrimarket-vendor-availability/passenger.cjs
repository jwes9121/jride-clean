const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const root=path.resolve(__dirname,'../..');
function load(file,mocks={}){
  const module={exports:{}};
  const source=ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(source,{module,exports:module.exports,console,Date,require(name){
    if(name in mocks)return mocks[name];
    if(name.startsWith('@/')){const base=name.slice(2);return load(base+(fs.existsSync(path.join(root,base+'.tsx'))?'.tsx':'.ts'),mocks);}
    if(name.startsWith('.')){const base=path.join(path.dirname(file),name);return load(base+(fs.existsSync(path.join(root,base+'.tsx'))?'.tsx':'.ts'),mocks);}
    return require(name);
  }});return module.exports;
}
async function main(){
  const {agrimarketExpiryNotice}=load('lib/agrimarket/orderExpiry.ts');
  assert.equal(agrimarketExpiryNotice({status:'awaiting_producer'}),null);
  assert.equal(agrimarketExpiryNotice({status:'completed'}),null);
  assert.match(agrimarketExpiryNotice({status:'producer_timeout'}).message,/farmer did not respond within five minutes/);
  assert.match(agrimarketExpiryNotice({status:'cancelled',cancel_reason:'customer_reapproval_timeout'}).message,/revised charges/);
  let owner='customer-a',reads=[];
  const order={id:'order',producer_id:'private-farm-id',order_code:'AG-TEST',customer_user_id:'customer-a',status:'producer_timeout'};
  const privateStore={id:'private-farm-id',vendor_name:'Lamut test store',town:'Lamut',contact_phone:'PRIVATE_PHONE',pickup_lat:16.5};
  const db={from(table){reads.push(table);let cols=[],filters=[];
    const q={select(c){cols=c.split(',');return q;},eq(k,v){filters.push([k,v]);return q;},order(){return q;},limit(){return q;},
      result(single){const raw=table==='agrimarket_orders'?[order]:table==='agrimarket_producers'?[privateStore]:[];
        const data=raw.filter(row=>filters.every(([k,v])=>row[k]===v)).map(row=>Object.fromEntries(cols.map(k=>[k,row[k]])));
        return {data:single?data[0]||null:data,error:null};},async maybeSingle(){return q.result(true);},then(resolve,reject){return Promise.resolve(q.result(false)).then(resolve,reject);}};return q;
  }};
  const server={agrimarketEnabled:()=>true,createServiceSupabase:()=>db,requireAgrimarketPassenger:async()=>({ok:true,user:{id:owner}}),jsonNoStore:(status,body)=>({status,body})};
  const api=load('app/api/agrimarket/order-status/route.ts',{'next/server':{},'../_lib/server':server});
  const req={nextUrl:new URL('https://app.jride.net/api/agrimarket/order-status?order_code=AG-TEST')};
  owner='another-customer';assert.equal((await api.GET(req)).status,404);assert(!reads.includes('agrimarket_producers'));
  owner='customer-a';const response=await api.GET(req);assert.equal(response.status,200);assert.equal(response.body.order.store.name,'Lamut test store');
  for(const secret of ['private-farm-id','PRIVATE_PHONE','pickup_lat'])assert(!JSON.stringify(response.body).includes(secret));
  console.log('PASS order store name/town scoped to the passenger order, without farmer contacts or pickup coordinates');
  for(const outcome of [{status:'producer_timeout'},{status:'cancelled',cancel_reason:'customer_reapproval_timeout'}]){
    let call=0;
    const Tracking=load('app/agrimarket/order/page.tsx',{'next/link':{default:({children,...props})=>React.createElement('a',props,children)},react:{...React,useState(initial){call++;return [call===2?{...outcome,order_code:'AG-TEST',store:{name:'Lamut test store',town:'Lamut'},cash_due_now:100,total_payable:200,items:[]}:initial,()=>{}];},useEffect(){}}}).default;
    const html=renderToStaticMarkup(Tracking());
    for(const shown of ['role="alertdialog"','Lamut test store','AG-TEST','OK - Back to AgriMarket','five minutes'])assert(html.includes(shown),shown);
    for(const hidden of ['Cash due now','Pending farmer confirmation','Driver Approach Fee','Current total'])assert(!html.includes(hidden),hidden);
  }
  console.log('PASS timeout renders an acknowledgement popup and store identity, hiding active-order and payment instructions');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
