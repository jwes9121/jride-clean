import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ---- Status Mapping ----

function driverStatusForBookingStatus(status: string) {
  switch (status) {
    case "assigned":
      return "assigned";
    case "accepted":
      return "accepted";
    case "on_the_way":
      return "on_the_way";
    case "arrived":
      return "arrived";
    case "on_trip":
      return "on_trip";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

function customerStatusForBookingStatus(status: string) {
  switch (status) {
    case "assigned":
      return "driver_assigned";
    case "accepted":
      return "driver_accepted";
    case "on_the_way":
      return "driver_on_the_way";
    case "arrived":
      return "driver_arrived";
    case "on_trip":
      return "trip_started";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}

// ---- Handler ----

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const bookingCode = body.bookingCode;
    const target = body.status;

    if (!bookingCode || !target) {
      return NextResponse.json(
        { ok: false, error: "Missing bookingCode or status" },
        { status: 400 }
      );
    }

    // Admin secret validation
    const headerSecret =
      req.headers.get("x-jride-admin-secret") ||
      req.headers.get("x-admin-secret");

    if (!headerSecret || headerSecret !== process.env.JRIDE_ADMIN_SECRET) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Fetch booking
    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("booking_code", bookingCode)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json(
        { ok: false, error: "Booking not found" },
        { status: 404 }
      );
    }

    const patch: any = {
      status: target,
      updated_at: new Date().toISOString(),
    };

    const ds = driverStatusForBookingStatus(target);
    if (ds) patch.driver_status = ds;

    const cs = customerStatusForBookingStatus(target);
    if (cs) patch.customer_status = cs;

    const { error: updateError } = await supabase
      .from("bookings")
      .update(patch)
      .eq("id", booking.id);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: updateError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      booking_id: booking.id,
      booking_code: bookingCode,
      new_status: target,
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err.message },
      { status: 500 }
    );
  }
}
