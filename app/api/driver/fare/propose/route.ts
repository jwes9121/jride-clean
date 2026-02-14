import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  driver_id?: string;
  booking_id?: string;
  booking_code?: string;
  proposed_fare?: number;
};

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const driver_id = String(body.driver_id ?? "").trim();
    const booking_id = String(body.booking_id ?? "").trim();
    const booking_code = String(body.booking_code ?? "").trim();

    const proposed = Number(body.proposed_fare);
    if (!driver_id) return NextResponse.json({ ok: false, error: "MISSING_DRIVER_ID" }, { status: 400 });
    if (!booking_id && !booking_code) return NextResponse.json({ ok: false, error: "MISSING_BOOKING_ID" }, { status: 400 });
    if (!Number.isFinite(proposed) || proposed < 0) return NextResponse.json({ ok: false, error: "INVALID_PROPOSED_FARE" }, { status: 400 });

    // Select booking
    let sel = supabase.from("bookings").select("id,status,driver_id,booking_code").limit(1);
    sel = booking_id ? sel.eq("id", booking_id) : sel.eq("booking_code", booking_code);

    const { data: rows, error: selErr } = await sel;
    if (selErr) return NextResponse.json({ ok: false, error: "DB_SELECT_ERROR", message: selErr.message }, { status: 500 });
    const b = rows?.[0];
    if (!b?.id) return NextResponse.json({ ok: false, error: "BOOKING_NOT_FOUND" }, { status: 404 });

    // Only allow proposing fare when booking is in an "assignable/active" state
    const st = String(b.status ?? "").toLowerCase();
    const allowed = ["assigned", "accepted", "pending", "on_the_way", "arrived", "on_trip"];
    if (st && !allowed.includes(st)) {
      return NextResponse.json({ ok: false, error: "NOT_ALLOWED", message: "Booking status not allowed for fare proposal.", status: st }, { status: 409 });
    }

    // Write proposed_fare; set status to 'fare_proposed' (driver accepted), passenger will accept/decline next.
    const { error: upErr } = await supabase
      .from("bookings")
      .update({
        driver_id,
        proposed_fare: proposed,
        updated_at: new Date().toISOString(),
        status: "fare_proposed",
      })
      .eq("id", b.id);

    if (upErr) return NextResponse.json({ ok: false, error: "DB_UPDATE_ERROR", message: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, booking_id: b.id, booking_code: b.booking_code, proposed_fare: proposed }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: "SERVER_ERROR", message: String(e?.message ?? e) }, { status: 500 });
  }
}