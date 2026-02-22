import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: Request) {
  try {
    const supabase = createClient();

    const { data: auth } = await supabase.auth.getUser();
    const user = auth?.user;
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const booking_id = body?.booking_id ? String(body.booking_id) : "";
    if (!booking_id) return NextResponse.json({ ok: false, error: "Missing booking_id" }, { status: 400 });

    const { data: b, error: bErr } = await supabase
      .from("bookings")
      .select("id, created_by_user_id, passenger_fare_response")
      .eq("id", booking_id)
      .single();

    if (bErr) return NextResponse.json({ ok: false, error: bErr.message }, { status: 500 });
    if (!b) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    if (String(b.created_by_user_id || "") !== String(user.id)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const { data: upd, error: uErr } = await supabase
      .from("bookings")
      .update({
        passenger_fare_response: "rejected",

        // Make booking re-dispatchable
        status: "pending",

        // Clear current driver assignment so next driver can be assigned
        driver_id: null,
        assigned_driver_id: null,
        assigned_at: null,

        // Clear fare so new driver can propose again
        proposed_fare: null,
        verified_fare: null,
        verified_by: null,
        verified_at: null,
        verified_reason: null,

        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .select("id, passenger_fare_response")
      .single();

    if (uErr) return NextResponse.json({ ok: false, error: uErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, booking: upd }, { status: 200 });
  } catch (e: any) {
    console.error("[fare/reject] exception", e);
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}