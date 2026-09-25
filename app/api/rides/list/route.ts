import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { passengerJson, requirePassenger } from "@/lib/passenger/serverAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePassenger(req);
  if (auth.ok === false) return auth.response;
  try {
    let query = supabaseAdmin({ noStore: true }).from("bookings").select("*")
      .eq("created_by_user_id", auth.user.id)
      .or("service_type.in.(ride,motorcycle,tricycle,kolong_kolong),and(service_type.is.null,booking_code.like.JR-%)")
      .order("created_at", { ascending: false }).limit(200);
    const code = new URL(req.url).searchParams.get("booking_code");
    if (code) query = query.eq("booking_code", code).limit(1);
    const result = await query;
    if (result.error) return passengerJson(503, { ok: false, status: "error",
      error: "HISTORY_UNAVAILABLE", message: "Your ride history could not be loaded. Please try again." });
    return passengerJson(200, { ok: true, status: "ok", passenger_user_id: auth.user.id, data: result.data || [] });
  } catch {
    return passengerJson(503, { ok: false, status: "error", error: "HISTORY_UNAVAILABLE",
      message: "Your ride history could not be loaded. Please try again." });
  }
}
