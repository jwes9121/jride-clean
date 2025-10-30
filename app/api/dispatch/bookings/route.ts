import { NextRequest, NextResponse } from "next/server";
import { auth } from "../../../../auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function jsonError(msg: string, code = 400) {
  return NextResponse.json({ error: msg }, { status: code });
}
function isAllowed(role?: string) {
  return role === "admin" || role === "dispatcher";
}

export async function GET(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  if (!isAllowed(role)) return jsonError("Forbidden", 403);

  const sb = supabaseAdmin();
  const { searchParams } = new URL(req.url);
  const since = searchParams.get("since"); // optional ISO string

  let query = sb.from("bookings").select("*").order("created_at", { ascending: false }).limit(200);
  if (since) query = query.gte("created_at", since);

  const { data, error } = await query;
  if (error) return jsonError(error.message, 500);
  return NextResponse.json({ rows: data || [] });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  const role = (session?.user as any)?.role;
  const email = session?.user?.email || "";
  if (!isAllowed(role)) return jsonError("Forbidden", 403);

  let body: any = null;
  try { body = await req.json(); } catch { return jsonError("Invalid JSON"); }

  const pickup_lat = Number(body.pickup_lat);
  const pickup_lng = Number(body.pickup_lng);
  const town = String(body.town || "").trim();
  if (!pickup_lat || !pickup_lng || !town) return jsonError("pickup_lat, pickup_lng, town required");

  const sb = supabaseAdmin();
  const insert = {
    rider_name: String(body.rider_name || ""),
    rider_phone: String(body.rider_phone || ""),
    pickup_lat, pickup_lng,
    dropoff_lat: body.dropoff_lat ? Number(body.dropoff_lat) : null,
    dropoff_lng: body.dropoff_lng ? Number(body.dropoff_lng) : null,
    town,
    distance_km: body.distance_km ? Number(body.distance_km) : null,
    fare: body.fare ? Number(body.fare) : null,
    notes: String(body.notes || ""),
    dispatcher_email: email,
  };

  const { data, error } = await sb.from("bookings").insert(insert).select("*").single();
  if (error) return jsonError(error.message, 500);

  await sb.from("dispatcher_action_logs").insert({
    booking_id: data.id,
    action: "created",
    actor_email: email,
    details: insert as any,
  });

  return NextResponse.json({ row: data });
}
