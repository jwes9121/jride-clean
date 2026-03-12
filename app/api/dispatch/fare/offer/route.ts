import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingId?: string | null;
  bookingCode?: string | null;
  driverId?: string | null;
  fare?: number | string | null;
  convenienceFee?: number | string | null;
};

function num(x: any, d: number) {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    const driverId = String(body.driverId ?? "").trim();

    if (!driverId) return NextResponse.json({ ok: false, code: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    const baseFare = num(body.fare, NaN);
    if (!Number.isFinite(baseFare) || baseFare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const conv = num(body.convenienceFee, 15);
    const total = Math.round((baseFare + conv) * 100) / 100;

    let q = supabase.from("bookings").update({
      proposed_fare: total,
      passenger_fare_response: null,
      driver_id: driverId,
      assigned_driver_id: driverId,
      assigned_at: new Date().toISOString(),
      status: "fare_proposed",
      updated_at: new Date().toISOString(),
    });

    q = bookingId ? q.eq("id", bookingId) : q.eq("booking_code", bookingCode);

    const { data, error } = await q
      .select("id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "FARE_OFFER_DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row, total_fare: total, base_fare: baseFare, convenience_fee: conv });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "FARE_OFFER_FATAL", message: String(e?.message ?? e) }, { status: 500 });
  }
}