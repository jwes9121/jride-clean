import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        status,
        assigned_driver_id,
        from_label,
        to_label,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        created_at
      `)
      .order("created_at", { ascending: false });

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
