import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Service role preferred so we can verify/force the update if needed
const sb = createClient(URL, KEY, { auth: { persistSession: false } });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { rideId, town, maxAgeMinutes = 10, maxResults = 1 } = body || {};
    if (!rideId || !town) {
      return NextResponse.json({ status: "error", message: "rideId and town are required" }, { status: 400 });
    }

    // 1) Call RPC (SECURITY DEFINER in DB)
    const { data: rpcRows, error: rpcErr } = await sb.rpc("assign_nearest_driver", {
      p_ride_id: rideId,
      p_town: town,
      p_max_age_minutes: maxAgeMinutes,
      p_max_results: maxResults,
    });
    if (rpcErr) return NextResponse.json({ status: "error", message: rpcErr.message }, { status: 500 });

    const rpc = Array.isArray(rpcRows) && rpcRows.length ? rpcRows[0] : null;
    if (!rpc) return NextResponse.json({ status: "error", message: "Empty RPC response" }, { status: 200 });

    // 2) Verify the row actually changed; if not, force it (service role)
    const { data: after } = await sb
      .from("rides")
      .select("id,status,driver_id,updated_at")
      .eq("id", rideId)
      .maybeSingle();

    const already =
      after && after.driver_id && (String(after.driver_id) === String(rpc.driver_id)) &&
      (String(after.status).toLowerCase() === "assigned");

    if (!already && rpc.status === "assigned" && rpc.driver_id) {
      const { error: forceErr } = await sb
        .from("rides")
        .update({ driver_id: rpc.driver_id, status: "assigned" })
        .eq("id", rideId);

      if (forceErr) {
        return NextResponse.json({
          status: "error",
          message: `Assigned in RPC but DB row not updated: ${forceErr.message}`,
          rpc
        }, { status: 200 });
      }
    }

    // 3) Return definitive state
    const { data: finalRow } = await sb
      .from("rides")
      .select("id,status,driver_id,updated_at")
      .eq("id", rideId)
      .maybeSingle();

    return NextResponse.json({
      status: rpc.status,
      message: rpc.message || (finalRow?.driver_id ? "Assigned" : "No assignment"),
      driver_id: finalRow?.driver_id || rpc.driver_id || null,
      distance_meters: rpc.distance_meters ?? null,
      ride: finalRow || null,
    }, { status: 200 });

  } catch (e: any) {
    return NextResponse.json({ status: "error", message: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
