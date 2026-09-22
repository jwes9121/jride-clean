import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetPassenger } from "@/lib/jfleet/server";
import { CustomerInputError, customerFailure, parseAcceptance } from "@/lib/jfleet/customer";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
export async function POST(req:Request) {
  try {
    if(!jfleetFeatureFlagEnabled())return json({ok:false,code:"JFLEET_NOT_ENABLED",message:"JFleet is not enabled yet."},503);
    const auth=await requireJfleetPassenger(req);
    if(!auth.ok)return json({ok:false,code:auth.code,message:auth.message},auth.status);
    const raw=await req.text();if(Buffer.byteLength(raw,"utf8")>4000)return json({ok:false,message:"Request too large."},413);
    let b:unknown;try{b=JSON.parse(raw);}catch{return json({ok:false,message:"Invalid JSON."},400);}
    const v=parseAcceptance(b);
    const r=await supabaseAdmin({noStore:true}).rpc("jfleet_customer_accept_quote_v2",{
      p_inquiry_id:v.inquiry_id,p_quote_id:v.quote_id,p_user_id:auth.user.id,
      p_context_token:v.context_token,p_terms_acknowledged:v.terms_acknowledged
    });
    if(r.error){const f=customerFailure(String(r.error.message));return json({ok:false,code:f.code,message:f.message},f.status);}
    return json(r.data);
  } catch(e) {
    if(e instanceof CustomerInputError)return json({ok:false,code:"JFLEET_QUOTE_REVIEW_REQUIRED",message:e.message},400);
    return json({ok:false,code:"JFLEET_ACCEPT_UNAVAILABLE",message:"Acceptance could not be completed. Retry the same quotation or reload to check the booking."},503);
  }
}
