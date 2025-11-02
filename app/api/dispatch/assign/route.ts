import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function err(msg: string, code = 400) { return NextResponse.json({ error: msg }, { status: code }); }
function ok(payload: any) { return NextResponse.json(payload); }
function allowed(r?: string) { return r === "admin" || r === "dispatcher"; }

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const email = session?.user?.email || "";
  if (!allowed(role)) return err("Forbidden", 403);

  let body: any = null;
  try { body = await req.json(); } catch { return err("Invalid JSON"); }

  const booking_id = String(body.booking_id || "").trim();
  const driver_id = String(body.driver_id || "").trim();
  if (!booking_id || !driver_id) return err("booking_id and driver_id required");

  const sb = supabaseAdmin();

  // fetch booking (to get pickup town)
  const bk = await sb.from("bookings").select("id, town, status").eq("id", booking_id).single();
  if (bk.error) return err(bk.error.message, 500);
  const bookingTown = bk.data.town;

  // fetch driver latest town
  const dr = await sb
    .from("driver_locations_with_town")
    .select("town")
    .eq("driver_id", driver_id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (dr.error) return err(dr.error.message, 500);
  const driverTown = dr.data ? dr.data.town : null;

  if (!driverTown) return err("Driver has no recent location", 400);
  if (driverTown !== bookingTown) return err("Driver town does not match pickup town", 400);

  const upd = await sb.from("bookings")
    .update({ driver_id, status: "assigned", dispatcher_email: email })
    .eq("id", booking_id)
    .select("*").single();

  if (upd.error) return err(upd.error.message, 500);

  await sb.from("dispatcher_action_logs").insert({
    booking_id, action: "assigned", actor_email: email, details: { driver_id, driverTown, bookingTown }
  });

  return ok({ row: upd.data });
}
