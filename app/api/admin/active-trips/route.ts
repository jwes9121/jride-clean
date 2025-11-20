import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
);

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("bookingId") ?? undefined;

    const activeStatuses = ["accepted", "assigned", "arrived", "on_trip"];

    let query = supabaseAdmin
      .from("bookings")
      .select(
        `
        id,
        booking_code,
        passenger_name,
        from_label,
        to_label,
        town,
        status,
        assigned_driver_id,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        updated_at
      `
      )
      .in("status", activeStatuses)
      .order("updated_at", { ascending: false });

    if (bookingId) {
      query = query.eq("id", bookingId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("ACTIVE_TRIPS_DB_ERROR", error);
      return NextResponse.json(
        { error: "Failed to load active trips.", details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ trips: data ?? [] }, { status: 200 });
  } catch (err: any) {
    console.error("ACTIVE_TRIPS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "Unexpected error in active-trips handler.",
        details: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
