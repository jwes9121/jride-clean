// app/api/dispatch/auto-assign/route.ts

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverRow = {
  driver_id: string;
  status: string;
  updated_at: string;
  lat: number;
  lng: number;
};

type BookingRow = {
  id: string;
  booking_code: string;
  pickup_lat: number;
  pickup_lng: number;
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const supabase = supabaseAdmin();

    // =========================================================
    // MODE: SCAN PENDING BOOKINGS (RETRY / DRIVER TRIGGER)
    // =========================================================
    if (body?.mode === "scan_pending") {

      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, booking_code, pickup_lat, pickup_lng")
        .in("status", ["requested"])
        .limit(5);

      for (const b of (bookings || []) as BookingRow[]) {
        await matchSingle(supabase, b);
      }

      return NextResponse.json({
        ok: true,
        scanned: bookings?.length || 0
      });
    }

    // =========================================================
    // MODE: SINGLE BOOKING (NORMAL FLOW)
    // =========================================================
    if (!body?.bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_ID" },
        { status: 400 }
      );
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, booking_code, pickup_lat, pickup_lng")
      .eq("id", body.bookingId)
      .single();

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    const result = await matchSingle(supabase, booking as BookingRow);

    return NextResponse.json({
      ok: true,
      result
    });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message || e) },
      { status: 500 }
    );
  }
}

// =========================================================
// MATCHER ENGINE (SINGLE BOOKING)
// =========================================================
async function matchSingle(supabase: any, booking: BookingRow) {

  const now = new Date();

  const { data: drivers } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng")
    .eq("status", "online");

  if (!drivers || drivers.length === 0) {
    return { assigned: false };
  }

  const eligible = (drivers as DriverRow[]).filter((d: DriverRow) => {
    const updated = new Date(d.updated_at);
    const ageSec = (now.getTime() - updated.getTime()) / 1000;

    return ageSec <= 120; // strict freshness window
  });

  if (eligible.length === 0) {
    return { assigned: false };
  }

  const chosen = eligible[0];

  await supabase
    .from("bookings")
    .update({
      driver_id: chosen.driver_id,
      status: "assigned",
      assigned_at: new Date().toISOString()
    })
    .eq("id", booking.id);

  return {
    assigned: true,
    driver_id: chosen.driver_id,
    booking_code: booking.booking_code
  };
}