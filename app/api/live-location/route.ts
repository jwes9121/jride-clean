// app/api/live-location/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();

  try {
    const body = await req.json();
    const { driverId, lat, lng, status } = body;

    if (typeof lat !== "number" || typeof lng !== "number") {
      console.error("LIVE_LOCATION_INVALID_PAYLOAD", body);
      return NextResponse.json(
        { error: "INVALID_PAYLOAD", body },
        { status: 400 }
      );
    }

    // IMPORTANT: do NOT send driver_id (it is uuid in DB and causing 22P02)
    // We just log it for now so we can wire it properly later.
    console.log("LIVE_LOCATION_UPDATE", {
      driverId,
      lat,
      lng,
      status,
    });

    const { data, error } = await supabase
      .from("driver_locations")
      .insert({
        // driver_id: driverId,  // <--- REMOVED on purpose
        lat,
        lng,
        status: status ?? "online",
      });

    if (error) {
      console.error("LIVE_LOCATION_DB_ERROR", error);
      return NextResponse.json(
        { error: "DB_ERROR", details: error },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err) {
    console.error("LIVE_LOCATION_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { error: "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "live-location" });
}
