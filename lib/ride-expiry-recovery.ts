import type { NextRequest } from "next/server";

export type ExpiredRegularRideWindow = {
  booking_id: string;
  booking_code: string | null;
  previous_status: "assigned" | "accepted" | "fare_proposed";
  new_status: "searching" | "cancelled";
  expired_driver_id: string | null;
  expires_at: string;
  needs_reassignment: boolean;
};

export type RideReassignmentResult = {
  attempted: boolean;
  assigned: boolean;
  waitingForDriver: boolean;
  status: number | null;
  assignedDriverId: string | null;
  outcome: string;
};

export type PendingRegularRideReassignment = {
  booking_id: string;
  booking_code: string | null;
  expired_driver_id: string | null;
  reassignment_queued_at: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export async function triggerExpiredRideReassignment(
  req: NextRequest,
  row: PendingRegularRideReassignment
): Promise<RideReassignmentResult> {
  const bookingId = text(row.booking_id);
  const expiredDriverId = text(row.expired_driver_id);
  const reassignmentQueuedAt = text(row.reassignment_queued_at);

  if (!bookingId || !expiredDriverId || !reassignmentQueuedAt) {
    return {
      attempted: false,
      assigned: false,
      waitingForDriver: false,
      status: null,
      assignedDriverId: null,
      outcome: "MISSING_REASSIGNMENT_INPUT",
    };
  }

  try {
    const response = await fetch(
      new URL("/api/dispatch/assign", req.nextUrl.origin),
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          bookingId,
          excludeDriverId: expiredDriverId,
          autoReassignReason: "assignment_expired_cron_retry",
          requireReassignmentPending: true,
          expectedReassignmentQueuedAt: reassignmentQueuedAt,
        }),
        cache: "no-store",
      }
    );

    const payload = await response.json().catch(() => null);
    const assignedDriverId =
      text(payload?.assigned_driver_id || payload?.driver_id) || null;
    const waitingForDriver =
      response.status === 404 &&
      ["no_local_drivers", "no_drivers_even_in_emergency"].includes(
        text(payload?.error)
      );

    return {
      attempted: true,
      assigned: response.ok && !!assignedDriverId,
      waitingForDriver,
      status: response.status,
      assignedDriverId,
      outcome:
        text(payload?.error || payload?.reason) ||
        (assignedDriverId ? "ASSIGNED" : `HTTP_${response.status}`),
    };
  } catch (error: any) {
    return {
      attempted: true,
      assigned: false,
      waitingForDriver: false,
      status: null,
      assignedDriverId: null,
      outcome: text(error?.message || error) || "REASSIGNMENT_REQUEST_FAILED",
    };
  }
}
