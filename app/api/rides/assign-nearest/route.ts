import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
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
    const { data: ride, error } = await sb
      .from("rides")
      .select("id,status,driver_id")
      .eq("id", ride_id)
      .single();

    if (error || !ride) {
      return NextResponse.json({ error: "Ride not found" }, { status: 404 });
    }

    // Idempotent behavior:
    if (ride.status === "assigned" && ride.driver_id) {
      return NextResponse.json({ status: "ok", driver_id: ride.driver_id });
    }

    if (ride.status !== "pending") {
      return NextResponse.json({ error: "Ride is not pending", status: ride.status }, { status: 409 });
    }

    const { data: result, error: rpcErr } = await sb
      .rpc("assign_nearest_driver_v2", { p_ride_id: ride_id });

    if (rpcErr) {
      return NextResponse.json({ error: "RPC failed", detail: rpcErr.message }, { status: 500 });
    }
    return NextResponse.json(result ?? { status: "ok" });
  } catch (e: any) {
    return NextResponse.json({ error: "Unhandled", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
