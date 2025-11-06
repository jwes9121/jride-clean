import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function admin() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  );
}

// Simple probe so GET never 405's (useful for health checks)
export async function GET() {
  return NextResponse.json({ ok: true, hint: "POST here to assign the latest pending ride" });
}

export async function POST() {
  try {
    const sb = admin();

    // 1) newest pending ride
    const { data: ride, error: findErr } = await sb
      .from("rides")
      .select("id,status,created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (findErr || !ride) {
      return NextResponse.json({ status: "no_pending_ride" }, { status: 200 });
    }

    // 2) call the DB function (relaxed version already working in your DB)
    const { data: result, error: rpcErr } = await sb
      .rpc("assign_nearest_driver_v2", { p_ride_id: ride.id });

    if (rpcErr) {
      return NextResponse.json({ error: "RPC failed", detail: rpcErr.message }, { status: 500 });
    }

    return NextResponse.json({ ride_id: ride.id, ...(result ?? {}) }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "Unhandled", detail: e?.message ?? String(e) }, { status: 500 });
  }
}
