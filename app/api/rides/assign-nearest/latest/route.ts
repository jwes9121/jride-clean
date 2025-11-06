import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

export async function POST() {
  try {
    const sb = admin();
    const { data: ride } = await sb
      .from("rides")
      .select("id,status,created_at")
      .eq("status","pending")
      .order("created_at",{ascending:false})
      .limit(1)
      .single();

    if (!ride) return NextResponse.json({ status: "no_pending_ride" });

    const { data: result, error } = await sb
      .rpc("assign_nearest_driver_v2", { p_ride_id: ride.id });

    if (error) return NextResponse.json({ error: "RPC failed", detail: error.message }, { status: 500 });
    return NextResponse.json({ ride_id: ride.id, ...(result ?? {}) });
  } catch (e: any) {
    return NextResponse.json({ error: "Unhandled", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
