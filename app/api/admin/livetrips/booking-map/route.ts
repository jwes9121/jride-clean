import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type BookingRow = {
  id: string;
  booking_code: string;
  status: string;
  assigned_driver_id: string | null;
  from_label: string | null;
  to_label: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  created_at: string;
};

type DriverLocationRow = {
  driver_id: string;
  lat: number | null;
  lng: number | null;
  status?: string | null;
  town?: string | null;
  updated_at?: string | null;
};

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

    // 1) Load the booking with all fields we care about
    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select(
        `
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
      `
      )
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

    const bookingRow = booking as BookingRow;

    // 2) Load assigned driver location if present
    let driverLocation: DriverLocationRow | null = null;

    if (bookingRow.assigned_driver_id) {
      const { data: driverRow, error: driverError } = await supabase
        .from("driver_locations")
        .select("driver_id, lat, lng, status, town, updated_at")
        .eq("driver_id", bookingRow.assigned_driver_id)
        .maybeSingle();

      if (driverError) {
        console.error("BOOKING_MAP_DB_ERROR_DRIVER", driverError);
        // Do not fail the whole request; just log and continue
      } else if (driverRow) {
        driverLocation = driverRow as DriverLocationRow;
      }
    }

    return NextResponse.json(
      {
        booking: bookingRow,
        driverLocation,
      },
      { status: 200 }
    );
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
