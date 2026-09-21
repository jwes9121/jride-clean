import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetOwner,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 100): string {
  return String(value ?? "").trim().slice(0, max);
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetOwner(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = clean(body?.booking_id, 80);
  const vehicleId = clean(body?.vehicle_id, 80);
  const driverId = clean(body?.driver_id, 80);

  if (!bookingId || !vehicleId || !driverId) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_ASSIGNMENT_INPUT_REQUIRED",
        message: "Choose both an eligible vehicle and driver.",
      },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_owner_assign_v1", {
    p_booking_id: bookingId,
    p_owner_user_id: auth.user.id,
    p_vehicle_id: vehicleId,
    p_driver_id: driverId,
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    const message = String(result.error.message || "");
    let userMessage = "The vehicle and driver could not be assigned.";
    if (message.includes("RESERVATION_PAYMENT_REQUIRED")) {
      userMessage = "Confirm the minimum reservation payment before assigning a vehicle and driver.";
    } else if (message.includes("VEHICLE_SCHEDULE_CONFLICT")) {
      userMessage = "That vehicle already has an overlapping confirmed JFleet booking.";
    } else if (message.includes("DRIVER_SCHEDULE_CONFLICT")) {
      userMessage = "That driver already has an overlapping confirmed JFleet booking.";
    } else if (message.includes("VEHICLE_NOT_ELIGIBLE")) {
      userMessage = "That vehicle is not active and document-verified.";
    } else if (message.includes("DRIVER_NOT_ELIGIBLE")) {
      userMessage = "That driver is not active and document-verified.";
    }

    return NextResponse.json(
      { ok: false, code: "JFLEET_ASSIGNMENT_REJECTED", message: userMessage },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
