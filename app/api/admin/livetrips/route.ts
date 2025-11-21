import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("bookings")
      .select(
        `
        id,
        booking_code,
        status,
        assigned_driver_id,
        pickup_address,
        dropoff_address,
        pickup_latlng,
        dropoff_latlng,
        created_at
      `
      )
      .in("status", [
        "pending",
        "assigned",
        "accepted",
        "on_the_way",
        "in_progress"
      ])
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("LIVE_TRIPS_DB_ERROR", error);
      return NextResponse.json(
        { error: "LIVE_TRIPS_DB_ERROR", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ bookings: data ?? [] });
  } catch (err: any) {
    console.error("LIVE_TRIPS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { error: "LIVE_TRIPS_UNEXPECTED_ERROR", message: err?.message },
      { status: 500 }
    );
  }
}
