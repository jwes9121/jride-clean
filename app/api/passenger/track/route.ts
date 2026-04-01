import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function statusOf(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  if (s === "requested" || s === "searching") return "pending";
  if (s === "driver_assigned") return "assigned";
  if (s === "accepted_by_driver") return "accepted";
  if (s === "en_route") return "on_the_way";
  if (s === "in_progress") return "on_trip";
  return s;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingCode = searchParams.get("booking_code")?.trim();

    if (!bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400 }
      );
    }

    const bookingRes = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .limit(1);

    if (bookingRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_QUERY_FAILED",
          details: bookingRes.error.message,
        },
        { status: 500 }
      );
    }

    const booking = bookingRes.data?.[0];
    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    const driverId = booking.driver_id ?? booking.assigned_driver_id ?? null;

    let driverName: string | null = null;
    let driverPhone: string | null = null;

    if (driverId) {
      const driverRes = await supabase
        .from("drivers")
        .select("id,full_name,phone")
        .eq("id", driverId)
        .limit(1);

      if (!driverRes.error) {
        const driver = driverRes.data?.[0];
        if (driver) {
          driverName = driver.full_name ?? null;
          driverPhone = driver.phone ?? null;
        }
      }
    }

    const proposedFare = n(booking.proposed_fare);
    const pickupDistanceFee = n(booking.pickup_distance_fee);
    const totalFare =
      n((booking as any).total_fare) ??
      ((proposedFare ?? 0) + (pickupDistanceFee ?? 0));

    return NextResponse.json({
      ok: true,
      id: booking.id,
      booking_code: booking.booking_code,
      status: statusOf(booking.status),

      town: booking.town ?? null,
      from_label: booking.from_label ?? null,
      to_label: booking.to_label ?? null,

      driver_id: booking.driver_id ?? null,
      assigned_driver_id: booking.assigned_driver_id ?? null,
      driver_name: driverName,
      driver_phone: driverPhone,

      driver_to_pickup_km: n(booking.driver_to_pickup_km),
      trip_distance_km: n(booking.trip_distance_km),
      pickup_eta_minutes:
        n((booking as any).pickup_eta_minutes) ??
        n((booking as any).eta_minutes),

      proposed_fare: proposedFare,
      pickup_distance_fee: pickupDistanceFee,
      total_fare: totalFare,

      passenger_fare_response: booking.passenger_fare_response ?? null,
      created_at: booking.created_at ?? null,
      updated_at: booking.updated_at ?? null,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "TRACK_ROUTE_CRASH",
        details: err?.message ?? "UNKNOWN_ERROR",
      },
      { status: 500 }
    );
  }
}