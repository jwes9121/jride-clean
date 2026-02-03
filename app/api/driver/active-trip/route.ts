import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

function getSupabaseEnv() {
  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";

  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    "";

  return { url, key };
}

export async function GET(req: Request) {
  try {
    const urlObj = new URL(req.url);
    const driverId = String(urlObj.searchParams.get("driver_id") || "").trim();

    if (!driverId || !isUuidLike(driverId)) {
      return NextResponse.json(
        { ok: false, error: "INVALID_DRIVER_ID", message: "driver_id is required (uuid)." },
        { status: 400 }
      );
    }

    const env = getSupabaseEnv();
    if (!env.url || !env.key) {
      return NextResponse.json(
        {
          ok: false,
          error: "MISSING_SUPABASE_ENV",
          message: "Missing SUPABASE env. Need NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_URL + SUPABASE_ANON_KEY).",
        },
        { status: 500 }
      );
    }

    const supabase = createClient(env.url, env.key);

    // IMPORTANT: include 'assigned' because auto-assign sets status='assigned'
    const activeStatuses = ["assigned", "accepted", "on_the_way", "arrived", "on_trip"];

    const { data, error } = await supabase
      .from("bookings")
      .select("id, created_at, town, status, assigned_driver_id, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng")
      .eq("assigned_driver_id", driverId)
      .in("status", activeStatuses)
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      return NextResponse.json(
        { ok: false, error: "DB_ERROR", message: error.message },
        { status: 500 }
      );
    }

    const trip = Array.isArray(data) && data.length > 0 ? data[0] : null;

    return NextResponse.json({
      ok: true,
      driver_id: driverId,
      trip,
      note: trip ? "ACTIVE_TRIP_FOUND" : "NO_ACTIVE_TRIP",
      active_statuses: activeStatuses
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}