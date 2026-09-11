import assert from 'node:assert/strict';
import { handle, payload, matchesSecret, type Alert } from '../../supabase/functions/vendor-native-alerts/core';
const now=Date.now();
const alert: Alert={ token:'test-token',vendor_id:'vendor',session_hash:'session',event_id:'event',type:'order',pending_count:1,sent_at:now,expires_at:now+300000,sound_enabled:true };
let count=0;
function test(name:string,fn:()=>void){fn();count++;console.log('PASS '+name)}
test('Background data payload and high priority',()=>{const p=payload(alert,now);assert.equal(p.message.android.priority,'HIGH');assert.equal(p.message.android.restricted_package_name,'com.jride.vendor');assert.equal(p.message.android.ttl,'25s');assert.equal('notification' in p.message,false)});
test('Short TTL near deadline',()=>assert.equal(payload({...alert,expires_at:now+1500},now).message.android.ttl,'1s'));
test('Reject expired order',()=>assert.throws(()=>payload({...alert,expires_at:now},now)));
test('Reject extended acceptance window',()=>assert.throws(()=>payload({...alert,expires_at:now+300001},now)));
test('Reject future or missing timestamps',()=>{assert.throws(()=>payload({...alert,sent_at:now+60001},now));assert.throws(()=>payload({...alert,expires_at:NaN},now))});
test('Resolution uses normal priority',()=>assert.equal(payload({...alert,type:'clear',pending_count:0},now).message.android.priority,'NORMAL'));
test('Reject empty order alert',()=>assert.throws(()=>payload({...alert,pending_count:0},now)));
assert.equal(await matchesSecret('a'.repeat(64),'a'.repeat(64)),true);
assert.equal(await matchesSecret('a'.repeat(64),'b'.repeat(64)),false);count+=2;
let sends=0;let finishes:any[]=[];let claims=0;let expired=false;let enabled=true;let fail='';let project='jride-notifications';
const deps={now:()=>now,rpc:async(name:string,args:any)=>{
 if(name==='vendor_native_worker_config')return {enabled,hook_secret:'a'.repeat(64),firebase:{project_id:project,client_email:'sender@jride-notifications.iam.gserviceaccount.com',private_key:'fake'}};
 if(name==='vendor_native_claim'){claims++;return [{installation_id:'device',lease_id:'event'}]}
 if(name==='vendor_native_validate_claim')return expired?null:alert;
 if(name==='vendor_native_finish'){finishes.push(args);return null}
 throw Error(name);
},send:async()=>{sends++;if(fail)throw Error(fail)}};
const request=(secret='a'.repeat(64))=>new Request('https://example.test',{method:'POST',headers:{'x-vendor-native-hook':secret}});
let response=await handle(request('b'.repeat(64)),deps);assert.equal(response.status,401);assert.equal(sends,0);count++;
response=await handle(request(),deps);assert.equal(response.status,200);assert.equal(sends,1);assert.equal(finishes[0].p_ok,true);count++;
expired=true;await handle(request(),deps);assert.equal(sends,1);assert.equal(finishes.at(-1).p_ok,false);count++;
expired=false;fail='UNREGISTERED';await handle(request(),deps);assert.equal(finishes.at(-1).p_error,'UNREGISTERED');count++;
fail='secret error contents';await handle(request(),deps);assert.equal(finishes.at(-1).p_error,'SEND_FAILED');count++;
enabled=false;const before=claims;await handle(request(),deps);assert.equal(claims,before);count++;
enabled=true;project='wrong-project';response=await handle(request(),deps);assert.equal(response.status,503);assert.equal(claims,before);count++;
response=await handle(new Request('https://example.test'),deps);assert.equal(response.status,405);count++;
console.log(`${count} dispatch tests passed`);
