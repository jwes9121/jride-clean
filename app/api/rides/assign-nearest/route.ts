import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { rideId, town, maxAgeMinutes = 10, maxResults = 1 } = body || {};

    if (!rideId || !town) {
      return NextResponse.json(
        { error: "rideId and town are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("assign_nearest_driver", {
      p_ride_id: rideId,
      p_town: town,
      p_max_age_minutes: maxAgeMinutes,
      p_max_results: maxResults,
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
