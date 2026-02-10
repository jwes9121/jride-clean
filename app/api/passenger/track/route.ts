import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const fetchCache = "default-no-store";

function clean(s: any){ return String(s ?? "").trim(); }

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const booking_code = clean(url.searchParams.get("booking_code") || url.searchParams.get("code"));
    if (!booking_code) {
      return NextResponse.json({ ok: false, error: "booking_code required" }, { status: 400 });
    }

    const supabase = supabaseAdmin();

    const { data: rows, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", booking_code)
      .limit(1);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const booking: any = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!booking) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const driverId = String(booking.driver_id || booking.assigned_driver_id || "").trim();

    let driver_location: any = null;
    if (driverId) {
      // Prefer your existing view used by dispatch/admin
      const dl = await supabase
        .from("dispatch_driver_locations_view")
        .select("*")
        .eq("driver_id", driverId)
        .order("updated_at", { ascending: false })
        .limit(1);

      if (!dl.error && Array.isArray(dl.data) && dl.data.length) {
        driver_location = dl.data[0];
      }
    }

    return NextResponse.json({
      ok: true,
      booking_code,
      booking,
      driver_location,
      convenience_fee: 15,
      now: new Date().toISOString(),
    }, { headers: { "Cache-Control": "no-store, max-age=0" }});
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}