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
        pickup_label,
        dropoff_label,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        created_at
      `
      )
      .in("status", [
        "pending",
        "assigned",
        "accepted",
        "on_the_way",
        "in_progress",
      ])
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("LIVE_TRIPS_DB_ERROR", error);
      return NextResponse.json(
        {
          error: "LIVE_TRIPS_DB_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      bookings: data ?? [],
    });
  } catch (err: any) {
    console.error("LIVE_TRIPS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "LIVE_TRIPS_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while loading live trips.",
      },
      { status: 500 }
    );
  }
}
