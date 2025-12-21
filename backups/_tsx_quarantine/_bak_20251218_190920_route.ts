import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  status?: string | null;
};

function driverStatusForBookingStatus(s: string) {
  const x = (s || "").toLowerCase();
  if (x === "completed" || x === "cancelled") return "online";
  if (x === "pending" || x === "assigned" || x === "on_the_way" || x === "on_trip") return "on_trip";
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const status = String(body.status ?? "").trim();

    if (!status) return NextResponse.json({ error: "MISSING_STATUS" }, { status: 400 });
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    let sel = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id")
      .limit(1);

    sel = bookingId ? sel.eq("id", bookingId) : sel.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await sel;
    if (selErr) {
      console.error("DISPATCH_STATUS_SELECT_ERROR", selErr);
      return NextResponse.json({ error: "DISPATCH_STATUS_SELECT_ERROR", message: selErr.message }, { status: 500 });
    }
    const booking = rows?.[0];
    if (!booking?.id) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

    const { error: upErr } = await supabase
      .from("bookings")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", booking.id);

    if (upErr) {
      console.error("DISPATCH_STATUS_DB_ERROR", upErr);
      return NextResponse.json({ error: "DISPATCH_STATUS_DB_ERROR", message: upErr.message }, { status: 500 });
    }

    const driverId = booking.driver_id ? String(booking.driver_id) : "";
    const mapped = driverStatusForBookingStatus(status);

    if (driverId && mapped) {
      const { error: drvErr } = await supabase
        .from("driver_locations")
        .update({ status: mapped, updated_at: new Date().toISOString() })
        .eq("driver_id", driverId);

      if (drvErr) {
        console.error("DRIVER_LOCATION_STATUS_UPDATE_ERROR", drvErr);
        return NextResponse.json(
          { ok: true, status, warning: "DRIVER_LOCATION_STATUS_UPDATE_ERROR", message: drvErr.message },
          { status: 200 }
        );
      }
    }

    return NextResponse.json({ ok: true, status }, { status: 200 });
  } catch (err: any) {
    console.error("DISPATCH_STATUS_UNEXPECTED", err);
    return NextResponse.json(
      { error: "DISPATCH_STATUS_UNEXPECTED", message: err?.message ?? "Unexpected error" },
      { status: 500 }
    );
  }
}
