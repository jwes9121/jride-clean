import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DriverRow = {
  driver_id: string;
  status: string | null;
  updated_at: string | null;
  lat: number | null;
  lng: number | null;
};

type BookingRow = {
  id: string;
  booking_code: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  status?: string | null;
  driver_id?: string | null;
};

const ASSIGN_FRESHNESS_SECONDS = 10;
const SCAN_LIMIT = 5;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = supabaseAdmin();

    // Mode: scan waiting bookings
    if (body?.mode === "scan_pending") {
      const { data: bookings, error } = await supabase
        .from("bookings")
        .select("id, booking_code, pickup_lat, pickup_lng, status, driver_id")
        .eq("status", "requested")
        .is("driver_id", null)
        .order("created_at", { ascending: true })
        .limit(SCAN_LIMIT);

      if (error) {
        return NextResponse.json(
          { ok: false, error: "BOOKINGS_SCAN_FAILED", message: error.message },
          { status: 500 }
        );
      }

      const results: Array<{
        booking_id: string;
        booking_code: string | null;
        assigned: boolean;
        driver_id?: string | null;
        reason?: string;
      }> = [];

      for (const booking of (bookings || []) as BookingRow[]) {
        const result = await matchSingle(supabase, booking);
        results.push({
          booking_id: booking.id,
          booking_code: booking.booking_code ?? null,
          assigned: !!result.assigned,
          driver_id: result.driver_id ?? null,
          reason: result.reason,
        });
      }

      return NextResponse.json({
        ok: true,
        mode: "scan_pending",
        scanned: bookings?.length || 0,
        results,
      });
    }

    // Mode: single booking
    const bookingId = String(body?.bookingId || "").trim();
    if (!bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_ID" },
        { status: 400 }
      );
    }

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, booking_code, pickup_lat, pickup_lng, status, driver_id")
      .eq("id", bookingId)
      .single();

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_READ_FAILED", message: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404 }
      );
    }

    const result = await matchSingle(supabase, booking as BookingRow);

    return NextResponse.json({
      ok: true,
      mode: "single",
      result,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "AUTO_ASSIGN_FAILED", message: String(e?.message || e) },
      { status: 500 }
    );
  }
}

async function matchSingle(supabase: any, booking: BookingRow): Promise<{
  assigned: boolean;
  driver_id?: string | null;
  booking_code?: string | null;
  reason?: string;
}> {
  if (!booking?.id) {
    return { assigned: false, reason: "INVALID_BOOKING" };
  }

  // Only assign waiting bookings with no driver
  if (String(booking.status || "").trim().toLowerCase() !== "requested") {
    return { assigned: false, reason: "BOOKING_NOT_REQUESTED" };
  }

  if (booking.driver_id) {
    return { assigned: false, reason: "BOOKING_ALREADY_ASSIGNED" };
  }

  const nowMs = Date.now();

  const { data: drivers, error: driversError } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng");

  if (driversError) {
    return { assigned: false, reason: "DRIVER_SCAN_FAILED" };
  }

  const eligible = ((drivers || []) as DriverRow[]).filter((d: DriverRow) => {
    // Hard block if not explicitly online
    if (String(d.status || "").trim().toLowerCase() !== "online") {
      return false;
    }

    // Hard block if no recent ping
    if (!d.updated_at) {
      return false;
    }

    const updatedMs = new Date(d.updated_at).getTime();
    if (!Number.isFinite(updatedMs)) {
      return false;
    }

    const ageSec = (nowMs - updatedMs) / 1000;
    if (ageSec > ASSIGN_FRESHNESS_SECONDS) {
      return false;
    }

    return true;
  });

  if (eligible.length === 0) {
    return { assigned: false, reason: "NO_ELIGIBLE_DRIVERS" };
  }

  // Keep current simple behavior: first eligible driver
  const chosen = eligible[0];

  const { error: updateError } = await supabase
    .from("bookings")
    .update({
      driver_id: chosen.driver_id,
      assigned_driver_id: chosen.driver_id,
      status: "assigned",
      assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", booking.id)
    .eq("status", "requested")
    .is("driver_id", null);

  if (updateError) {
    return { assigned: false, reason: "BOOKING_UPDATE_FAILED" };
  }

  return {
    assigned: true,
    driver_id: chosen.driver_id,
    booking_code: booking.booking_code ?? null,
  };
}