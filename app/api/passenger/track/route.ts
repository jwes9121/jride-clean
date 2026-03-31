import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// 🔴 STRICT STATUS NORMALIZATION
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

// 🔴 SAFE NUMBER
function num(v: any): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// 🔴 REMOVE NULL KEYS
function clean(obj: any) {
  const out: any = {};
  for (const k in obj) {
    if (obj[k] !== null && obj[k] !== undefined) {
      out[k] = obj[k];
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const bookingCode = searchParams.get("booking_code");

    if (!bookingCode) {
      return NextResponse.json({
        ok: false,
        error: "MISSING_BOOKING_CODE"
      }, { status: 400 });
    }

    // 🔴 AUTH — TOKEN ONLY
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.replace("Bearer ", "").trim();

    if (!token) {
      return NextResponse.json({
        ok: false,
        error: "NOT_AUTHENTICATED"
      }, { status: 401 });
    }

    const {
      data: userData,
      error: userErr
    } = await supabase.auth.getUser(token);

    if (userErr || !userData?.user) {
      return NextResponse.json({
        ok: false,
        error: "INVALID_TOKEN"
      }, { status: 401 });
    }

    // 🔴 FETCH BOOKING
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
        platform_fee,
        total_fare
      `)
      .eq("booking_code", bookingCode)
      .single();

    if (bookingErr || !booking) {
      return NextResponse.json({
        ok: false,
        error: "BOOKING_NOT_FOUND"
      }, { status: 404 });
    }

    // 🔴 FETCH DRIVER
    let driverName: string | null = null;
    let driverPhone: string | null = null;

    if (booking.driver_id) {
      const { data: driver } = await supabase
        .from("drivers")
        .select("full_name, phone")
        .eq("id", booking.driver_id)
        .single();

      if (driver) {
        driverName = driver.full_name || null;
        driverPhone = driver.phone || null;
      }
    }

    // 🔴 FINAL RESPONSE (STRICT CONTRACT)
    const response = clean({
      ok: true,
      booking_code: booking.booking_code,
      status: normalizeStatus(booking.status),

      town: booking.town,
      from_label: booking.from_label,
      to_label: booking.to_label,

      driver_id: booking.driver_id,
      driver_name: driverName,
      driver_phone: driverPhone,

      driver_to_pickup_km: num(booking.driver_to_pickup_km),
      trip_distance_km: num(booking.trip_distance_km),
      pickup_eta_minutes: num(booking.pickup_eta_minutes),

      proposed_fare: num(booking.proposed_fare),
      pickup_distance_fee: num(booking.pickup_distance_fee),
      platform_fee: num(booking.platform_fee),
      total_fare: num(booking.total_fare)
    });

    return NextResponse.json(response);

  } catch (err: any) {
    return NextResponse.json({
      ok: false,
      error: err.message || "UNKNOWN_ERROR"
    }, { status: 500 });
  }
}