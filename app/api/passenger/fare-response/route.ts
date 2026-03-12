import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const booking_id = String(body?.booking_id || "").trim();
    const booking_code = String(body?.booking_code || "").trim();
    const raw = String(body?.response || "").trim().toLowerCase();

    if ((!booking_id || !isUuidLike(booking_id)) && !booking_code) {
      return NextResponse.json({ ok: false, code: "MISSING_BOOKING" }, { status: 400 });
    }

    const response =
      raw === "accepted" ? "accepted" :
      (raw === "declined" || raw === "rejected") ? "rejected" :
      "";

    if (!response) {
      return NextResponse.json({ ok: false, code: "INVALID_RESPONSE" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const patch =
      response === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            driver_status: "ready",
            customer_status: "ready",
            updated_at: new Date().toISOString(),
          }
        : {
            passenger_fare_response: "rejected",
            status: "pending",
            driver_id: null,
            assigned_driver_id: null,
            assigned_at: null,
            proposed_fare: null,
            verified_fare: null,
            verified_by: null,
            verified_at: null,
            verified_reason: null,
            updated_at: new Date().toISOString(),
          };

    let q = supabase.from("bookings").update(patch);
    q = booking_id ? q.eq("id", booking_id) : q.eq("booking_code", booking_code);

    const { data, error } = await q
      .select("id, booking_code, status, proposed_fare, verified_fare, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
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