import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { bookingId, action } = body;

    if (!bookingId || !action) {
      return NextResponse.json(
        { error: "MISSING_FIELDS", message: "bookingId and action required" },
        { status: 400 }
      );
    }

    const supabase = supabaseAdmin(); // FIX: call supabaseAdmin()

    let updates: any = {};

    switch (action) {
      case "assign":
        updates.status = "assigned";
        break;
      case "on_the_way":
        updates.status = "on_the_way";
        break;
      case "start_trip":
        updates.status = "on_trip";
        break;
      case "drop_off":
        updates.status = "completed";
        break;
      default:
        return NextResponse.json(
          { error: "INVALID_ACTION", message: `Invalid action: ${action}` },
          { status: 400 }
        );
    }

    // UPDATE BOOKING
    const { data, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", bookingId)
      .select("*")
      .single();

    if (error) {
      console.error("UPDATE_BOOKING_ERROR:", error);
      return NextResponse.json(
        { error: "DB_ERROR_UPDATE", message: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, data });
  } catch (err: any) {
    console.error("DISPATCH_ACTION_FATAL:", err);
    return NextResponse.json(
      { error: "SERVER_ERROR", message: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
