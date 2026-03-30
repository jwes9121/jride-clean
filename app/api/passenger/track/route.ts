import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const bookingCode =
      req.nextUrl.searchParams.get("booking_code") ||
      req.nextUrl.searchParams.get("code");

    if (!bookingCode) {
      return NextResponse.json({ ok: false, error: "Missing booking_code" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const { data: booking, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .single();

    if (error || !booking) {
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    // === NORMALIZATION (CRITICAL FIX) ===
    let proposedFare = booking.proposed_fare ?? null;
    let verifiedFare = booking.verified_fare ?? null;

    // Treat ZERO as NULL for fare_proposed stage
    if (booking.status === "fare_proposed") {
      if (verifiedFare === 0) verifiedFare = null;
    }

    // Final fare logic
    const fare = verifiedFare ?? proposedFare ?? null;

    // Total fare logic
    const totalFare =
      booking.status === "fare_proposed"
        ? proposedFare ?? 0
        : verifiedFare ?? proposedFare ?? 0;

    return NextResponse.json({
      ok: true,
      ride: {
        booking_code: booking.booking_code,
        status: booking.status,

        from_label: booking.from_label,
        to_label: booking.to_label,
        town: booking.town,

        passenger_name: booking.passenger_name,
        passenger_fare_response: booking.passenger_fare_response ?? "",

        driver: {
          id: booking.driver_id,
          name: booking.driver_name ?? null,
          phone: booking.driver_phone ?? null,
        },

        route: {
          distance_km: booking.trip_distance_km ?? null,
          eta_minutes: booking.eta_minutes ?? null,
          trip_km: booking.trip_distance_km ?? null,
        },

        proposed_fare: proposedFare,
        verified_fare: verifiedFare,
        fare,
        total_fare: totalFare,

        pickup_distance_km: booking.pickup_distance_km ?? null,
        pickup_distance_fee: booking.pickup_distance_fee ?? 0,
        driver_to_pickup_km: booking.driver_to_pickup_km ?? null,

        eta_minutes: booking.eta_minutes ?? null,
        trip_distance_km: booking.trip_distance_km ?? null,

        updated_at: booking.updated_at,
        completed_at: booking.completed_at ?? "",
        cancelled_at: booking.cancelled_at ?? "",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e.message || "Unexpected error" },
      { status: 500 }
    );
  }
}