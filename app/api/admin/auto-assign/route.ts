import { NextRequest, NextResponse } from "next/server";
import { POST as assignBooking } from "@/app/api/dispatch/assign/route";
import { requireStaff } from "@/lib/auth/requireStaff";

type CanonicalAssignmentResponse = {
  ok?: boolean;
  booking_id?: string;
  booking_code?: string;
  driver_id?: string;
  assigned_driver_id?: string;
  status?: string;
  assigned_at?: string | null;
  error?: string;
  [key: string]: unknown;
};

export async function POST(req: NextRequest) {
  const access = await requireStaff(["admin", "dispatcher"]);

  if (!access.ok) {
    return NextResponse.json(
      { success: false, ok: false, error: access.error },
      { status: access.status }
    );
  }

  // Keep LiveTrips on the same coordinate validation, Mapbox isolation,
  // driver eligibility, and compare-and-swap assignment path as every
  // other regular Ride assignment.
  const canonicalResponse = await assignBooking(req);
  const payload = (await canonicalResponse
    .json()
    .catch(() => ({ ok: false, error: "invalid_assignment_response" }))) as CanonicalAssignmentResponse;

  if (!canonicalResponse.ok || payload.ok !== true) {
    return NextResponse.json(
      { ...payload, success: false },
      { status: canonicalResponse.status }
    );
  }

  const chosenDriverId =
    String(payload.assigned_driver_id || payload.driver_id || "").trim() || null;

  return NextResponse.json(
    {
      ...payload,
      success: true,
      chosen_driver_id: chosenDriverId,
      booking: {
        id: payload.booking_id || null,
        booking_code: payload.booking_code || null,
        status: payload.status || "assigned",
        driver_id: payload.driver_id || chosenDriverId,
        assigned_driver_id: payload.assigned_driver_id || chosenDriverId,
        assigned_at: payload.assigned_at || null,
      },
    },
    { status: canonicalResponse.status }
  );
}
