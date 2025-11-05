import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!; // service preferred
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false },
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { rideId, pickup, town, maxAgeMinutes = 10 } = body || {};

    if (!rideId || !pickup?.lat || !pickup?.lng || !town) {
      return NextResponse.json(
        { error: "rideId, pickup{lat,lng}, and town are required" },
        { status: 400 }
      );
    }

    // Call RPC
    const { data, error } = await supabase.rpc("assign_nearest_driver", {
      p_ride_id: rideId,
      p_pickup_lat: pickup.lat,
      p_pickup_lng: pickup.lng,
      p_town: town,
      p_max_age_minutes: maxAgeMinutes,
      p_max_results: 1,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;

    if (!row?.driver_id) {
      return NextResponse.json(
        { status: "no-driver", message: "No available driver in geofence" },
        { status: 200 }
      );
    }

    return NextResponse.json({
      status: "assigned",
      driverId: row.driver_id,
      distanceMeters: row.distance_meters,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
