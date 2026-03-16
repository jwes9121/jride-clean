import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  driver_id?: string | null;
  status?: string | null;
};

function driverStatusForBookingStatus(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "completed" || x === "cancelled") return "online";
  if (
    x === "pending" ||
    x === "assigned" ||
    x === "accepted" ||
    x === "fare_proposed" ||
    x === "ready" ||
    x === "on_the_way" ||
    x === "arrived" ||
    x === "on_trip"
  ) return "on_trip";
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? body.booking_id ?? "").trim();
    const bookingCode = String(body.bookingCode ?? body.booking_code ?? "").trim();
    const driverId = String(body.driver_id ?? "").trim();
    const status = String(body.status ?? "").trim();
    let normalizedStatus = status;
    if (normalizedStatus === "accepted") {
      normalizedStatus = "assigned";
    }

    if (!status) {
      return NextResponse.json(
        { ok: false, error: "MISSING_STATUS" },
        { status: 400 }
      );
    }

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_IDENTIFIER" },
        { status: 400 }
      );
    }

    let sel = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id")
      .limit(1);

    sel = bookingId
      ? sel.eq("id", bookingId)
      : sel.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await sel;

    if (selErr) {
      console.error("DISPATCH_STATUS_SELECT_ERROR", selErr);
      return NextResponse.json(
        {
          ok: false,
          error: "DISPATCH_STATUS_SELECT_ERROR",
          message: selErr.message,
          bookingId,
          bookingCode,
          driverId,
          status: normalizedStatus,
        },
        { status: 500 }
      );
    }

    const booking = rows?.[0];

    if (!booking?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_NOT_FOUND",
          bookingId,
          bookingCode,
          driverId,
          status: normalizedStatus,
        },
        { status: 404 }
      );
    }
const updatePayload: Record<string, any> = {
      status: normalizedStatus,
      updated_at: new Date().toISOString(),
    };

    if (driverId) {
      updatePayload.driver_id = driverId;
      updatePayload.assigned_driver_id = driverId;
    }

    const { data: updatedRows, error: upErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id)
      .select("id, booking_code, status, driver_id, assigned_driver_id");

    if (upErr) {
      console.error("DISPATCH_STATUS_DB_ERROR", upErr);
      return NextResponse.json(
        {
          ok: false,
          error: "DISPATCH_STATUS_DB_ERROR",
          message: upErr.message,
          bookingId,
          bookingCode,
          driverId,
          status: normalizedStatus,
          matchedBookingId: booking.id,
        },
        { status: 500 }
      );
    }

    const updated = updatedRows?.[0];

    if (!updated?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_UPDATE_EMPTY",
          bookingId,
          bookingCode,
          driverId,
          status: normalizedStatus,
          matchedBookingId: booking.id,
        },
        { status: 500 }
      );
    }

    const effectiveDriverId =
      String(updated.driver_id ?? booking.driver_id ?? driverId ?? "").trim();

    const mapped = driverStatusForBookingStatus(normalizedStatus);

    if (effectiveDriverId && mapped) {
      const { error: drvErr } = await supabase
        .from("driver_locations")
        .update({ status: mapped, updated_at: new Date().toISOString() })
        .eq("driver_id", effectiveDriverId);

      if (drvErr) {
        console.error("DRIVER_LOCATION_STATUS_UPDATE_ERROR", drvErr);
        return NextResponse.json(
          {
            ok: true,
            status: normalizedStatus,
            bookingId: updated.id,
            bookingCode: updated.booking_code,
            driverId: effectiveDriverId,
            warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR",
            message: drvErr.message,
          },
          { status: 200 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        status: updated.status,
        bookingId: updated.id,
        bookingCode: updated.booking_code,
        driverId: updated.driver_id,
        assignedDriverId: updated.assigned_driver_id,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("DISPATCH_STATUS_UNEXPECTED", err);
    return NextResponse.json(
      {
        ok: false,
        error: "DISPATCH_STATUS_UNEXPECTED",
        message: err?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}