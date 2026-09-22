import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetOwner } from "@/lib/jfleet/server";
import { parseReview, reviewFailure, ReviewInputError, UUID, REVIEW_NOTICE } from "@/lib/jfleet/routeReview";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {"Cache-Control":"no-store, max-age=0"};
const json = (body: unknown, status=200) => NextResponse.json(body,{status,headers});
async function access(req: Request) {
  if (!jfleetFeatureFlagEnabled()) return {error:json({ok:false,code:"JFLEET_NOT_ENABLED",message:"JFleet is not enabled yet."},503)};
  const auth=await requireJfleetOwner(req);
  if (!auth.ok) return {error:json({ok:false,code:auth.code,message:auth.message},auth.status)};
  if (auth.partner.status!=="active") return {error:json({ok:false,message:"This transport partner is not active."},403)};
  return {userId:auth.user.id,partnerId:auth.partner.id};
}
function failure(message: string) { const f=reviewFailure(message); return json({ok:false,code:f.code,message:f.message},f.status); }
function publicToken() {
  return [process.env.MAPBOX_ACCESS_TOKEN,process.env.MAPBOX_TOKEN,process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN,process.env.NEXT_PUBLIC_MAPBOX_TOKEN]
    .map(x=>String(x || "").trim()).find(x=>x.startsWith("pk.")) || null;
}
export async function GET(req: Request) {
  try {
    const auth=await access(req); if(auth.error) return auth.error;
    const id=new URL(req.url).searchParams.get("inquiry_id");
    const admin=supabaseAdmin({noStore:true});
    if(id!==null) {
      if(!UUID.test(id)) return json({ok:false,message:"Invalid inquiry ID."},400);
      const r=await admin.rpc("jfleet_owner_route_context_v1",{p_inquiry_id:id,p_owner_user_id:auth.userId});
      if(r.error) return failure(String(r.error.message));
      return json({...r.data,map_token:publicToken(),notice:REVIEW_NOTICE});
    }
    const r=await admin.from("jfleet_inquiries")
      .select("id,inquiry_code,status,pickup_label,requested_vehicle_type,scheduled_start_at,scheduled_end_at,quote_due_at")
      .eq("partner_id",auth.partnerId).in("status",["quote_requested","under_review","quote_ready","revision_requested"])
      .order("quote_due_at",{ascending:true}).order("id",{ascending:true}).limit(51);
    if(r.error) return failure("");
    return json({ok:true,inquiries:(r.data || []).slice(0,50),has_more:(r.data || []).length>50,notice:REVIEW_NOTICE});
  } catch { return failure(""); }
}
export async function POST(req: Request) {
  try {
    const auth=await access(req); if(auth.error) return auth.error;
    const raw=await req.text();
    if(Buffer.byteLength(raw,"utf8")>8000) return json({ok:false,message:"Review request is too large."},413);
    let value: unknown; try { value=JSON.parse(raw); } catch { return json({ok:false,message:"Invalid JSON."},400); }
    const b=parseReview(value);
    const r=await supabaseAdmin({noStore:true}).rpc("jfleet_owner_review_route_v1",{
      p_inquiry_id:b.inquiry_id,p_owner_user_id:auth.userId,p_snapshot_hash:b.snapshot_hash,
      p_decision:b.decision,p_notes:b.notes,p_acknowledged:b.acknowledged
    });
    if(r.error) return failure(String(r.error.message));
    return json(r.data);
  } catch(e) { return e instanceof ReviewInputError ? json({ok:false,message:e.message},400) : failure(""); }
}
