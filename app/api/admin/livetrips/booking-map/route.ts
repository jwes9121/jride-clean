import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

// This route is always dynamic (called from the map page per booking)
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookingId = req.nextUrl.searchParams.get("bookingId");

    if (!bookingId) {
      return NextResponse.json(
        {
          error: "MISSING_BOOKING_ID",
          message: "bookingId is required.",
        },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    // 1) Load the booking
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      console.error("BOOKING_MAP_DB_ERROR_BOOKING", bookingError);
      return NextResponse.json(
        {
          error: "BOOKING_MAP_DB_ERROR_BOOKING",
          message: bookingError.message,
        },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        {
          error: "BOOKING_NOT_FOUND",
          message: "Booking not found.",
        },
        { status: 404 }
      );
    }

    // 2) Load assigned driver location if present
    let driverLocation: any = null;

    const assignedDriverId = (booking as any).assigned_driver_id as
      | string
      | null
      | undefined;

    if (assignedDriverId) {
      const { data: driverRow, error: driverError } = await supabase
        .from("driver_locations")
        .select("driver_id, lat, lng, status, town, updated_at")
        .eq("driver_id", assignedDriverId)
        .maybeSingle();

      if (driverError) {
        console.error("BOOKING_MAP_DB_ERROR_DRIVER", driverError);
        // Do NOT fail the whole request; just log and continue
      } else {
        driverLocation = driverRow;
      }
    }

    return NextResponse.json({ booking, driverLocation });
  } catch (err: any) {
    console.error("BOOKING_MAP_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "BOOKING_MAP_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while loading booking map.",
      },
      { status: 500 }
    );
  }
}
