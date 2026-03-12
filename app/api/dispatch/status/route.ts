import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  status?: string | null;
  base_fare?: number | null;
  convenience_fee?: number | null;
  proposed_fare?: number | null;
};

const ALLOWED = new Set([
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
  "cancelled",
]);

function normalizeStatus(raw: string) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "driver_accepted") return "accepted";
  if (s === "awaiting_passenger_confirmation") return "fare_proposed";
  return s;
}

function driverStatusForBookingStatus(s: string) {
  if (s === "completed" || s === "cancelled") return "online";
  if (["assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"].includes(s)) return "on_trip";
  return null;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const status = normalizeStatus(String(body.status ?? ""));
    const legacyFare = Number(body.base_fare ?? 0) + Number(body.convenience_fee ?? 0);
    const proposedFare = Number(body.proposed_fare ?? 0) || legacyFare || null;

    if (!status) return NextResponse.json({ error: "MISSING_STATUS" }, { status: 400 });
    if (!bookingId && !bookingCode) return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    if (!ALLOWED.has(status)) return NextResponse.json({ error: "INVALID_STATUS", statusValue: status }, { status: 400 });

    let sel = supabase.from("bookings").select("id, booking_code, status, driver_id").limit(1);
    sel = bookingId ? sel.eq("id", bookingId) : sel.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await sel;
    if (selErr) return NextResponse.json({ error: "DISPATCH_STATUS_SELECT_ERROR", message: selErr.message }, { status: 500 });

    const booking = rows?.[0];
    if (!booking?.id) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

    const updateBody: Record<string, any> = { status, updated_at: new Date().toISOString() };

    if (status === "fare_proposed" && proposedFare != null) {
      updateBody.proposed_fare = proposedFare;
    }

    const { error: upErr } = await supabase.from("bookings").update(updateBody).eq("id", booking.id);
    if (upErr) return NextResponse.json({ error: "DISPATCH_STATUS_DB_ERROR", message: upErr.message }, { status: 500 });

    const driverId = booking.driver_id ? String(booking.driver_id) : "";
    const mapped = driverStatusForBookingStatus(status);
    if (driverId && mapped) {
      await supabase.from("driver_locations").update({ status: mapped, updated_at: new Date().toISOString() }).eq("driver_id", driverId);
    }

    return NextResponse.json({ ok: true, status, legacy: true }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json({ error: "DISPATCH_STATUS_UNEXPECTED", message: err?.message ?? "Unexpected error" }, { status: 500 });
  }
}
