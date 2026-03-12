import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const driver_id = String(body?.driver_id || "").trim();
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const proposed_fare = Number(body?.proposed_fare);

    if (!driver_id || !isUuidLike(driver_id)) {
      return NextResponse.json({ ok: false, code: "INVALID_DRIVER_ID" }, { status: 400 });
    }
    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }
    if (!Number.isFinite(proposed_fare) || proposed_fare <= 0) {
      return NextResponse.json({ ok: false, code: "INVALID_FARE" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    let q = supabase.from("bookings").update({
      proposed_fare,
      status: "fare_proposed",
      driver_id,
      assigned_driver_id: driver_id,
      updated_at: new Date().toISOString(),
    });

    q = booking_id ? q.eq("id", booking_id) : q.eq("booking_code", booking_code);

    const { data, error } = await q
      .select("id, booking_code, status, proposed_fare, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (error) {
      return NextResponse.json({ ok: false, code: "DB_ERROR", message: error.message }, { status: 500 });
    }

    const row = Array.isArray(data) && data.length ? data[0] : null;
    return NextResponse.json({ ok: true, booking: row });
  } catch (e: any) {
    return NextResponse.json({ ok: false, code: "SERVER_ERROR", message: String(e?.message || e) }, { status: 500 });
  }
}