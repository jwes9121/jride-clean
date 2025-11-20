import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const adminClient = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: { persistSession: false },
  }
);

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const bookingCode = body?.bookingCode as string | undefined;
    const bookingId = body?.bookingId as string | undefined;

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        {
          error: "MISSING_IDENTIFIER",
          message: "bookingCode (or bookingId) is required",
        },
        { status: 400 }
      );
    }

    const column = bookingCode ? "booking_code" : "id";
    const value = bookingCode ?? bookingId!;
    console.log("COMPLETE_TRIP_API_START", { column, value });

    const { data, error } = await adminClient
      .from("bookings")
      .update({ status: "completed" })
      .eq(column, value)
      .select("id, booking_code, status");

    if (error) {
      console.error("COMPLETE_TRIP_DB_ERROR", error);
      return NextResponse.json(
        { error: "COMPLETE_TRIP_DB_ERROR", message: error.message },
        { status: 500 }
      );
    }

    if (!data || data.length === 0) {
      console.warn("COMPLETE_TRIP_NOT_FOUND", { column, value });
      return NextResponse.json(
        {
          error: "COMPLETE_TRIP_NOT_FOUND",
          message: "Booking not found for completion",
        },
        { status: 404 }
      );
    }

    const booking = data[0];
    console.log("COMPLETE_TRIP_API_OK", booking);

    return NextResponse.json({ ok: true, booking });
  } catch (err: any) {
    console.error("COMPLETE_TRIP_API_CATCH", err);
    return NextResponse.json(
      {
        error: "COMPLETE_TRIP_API_CATCH",
        message: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
