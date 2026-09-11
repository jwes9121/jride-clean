export const state={vendorId:'10000000-0000-0000-0000-000000000001',status:'active',args:null as any,deleted:[] as any[],calls:0};
export function supabaseAdmin(){return {
 from(table:string){let filters:any[]=[];const chain:any={select(){return chain},eq(k:string,v:any){filters.push([k,v]);return chain},limit(){return chain},maybeSingle:async()=>({data:{vendor_id:state.vendorId,vendor_name:'Test',town:'Test',status:state.status},error:null}),delete(){state.deleted=filters;return chain},then(resolve:any){return Promise.resolve({error:null}).then(resolve)}};return chain},
 rpc:async(name:string,args:any)=>{state.calls++;state.args=args;return {data:name==='vendor_native_register'?true:false,error:null}}
}}
