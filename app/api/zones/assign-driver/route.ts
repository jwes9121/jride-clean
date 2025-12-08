import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function getServiceClient() {
  const url =
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars"
    );
  }

  return createClient(url, key);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const driverId = body.driver_id as string | undefined;
    const zoneId = body.zone_id as string | undefined;

    if (!driverId || !zoneId) {
      return NextResponse.json(
        { error: "driver_id and zone_id are required" },
        { status: 400 }
      );
    }

    const supabase = getServiceClient();

    // Upsert driver row: if exists, update zone/status; if not, create.
    const { error } = await supabase.from("drivers").upsert(
      {
        id: driverId,
        zone_id: zoneId,
        driver_status: "online",
      },
      { onConflict: "id" }
    );

    if (error) {
      console.error("assign-driver error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    // Refresh capacity view
    await supabase.rpc("refresh_zone_capacity");

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("assign-driver unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
