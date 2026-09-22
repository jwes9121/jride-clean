import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetOwner } from "@/lib/jfleet/server";
import { UUID, reviewFailure } from "@/lib/jfleet/routeReview";
export const dynamic = "force-dynamic";
const headers={"Cache-Control":"no-store, max-age=0"};
const json=(body:unknown,status=200)=>NextResponse.json(body,{status,headers});
function clean(value:unknown,max=2000):string {
  return String(value??"").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim().slice(0,max);
}
export async function POST(req:Request) {
  try {
    if(!jfleetFeatureFlagEnabled()) return json({ok:false,code:"JFLEET_NOT_ENABLED",message:"JFleet is not enabled yet."},503);
    const auth=await requireJfleetOwner(req);
    if(!auth.ok) return json({ok:false,code:auth.code,message:auth.message},auth.status);
    if(auth.partner.status!=="active") return json({ok:false,message:"This transport partner is not active."},403);
    const raw=await req.text();
    if(Buffer.byteLength(raw,"utf8")>24000) return json({ok:false,message:"Quotation is too large."},413);
    let body:Record<string,unknown>;
    try { body=JSON.parse(raw); } catch { return json({ok:false,message:"Invalid JSON quotation."},400); }
    if(!body || typeof body!=="object" || Array.isArray(body)) return json({ok:false,message:"Invalid quotation."},400);
    const inquiryId=clean(body.inquiry_id,80),reviewId=clean(body.route_review_id,80);
    if(!UUID.test(inquiryId)) return json({ok:false,message:"Choose a valid inquiry."},400);
    if(!UUID.test(reviewId)) return json({ok:false,code:"JFLEET_ROUTE_REVIEW_REQUIRED",message:"Open Route Review and approve the current itinerary before quoting."},409);
    const amount=Number(body.total_amount),validity=new Date(clean(body.valid_until,80));
    if(!Number.isFinite(amount)||amount<=0||amount>100000000) return json({ok:false,message:"Enter a valid quotation amount."},400);
    if(!Number.isFinite(validity.getTime())||validity.getTime()<=Date.now()) return json({ok:false,message:"Quotation validity must be in the future."},400);
    if(body.items!==undefined&&!Array.isArray(body.items)) return json({ok:false,message:"Review the quotation breakdown."},400);
    const rawItems=(body.items??[]) as unknown[];
    if(rawItems.length>20) return json({ok:false,message:"Use no more than 20 quotation items."},400);
    const items=rawItems.map(value=>{
      const item=value && typeof value==="object" ? value as Record<string,unknown>:{};
      return {item_type:clean(item.item_type||"other",40).toLowerCase(),label:clean(item.label,180),amount:Number(item.amount??0),included:item.included!==false,notes:clean(item.notes,500)||null};
    });
    if(items.some(i=>!i.label||!Number.isFinite(i.amount)||i.amount<0||!["vehicle_hire","fuel","driver","toll_parking","accommodation","other"].includes(i.item_type))) {
      return json({ok:false,message:"Review the quotation breakdown."},400);
    }
    const total=items.filter(i=>i.included).reduce((sum,i)=>sum+i.amount,0);
    if(items.length&&Math.abs(total-amount)>0.009) return json({ok:false,message:"Included quotation items must add up to the total quotation."},400);
    const r=await supabaseAdmin({noStore:true}).rpc("jfleet_owner_send_reviewed_quote_v1",{
      p_inquiry_id:inquiryId,p_owner_user_id:auth.user.id,p_review_id:reviewId,p_total_amount:amount,
      p_valid_until:validity.toISOString(),p_inclusions:clean(body.inclusions)||null,p_exclusions:clean(body.exclusions)||null,
      p_pricing_notes:clean(body.pricing_notes)||null,p_fuel_basis_note:clean(body.fuel_basis_note,1000)||null,p_items:items
    });
    if(r.error) {
      const m=String(r.error.message||"");
      if(m.includes("JFLEET_QUOTE_VALIDITY_INVALID")) return json({ok:false,message:"Quote validity must end before or at scheduled departure."},409);
      if(m.includes("JFLEET_QUOTE")||m.includes("JFLEET_INQUIRY_NOT_QUOTABLE")) return json({ok:false,message:"The quotation could not be issued. Refresh the inquiry and review its status and terms."},409);
      const f=reviewFailure(m);return json({ok:false,code:f.code,message:f.message},f.status);
    }
    return json(r.data,201);
  } catch { return json({ok:false,message:"The quotation could not be saved. Reload and retry."},503); }
}
