import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetPassenger } from "@/lib/jfleet/server";
import { CustomerInputError, customerFailure, id, parseRevision } from "@/lib/jfleet/customer";
import { RoutePlanningError } from "@/lib/jfleet/routePlanning";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
async function access(req:Request) {
  if(!jfleetFeatureFlagEnabled()) return {error:json({ok:false,code:"JFLEET_NOT_ENABLED",message:"JFleet is not enabled yet."},503)};
  const a=await requireJfleetPassenger(req);
  if(!a.ok) return {error:json({ok:false,code:a.code,message:a.message},a.status)};
  return {userId:a.user.id};
}
function failure(error:unknown) {
  if(error instanceof CustomerInputError) return json({ok:false,message:error.message},400);
  if(error instanceof RoutePlanningError) return json({ok:false,code:error.code,message:error.message},error.status);
  const f=customerFailure("");return json({ok:false,code:f.code,message:f.message},f.status);
}
export async function GET(req:Request) {
  try {
    const auth=await access(req);if(auth.error)return auth.error;
    const raw=new URL(req.url).searchParams.get("id");
    const inquiryId=raw===null?null:id(raw);
    const db=supabaseAdmin({noStore:true});
    if(!inquiryId) {
      const r=await db.from("jfleet_inquiries").select("id,inquiry_code,status,pickup_label,scheduled_start_at,scheduled_end_at,current_itinerary_version,quote_due_at,created_at")
        .eq("passenger_user_id",auth.userId).order("created_at",{ascending:false}).limit(100);
      if(r.error)throw new Error("List unavailable");
      return json({ok:true,inquiries:r.data??[],limit:100});
    }
    const r=await db.rpc("jfleet_customer_inquiry_v1",{p_inquiry_id:inquiryId,p_user_id:auth.userId});
    if(r.error){const f=customerFailure(String(r.error.message));return json({ok:false,code:f.code,message:f.message},f.status);}
    const mapToken=[process.env.MAPBOX_ACCESS_TOKEN,process.env.MAPBOX_TOKEN,process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,process.env.NEXT_PUBLIC_MAPBOX_TOKEN]
      .map(x=>String(x||"").trim()).find(x=>x.startsWith("pk."))??null;
    return json({...r.data,map_token:mapToken});
  } catch(e){return failure(e);}
}
export async function POST(req:Request) {
  try {
    const auth=await access(req);if(auth.error)return auth.error;
    const raw=await req.text();if(Buffer.byteLength(raw,"utf8")>24000)return json({ok:false,message:"The revision is too large."},413);
    let b:unknown;try{b=JSON.parse(raw);}catch{return json({ok:false,message:"Invalid JSON."},400);}
    const v=parseRevision(b);
    const r=await supabaseAdmin({noStore:true}).rpc("jfleet_resubmit_inquiry_v1",{
      p_inquiry_id:v.inquiry_id,p_user_id:auth.userId,p_plan_id:v.plan_id,p_points:v.points,
      p_details:v.details,p_context_token:v.context_token,p_reason:v.reason
    });
    if(r.error){const f=customerFailure(String(r.error.message));return json({ok:false,code:f.code,message:f.message},f.status);}
    return json(r.data);
  } catch(e){return failure(e);}
}
