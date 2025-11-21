import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const bookingId = url.searchParams.get("bookingId");

    if (!bookingId) {
      return NextResponse.json(
        {
          error: "MISSING_BOOKING_ID",
          message: "bookingId is required.",
        },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin();

    // Select * so we do NOT depend on specific column names here.
    const { data, error } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();

    if (error) {
      console.error("BOOKING_MAP_DB_ERROR", error);
      return NextResponse.json(
        {
          error: "BOOKING_MAP_DB_ERROR",
          message: error.message,
        },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error: "BOOKING_NOT_FOUND",
          message: "Booking not found.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ booking: data });
  } catch (err: any) {
    console.error("BOOKING_MAP_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "BOOKING_MAP_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while loading booking map.",
      },
      { status: 500 }
    );
  }
}
