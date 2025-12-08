import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/livetripss
 *
 * Returns live trips for the dispatch UI from `dispatch_rides_view`.
 */
export async function GET() {
  try {
    const supabase = supabaseAdmin();

    const { data, error } = await supabase
      .from("dispatch_rides_view")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("LIVE_TRIPS_DB_ERROR (Supabase)", error);
      return NextResponse.json(
        {
          error: "LIVE_TRIPS_DB_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        bookings: data ?? [],
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("LIVE_TRIPS_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "LIVE_TRIPS_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}

