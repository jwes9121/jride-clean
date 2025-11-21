import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();

  try {
    const body = await req.json();
    const { driverId, lat, lng, status } = body;

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      console.error("LIVE_LOCATION_INVALID_PAYLOAD", body);
      return NextResponse.json(
        { error: "INVALID_PAYLOAD", body },
        { status: 400 },
      );
    }

    console.log("LIVE_LOCATION_UPDATE", {
      driver_id: driverId,
      lat,
      lng,
      status,
    });

    const { data, error } = await supabase
      .from("driver_locations")
      .upsert(
        {
          driver_id: driverId,
          lat,
          lng,
          status: status ?? "online",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" },
      );

    if (error) {
      console.error("LIVE_LOCATION_DB_ERROR", error);
      return NextResponse.json(
        { error: "DB_ERROR", details: error },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("LIVE_LOCATION_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { error: "UNEXPECTED_ERROR", details: `${err}` },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "live-location" });
}
