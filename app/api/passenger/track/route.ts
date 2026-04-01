import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeStatus(raw: string | null): string {
  const s = (raw || "").toLowerCase().trim();

  switch (s) {
    case "searching":
    case "requested":
      return "pending";
    case "driver_assigned":
      return "assigned";
    case "accepted_by_driver":
      return "accepted";
    case "en_route":
      return "on_the_way";
    case "in_progress":
      return "on_trip";
    default:
      return s;
  }
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clean(obj: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined) out[k] = v;
  }
  return out;
}

function addMoney(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  return (a ?? 0) + (b ?? 0);
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

    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        status,
        town,
        from_label,
        to_label,
        driver_id,
        assigned_driver_id,
        driver_to_pickup_km,
        trip_distance_km,
        pickup_eta_minutes,
        proposed_fare,
        pickup_distance_fee,
        created_by_user_id
      `)
      .eq("booking_code", bookingCode)
      .single();

    if (bookingErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_QUERY_FAILED",
          details: bookingErr.message,
        },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    let driverName: string | null = null;
    let driverPhone: string | null = null;

    if (booking.driver_id) {
      const { data: driver } = await supabase
        .from("drivers")
        .select("full_name, phone")
        .eq("id", booking.driver_id)
        .maybeSingle();

      if (driver) {
        driverName = driver.full_name || null;
        driverPhone = driver.phone || null;
      }
    }

    const proposedFare = num(booking.proposed_fare);
    const pickupDistanceFee = num(booking.pickup_distance_fee);
    const totalFare = addMoney(proposedFare, pickupDistanceFee);

    const response = clean({
      ok: true,
      id: booking.id,
      booking_code: booking.booking_code,
      status: normalizeStatus(booking.status),

      town: booking.town,
      from_label: booking.from_label,
      to_label: booking.to_label,

      driver_id: booking.driver_id,
      assigned_driver_id: booking.assigned_driver_id,
      driver_name: driverName,
      driver_phone: driverPhone,

      driver_to_pickup_km: num(booking.driver_to_pickup_km),
      trip_distance_km: num(booking.trip_distance_km),
      pickup_eta_minutes: num(booking.pickup_eta_minutes),

      proposed_fare: proposedFare,
      pickup_distance_fee: pickupDistanceFee,
      total_fare: totalFare,
    });

    return NextResponse.json(response);
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "UNKNOWN_ERROR",
      },
      { status: 500 }
    );
  }
}