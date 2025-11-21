// app/api/live-location/route.ts
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();

  try {
    const { driverId, lat, lng, status } = await req.json();

    if (!driverId || typeof lat !== "number" || typeof lng !== "number") {
      return NextResponse.json(
        { error: "INVALID_PAYLOAD" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("driver_locations")
      .upsert(
        {
          driver_id: driverId,
          lat,
          lng,
          status: status ?? "online",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "driver_id" }
      );

    if (error) {
      console.error("LIVE_LOCATION_DB_ERROR", error);
      return NextResponse.json(
        {
          error: "DB_ERROR",
          code: error.code,
          message: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("LIVE_LOCATION_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { error: "UNEXPECTED_ERROR" },
      { status: 500 }
    );
  }
}

// Optional simple GET just to see the route is alive
export async function GET() {
  return NextResponse.json({ ok: true, route: "live-location" });
}
