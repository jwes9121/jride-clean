import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(url, key, { auth: { persistSession: false } });

export async function POST(req: NextRequest) {
  try {
    const { rideId, town, maxAgeMinutes = 10, maxResults = 1 } = await req.json();
    if (!rideId || !town) {
      return NextResponse.json({ error: "rideId and town are required" }, { status: 400 });
    }

    const { data, error } = await supabase.rpc("assign_nearest_driver", {
      p_ride_id: rideId,
      p_town: town,
      p_max_age_minutes: maxAgeMinutes,
      p_max_results: maxResults,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const row = Array.isArray(data) && data.length ? data[0] : null;
    if (!row) return NextResponse.json({ status: "error", message: "No response" }, { status: 200 });

    // row = { status, driver_id, distance_meters, message }
    return NextResponse.json(row, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
