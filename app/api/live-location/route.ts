import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// This is the driver assigned to JR-2025-0002
const TEST_DRIVER_ID = "45e66af4-f7d1-4a34-a74e-52d274cecd0f";

export async function POST(req: NextRequest) {
  const supabase = supabaseAdmin();

  try {
    const body = await req.json();
    const { lat, lng, status } = body;

    if (typeof lat !== "number" || typeof lng !== "number") {
      console.error("LIVE_LOCATION_INVALID_PAYLOAD", body);
      return NextResponse.json(
        { error: "INVALID_PAYLOAD", body },
        { status: 400 },
      );
    }

    console.log("LIVE_LOCATION_UPDATE", {
      driver_id: TEST_DRIVER_ID,
      lat,
      lng,
      status,
    });

    const { data, error } = await supabase
      .from("driver_locations")
      .upsert(
        {
          driver_id: TEST_DRIVER_ID,
          lat,
          lng,
          status: status ?? "online",
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
      { error: "UNEXPECTED_ERROR" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "live-location" });
}
