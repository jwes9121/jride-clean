import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function assignmentGuardResponse(
  message: unknown,
  extra: Record<string, unknown>
) {
  const raw = String(message ?? "");

  if (raw.includes("DRIVER_ROSTER_INELIGIBLE:")) {
    return NextResponse.json(
      {
        success: false,
        code: "DRIVER_ROSTER_INELIGIBLE",
        error: "driver_roster_ineligible",
        message: "Driver is not active on the JRide roster.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_LOCKED:")) {
    return NextResponse.json(
      {
        success: false,
        code: "DRIVER_WALLET_LOCKED",
        error: "driver_wallet_locked",
        message: "Driver wallet is locked.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_BELOW_MINIMUM:")) {
    return NextResponse.json(
      {
        success: false,
        code: "DRIVER_WALLET_BELOW_MINIMUM",
        error: "driver_wallet_below_minimum",
        message: "Driver wallet balance is below the minimum required for new bookings.",
        ...extra,
      },
      { status: 409 }
    );
  }

  if (raw.includes("DRIVER_WALLET_NOT_FOUND:")) {
    return NextResponse.json(
      {
        success: false,
        code: "DRIVER_WALLET_NOT_FOUND",
        error: "driver_not_found",
        message: "Driver record was not found.",
        ...extra,
      },
      { status: 404 }
    );
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { booking_id, driver_id } = body as {
      booking_id: string;
      driver_id: string;
    };

    if (!booking_id || !driver_id) {
      return NextResponse.json(
        { success: false, error: "Missing booking_id or driver_id" },
        { status: 400 }
      );
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const { data, error } = await supabase
      .from("bookings")
      .update({
        assigned_driver_id: driver_id,
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", booking_id)
      .select("id, booking_code, status, assigned_driver_id")
      .single();

    if (error) {
      console.error("MANUAL_ASSIGN_DB_ERROR", error);

      const guardResponse = assignmentGuardResponse(
        error.message,
        { booking_id, driver_id }
      );

      if (guardResponse) {
        return guardResponse;
      }

      return NextResponse.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { success: true, booking: data },
      { status: 200 }
    );
  } catch (err: any) {
    console.error("MANUAL_ASSIGN_UNEXPECTED_ERROR", err);
    return NextResponse.json(
      { success: false, error: "Unexpected server error" },
      { status: 500 }
    );
  }
}
