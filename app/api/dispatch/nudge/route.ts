import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = { bookingCode?: string | null; bookingId?: string | null };

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const bookingId = String(body.bookingId ?? "").trim();
    const bookingCode = String(body.bookingCode ?? "").trim();
    if (!bookingId && !bookingCode) {
      return NextResponse.json({ error: "MISSING_BOOKING_IDENTIFIER" }, { status: 400 });
    }

    let sel = supabase.from("bookings").select("id, booking_code, updated_at").limit(1);
    sel = bookingId ? sel.eq("id", bookingId) : sel.eq("booking_code", bookingCode);

    const { data: rows, error: selErr } = await sel;
    if (selErr) return NextResponse.json({ error: "BOOKING_SELECT_ERROR", message: selErr.message }, { status: 500 });

    const booking = rows?.[0];
    if (!booking?.id) return NextResponse.json({ error: "BOOKING_NOT_FOUND" }, { status: 404 });

    // No new columns. Just bump updated_at so UI can reflect an action occurred.
    const { error: upErr } = await supabase
      .from("bookings")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", booking.id);

    if (upErr) return NextResponse.json({ error: "BOOKING_UPDATE_ERROR", message: upErr.message }, { status: 500 });

    return NextResponse.json({ ok: true, action: "nudge", bookingId: booking.id, bookingCode: booking.booking_code }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: "NUDGE_UNEXPECTED", message: e?.message ?? "Unexpected error" }, { status: 500 });
  }
}