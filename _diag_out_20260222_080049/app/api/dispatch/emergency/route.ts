import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  bookingCode?: string | null;
  booking_code?: string | null;
  bookingId?: string | null;
  id?: string | null;
  uuid?: string | null;
};

function pickBookingKey(body: Body): { bookingId: string; bookingCode: string } {
  const bookingId = String(body.bookingId ?? body.id ?? body.uuid ?? "").trim();
  const bookingCode = String(body.bookingCode ?? body.booking_code ?? "").trim();
  return { bookingId, bookingCode };
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const { bookingId, bookingCode } = pickBookingKey(body);

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { error: "MISSING_BOOKING_IDENTIFIER" },
        { status: 400 }
      );
    }

    // JRIDE_EMERGENCY_FALLBACK_V1:
    // 1) Try bookingId as bookings.id
    // 2) If not found, fallback to bookingCode as bookings.booking_code
    let booking: any | null = null;

    if (bookingId) {
      const { data: rows, error } = await supabase
        .from("bookings")
        .select("id, booking_code")
        .eq("id", bookingId)
        .limit(1);

      if (error) {
        return NextResponse.json(
          { error: "BOOKING_SELECT_ERROR", message: error.message },
          { status: 500 }
        );
      }

      booking = rows?.[0] ?? null;
    }

    if (!booking?.id && bookingCode) {
      const { data: rows, error } = await supabase
        .from("bookings")
        .select("id, booking_code")
        .eq("booking_code", bookingCode)
        .limit(1);

      if (error) {
        return NextResponse.json(
          { error: "BOOKING_SELECT_ERROR", message: error.message },
          { status: 500 }
        );
      }

      booking = rows?.[0] ?? null;
    }

    if (!booking?.id) {
      return NextResponse.json(
        { error: "BOOKING_NOT_FOUND", bookingId, bookingCode },
        { status: 404 }
      );
    }

    // IMPORTANT: Do NOT assume bookings.is_emergency exists.
    // Safe no-schema-change "signal": touch updated_at.
    const { error: upErr } = await supabase
      .from("bookings")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", booking.id);

    if (upErr) {
      return NextResponse.json(
        { error: "BOOKING_UPDATE_ERROR", message: upErr.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { ok: true, action: "emergency", bookingId: booking.id, bookingCode: booking.booking_code },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { error: "EMERGENCY_UNEXPECTED", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
