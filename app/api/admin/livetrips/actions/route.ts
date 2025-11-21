import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DispatchActionName =
  | "assign"
  | "reassign"
  | "on_the_way"
  | "start_trip"
  | "drop_off"
  | "cancel";

type RequestBody = {
  action: DispatchActionName;
  bookingId: string;
};

const BOOKING_FIELDS = `
  id,
  booking_code,
  status,
  assigned_driver_id,
  from_label,
  to_label,
  pickup_lat,
  pickup_lng,
  dropoff_lat,
  dropoff_lng,
  created_at
`;

async function fetchBookingById(bookingId: string) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("bookings")
    .select(BOOKING_FIELDS)
    .eq("id", bookingId)
    .maybeSingle();

  if (error) {
    console.error("DISPATCH_FETCH_BOOKING_ERROR", error);
    throw new Error(error.message || "Failed to fetch booking after action.");
  }

  return data;
}

async function runAssignOrReassign(bookingId: string, action: DispatchActionName) {
  const supabase = supabaseAdmin();

  // Use your existing assign_nearest_driver_v2 RPC
  const { error } = await supabase.rpc("assign_nearest_driver_v2", {
    booking_id: bookingId,
  });

  if (error) {
    console.error("ASSIGN_NEAREST_DB_ERROR", error);
    throw new Error(error.message || "Assign nearest driver failed.");
  }

  // After RPC, fetch updated booking
  const booking = await fetchBookingById(bookingId);
  return booking;
}

async function runStatusUpdate(bookingId: string, status: string) {
  const supabase = supabaseAdmin();

  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId);

  if (error) {
    console.error("BOOKING_STATUS_DB_ERROR", error);
    throw new Error(error.message || "Status update failed.");
  }

  const booking = await fetchBookingById(bookingId);
  return booking;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as RequestBody;

    if (!body?.action || !body?.bookingId) {
      return NextResponse.json(
        {
          error: "INVALID_PAYLOAD",
          message: "Missing action or bookingId.",
        },
        { status: 400 }
      );
    }

    const { action, bookingId } = body;

    let updatedBooking: unknown = null;

    switch (action) {
      case "assign":
      case "reassign": {
        updatedBooking = await runAssignOrReassign(bookingId, action);
        break;
      }

      case "on_the_way": {
        updatedBooking = await runStatusUpdate(bookingId, "on_the_way");
        break;
      }

      case "start_trip": {
        updatedBooking = await runStatusUpdate(bookingId, "in_progress");
        break;
      }

      case "drop_off": {
        updatedBooking = await runStatusUpdate(bookingId, "completed");
        break;
      }

      case "cancel": {
        updatedBooking = await runStatusUpdate(bookingId, "cancelled");
        break;
      }

      default: {
        return NextResponse.json(
          {
            error: "UNKNOWN_ACTION",
            message: `Unsupported action: ${action}`,
          },
          { status: 400 }
        );
      }
    }

    return NextResponse.json(
      {
        ok: true,
        action,
        bookingId,
        booking: updatedBooking,
      },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("DISPATCH_ACTION_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      {
        error: "DISPATCH_ACTION_UNEXPECTED_ERROR",
        message: err?.message ?? "Unexpected error while performing action.",
      },
      { status: 500 }
    );
  }
}
