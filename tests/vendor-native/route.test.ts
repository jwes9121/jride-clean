import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import { POST, DELETE } from '../../app/api/vendor-native/device/route';
import { signVendorSession, VENDOR_SESSION_COOKIE } from '../../lib/vendorSession';
import { state } from './admin-mock';
process.env.VENDOR_SESSION_SECRET='test-only-secret-never-a-deployment-value';
const secret='11111111-1111-1111-1111-111111111111'.repeat(2);
const body={installation_id:'30000000-0000-0000-0000-000000000001',token:'a'.repeat(40),notifications_enabled:true,sound_enabled:true,vendor_id:'ATTACKER_CONTROLLED'};
function req(options:{cookie?:string;headers?:Record<string,string>;body?:any;method?:string}={}){return new NextRequest('https://app.jride.net/api/vendor-native/device',{method:options.method||'POST',headers:{'content-type':'application/json','x-jride-native':'vendor-v1','x-jride-device-secret':secret,...(options.cookie?{cookie:`${VENDOR_SESSION_COOKIE}=${options.cookie}`} : {}),...options.headers},body:JSON.stringify(options.body||body)})}
async function main(){let n=0;const valid=signVendorSession(state.vendorId);
 let r=await POST(req());assert.equal(r.status,401);n++;
 r=await POST(req({cookie:valid+'x'}));assert.equal(r.status,401);n++;
 r=await POST(req({cookie:valid,headers:{origin:'https://evil.example'}}));assert.equal(r.status,400);n++;
 r=await POST(req({cookie:valid,headers:{'x-jride-native':'wrong'}}));assert.equal(r.status,400);n++;
 r=await POST(req({cookie:valid,headers:{'x-jride-device-secret':'short'}}));assert.equal(r.status,400);n++;
 r=await POST(req({cookie:valid,body:{...body,installation_id:'invalid'}}));assert.equal(r.status,400);n++;
 r=await POST(req({cookie:valid,body:{...body,token:'x'}}));assert.equal(r.status,400);n++;
 state.status='suspended';r=await POST(req({cookie:valid}));assert.equal(r.status,401);n++;
 state.status='active';r=await POST(req({cookie:valid}));assert.equal(r.status,200);const data=await r.json();assert.equal(data.vendor_id,state.vendorId);assert.equal(data.delivery_ready,false);assert.ok(data.session_hash);assert.equal('token' in data,false);n++;
 r=await DELETE(req({method:'DELETE'}));assert.equal(r.status,200);assert.ok(state.deleted.some(x=>x[0]==='secret_hash'));n++;
 r=await DELETE(req({method:'DELETE',headers:{'x-jride-device-secret':''}}));assert.equal(r.status,400);n++;
 console.log(`${n} device registration tests passed`);
}
main().catch(e=>{console.error(e);process.exitCode=1});
