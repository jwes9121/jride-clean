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

async function runAssignOrReassign(bookingId: string, action: DispatchActionName) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase.rpc(
    "assign_nearest_driver_v2",
    {
      booking_id: bookingId,
    }
  );

  if (error) {
    console.error("ASSIGN_NEAREST_DB_ERROR", error);
    throw new Error(error.message || "Assign nearest driver failed.");
  }

  return data;
}

async function runStatusUpdate(bookingId: string, status: string) {
  const supabase = supabaseAdmin();

  const { data, error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId)
    .select("id, booking_code, status")
    .maybeSingle();

  if (error) {
    console.error("BOOKING_STATUS_DB_ERROR", error);
    throw new Error(error.message || "Status update failed.");
  }

  return data;
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

    let result: unknown = null;

    switch (action) {
      case "assign":
      case "reassign": {
        result = await runAssignOrReassign(bookingId, action);
        break;
      }

      case "on_the_way": {
        result = await runStatusUpdate(bookingId, "on_the_way");
        break;
      }

      case "start_trip": {
        result = await runStatusUpdate(bookingId, "in_progress");
        break;
      }

      case "drop_off": {
        result = await runStatusUpdate(bookingId, "completed");
        break;
      }

      case "cancel": {
        result = await runStatusUpdate(bookingId, "cancelled");
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
        result,
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
