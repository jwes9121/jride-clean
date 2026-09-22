import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetPassenger } from "@/lib/jfleet/server";
import { parseRoutePoints, parseInquiryDetails, requestRoadRoute, RoutePlanningError, ROUTE_ADVISORY } from "@/lib/jfleet/routePlanning";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0" };
const json = (body: unknown, status = 200) => NextResponse.json(body,{status,headers});
const tokens = () => [process.env.MAPBOX_ACCESS_TOKEN, process.env.MAPBOX_TOKEN, process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN, process.env.NEXT_PUBLIC_MAPBOX_TOKEN].map(v => String(v || "").trim()).filter(Boolean);
async function access(req: Request) {
  if (!jfleetFeatureFlagEnabled()) return { error: json({ok:false,code:"JFLEET_NOT_ENABLED",message:"JFleet is not enabled yet."},503) };
  const auth = await requireJfleetPassenger(req);
  if (!auth.ok) return { error: json({ok:false,code:auth.code,message:auth.message},auth.status) };
  return { userId: auth.user.id };
}
function failed(error: unknown) {
  if (error instanceof RoutePlanningError) return json({ok:false,code:error.code,message:error.message},error.status);
  return json({ok:false,code:"JFLEET_PLANNER_UNAVAILABLE",message:"The planner could not complete the request. Please retry."},503);
}
export async function GET(req: Request) {
  try {
    const auth=await access(req); if(auth.error) return auth.error;
    // Never expose a secret Mapbox token through the browser configuration.
    const token=tokens().find(v=>v.startsWith("pk."));
    if(!token) return json({ok:false,code:"JFLEET_MAP_NOT_CONFIGURED",message:"A public map token must be configured before using the map planner."},503);
    return json({ok:true,map_token:token,advisory:ROUTE_ADVISORY});
  } catch(error) { return failed(error); }
}
export async function POST(req: Request) {
  let planId: string | null=null;
  try {
    const auth=await access(req); if(auth.error) return auth.error;
    const raw=await req.text();
    if(Buffer.byteLength(raw,"utf8")>24000) return json({ok:false,message:"The itinerary is too large."},413);
    let body: Record<string,unknown>;
    try { body=JSON.parse(raw); } catch { return json({ok:false,message:"Invalid JSON request."},400); }
    if(!body || typeof body!=="object" || Array.isArray(body)) return json({ok:false,message:"Invalid planner request."},400);
    const points=parseRoutePoints(body.points);
    const admin=supabaseAdmin({noStore:true});
    if(body.action==="preview") {
      const token=tokens()[0];
      if(!token) throw new RoutePlanningError("JFLEET_ROUTING_NOT_CONFIGURED","Road routing is not configured.",503);
      const begin=await admin.rpc("jfleet_begin_route_plan_v1",{p_user_id:auth.userId,p_points:points});
      if(begin.error) {
        if(String(begin.error.message).includes("JFLEET_ROUTE_RATE_LIMIT")) return json({ok:false,code:"JFLEET_ROUTE_RATE_LIMIT",message:"Route-preview limit reached. Please try again later."},429);
        throw new RoutePlanningError("JFLEET_ROUTE_PLAN_STORE_UNAVAILABLE","The route planner is not ready to save previews.",503);
      }
      planId=String(begin.data?.id || "");
      if(!planId) throw new Error("Missing route plan ID");
      const route=await requestRoadRoute(points,token);
      const saved=await admin.from("jfleet_route_plans").update({status:"ready",route}).eq("id",planId).eq("passenger_user_id",auth.userId).eq("status","building").select("id,expires_at").single();
      if(saved.error) throw new RoutePlanningError("JFLEET_ROUTE_PLAN_SAVE_FAILED","The route could not be saved. Please preview it again.",503);
      return json({ok:true,plan:{...saved.data,points,route},advisory:ROUTE_ADVISORY});
    }
    if(body.action==="submit") {
      const id=body.plan_id;
      if(typeof id!=="string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ok:false,message:"Preview and review your route before submitting."},400);
      const details=parseInquiryDetails(body.details);
      const result=await admin.rpc("jfleet_submit_route_plan_v1",{p_plan_id:id,p_user_id:auth.userId,p_points:points,p_details:details});
      if(result.error) {
        const text=String(result.error.message);
        if(text.includes("JFLEET_PARTNER_NOT_ACTIVE")) return json({ok:false,code:"JFLEET_PARTNER_NOT_ACTIVE",message:"No transport partner is activated yet. Your route preview is not a booking."},503);
        if(text.includes("JFLEET_ROUTE_PLAN_NOT_FOUND")) return json({ok:false,code:"JFLEET_ROUTE_PLAN_NOT_FOUND",message:"This route plan is not available to your account."},404);
        return json({ok:false,code:"JFLEET_ROUTE_SUBMISSION_REJECTED",message:"The route, schedule or previous submission changed, or the preview expired. Refresh the preview and review the details."},409);
      }
      return json(result.data,result.data?.already_submitted?200:201);
    }
    return json({ok:false,message:"Choose preview or submit."},400);
  } catch(error) {
    if(planId) {
      try {
        await supabaseAdmin({noStore:true}).from("jfleet_route_plans").update({status:"failed",error_code:error instanceof RoutePlanningError?error.code:"JFLEET_PLANNER_ERROR"}).eq("id",planId).eq("status","building");
      } catch { /* Never replace the original error with logging/storage failure. */ }
    }
    return failed(error);
  }
}
