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

export async function GET() {
  try {
    const supabase = getServiceClient();

    const { data, error } = await supabase
      .from("zone_capacity_view")
      .select(
        "zone_id, zone_name, color_hex, capacity_limit, active_drivers, available_slots, status"
      )
      .order("zone_name", { ascending: true });

    if (error) {
      console.error("zone_capacity_view error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(data ?? []);
  } catch (err: any) {
    console.error("zones/capacity unexpected error:", err);
    return NextResponse.json(
      { error: err.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
