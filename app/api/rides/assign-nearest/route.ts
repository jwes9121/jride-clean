import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { ride_id, pickup_lat, pickup_lng, town } = body;

    // 1. Call the RPC to get nearest driver
    const { data: nearest, error: rpcError } = await supabase.rpc(
      "find_nearest_driver",
      { p_pickup_lat: pickup_lat, p_pickup_lng: pickup_lng, p_town: town }
    );

    if (rpcError) throw rpcError;
    if (!nearest || nearest.length === 0)
      return NextResponse.json({ status: "no_driver" });

    const driverId = nearest[0].driver_id;

    // 2. Update ride record with assigned driver
    const { error: updateError } = await supabase
      .from("rides")
      .update({
        driver_id: driverId,
        status: "assigned",
        assigned_at: new Date().toISOString(),
      })
      .eq("id", ride_id);

    if (updateError) throw updateError;

    return NextResponse.json({ status: "ok", driver_id: driverId });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ status: "error", message: err.message });
  }
}
