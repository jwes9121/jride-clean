import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function bad(message: string, code: string, status = 400, extra: any = {}) {
  return NextResponse.json(
    { ok: false, code, message, ...extra },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(data: any = {}) {
  return NextResponse.json(
    { ok: true, ...data },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bookingCode, driverId } = body || {};

    if (!bookingCode) {
      return bad("Missing bookingCode", "MISSING_BOOKING", 400);
    }
    if (!driverId) {
      return bad("Missing driverId", "MISSING_DRIVER", 400);
    }

    // 1) Fetch booking
    const { data: booking, error: bookingErr } = await supabase
      .from("bookings")
      .select("id,status,driver_id")
      .eq("booking_code", bookingCode)
      .single();

    if (bookingErr || !booking) {
      return bad("Booking not found", "BOOKING_NOT_FOUND", 404);
    }

    if (booking.driver_id) {
      return bad("Booking already assigned", "ALREADY_ASSIGNED", 409);
    }

    if (["on_trip", "completed", "cancelled"].includes(booking.status)) {
      return bad("Booking not assignable", "NOT_ASSIGNABLE", 409, {
        status: booking.status,
      });
    }

    // 2) Ensure driver is not busy
    const { count: activeCount } = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driverId)
      .in("status", ["assigned", "on_the_way", "on_trip"]);

    if ((activeCount ?? 0) > 0) {
      return bad("Driver already on active trip", "DRIVER_BUSY", 409);
    }

    // 3) Assign with optimistic lock
    const { data: updated, error: updateErr } = await supabase
      .from("bookings")
      .update({
        driver_id: driverId,
        assigned_driver_id: driverId,
        assigned_at: new Date().toISOString(),
        status: "assigned",
      })
      .eq("booking_code", bookingCode)
      .is("driver_id", null)
      .select("id");

    if (updateErr || !updated || updated.length === 0) {
      return bad(
        "Assignment failed (no rows updated)",
        "NO_ROWS_UPDATED",
        409,
        { bookingCode, driverId }
      );
    }

    return ok({ bookingCode, driverId });
  } catch (e: any) {
    return bad(
      "Internal server error",
      "INTERNAL_ERROR",
      500,
      { error: String(e?.message || e) }
    );
  }
}
