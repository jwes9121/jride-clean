import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
    },
  }
);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingId = body.bookingId as string | undefined;

    if (!bookingId) {
      return NextResponse.json(
        { error: "Missing bookingId in body." },
        { status: 400 }
      );
    }

    const {
      data: booking,
      error: bookingError,
    } = await supabaseAdmin
      .from("bookings")
      .select("id, status")
      .eq("id", bookingId)
      .maybeSingle();

    if (bookingError) {
      console.error("ASSIGN_API_BOOKING_ERROR", bookingError);
      return NextResponse.json(
        { error: "Failed to load booking.", details: bookingError.message },
        { status: 500 }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { error: "Booking not found." },
        { status: 404 }
      );
    }

    const status = (booking.status ?? "").toLowerCase();
    if (status === "completed" || status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot assign driver for completed/cancelled trip." },
        { status: 400 }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("bookings")
      .update({
        status: "on_trip",
        updated_at: new Date().toISOString(),
      })
      .eq("id", bookingId);

    if (updateError) {
      console.error("ASSIGN_API_UPDATE_ERROR", updateError);
      return NextResponse.json(
        { error: "Failed to update booking.", details: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error("ASSIGN_API_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "Unexpected error in assign-nearest handler.",
        details: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
