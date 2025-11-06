import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!; // SERVICE ROLE (server only)
  return createClient(url, key, { auth: { persistSession: false } });
}

function isUuid(v: unknown) {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export async function POST(req: NextRequest) {
  try {
    const { ride_id } = await req.json().catch(() => ({}));
    if (!isUuid(ride_id)) {
      return NextResponse.json({ error: "Invalid ride_id" }, { status: 400 });
    }

    const sb = admin();

    // optional: enforce pending
    const { data: ride, error: rideErr } = await sb
      .from("rides")
      .select("id,status")
      .eq("id", ride_id)
      .single();

    if (rideErr || !ride) return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    if (ride.status !== "pending") return NextResponse.json({ error: "Ride is not pending" }, { status: 409 });

    const { data: result, error: rpcErr } = await sb
      .rpc("assign_nearest_driver_v2", { p_ride_id: ride_id });

    if (rpcErr) return NextResponse.json({ error: "RPC failed", detail: rpcErr.message }, { status: 500 });
    return NextResponse.json(result ?? { status: "ok" });
  } catch (e: any) {
    return NextResponse.json({ error: "Unhandled", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
