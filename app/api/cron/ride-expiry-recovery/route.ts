import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  type ExpiredRegularRideWindow,
  type PendingRegularRideReassignment,
  triggerExpiredRideReassignment,
} from "@/lib/ride-expiry-recovery";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function noStoreHeaders() {
  return {
    "Cache-Control":
      "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}

function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = text(process.env.CRON_SECRET);
  if (!secret) return false;
  return text(req.headers.get("authorization")) === `Bearer ${secret}`;
}

type SweepError = {
  bookingId: string;
  bookingCode: string | null;
  phase: "queue_claim" | "reassignment";
  error: string;
};

type PendingReassignmentRow = {
  id: string;
  booking_code: string | null;
  last_expired_driver_id: string | null;
  ride_reassignment_queued_at: string | null;
  ride_reassignment_next_attempt_at: string | null;
};

const REASSIGNMENT_RETRY_DELAY_MS = 60_000;

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: noStoreHeaders() }
    );
  }

  const generatedAt = new Date().toISOString();
  console.log("[ride-expiry-recovery] cron started", { generatedAt });

  try {
    const admin = supabaseAdmin();
    const expiryResult = await admin.rpc("expire_regular_ride_windows_v1", {
      p_now: generatedAt,
      p_limit: 200,
    });

    if (expiryResult.error) {
      console.error("[ride-expiry-recovery] expiry RPC failed", {
        generatedAt,
        code: expiryResult.error.code || null,
        message: expiryResult.error.message,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "RIDE_EXPIRY_SWEEP_FAILED",
          message: expiryResult.error.message,
          generatedAt,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const expiredRows = Array.isArray(expiryResult.data)
      ? (expiryResult.data as ExpiredRegularRideWindow[])
      : [];
    const errors: SweepError[] = [];
    let assignmentExpiredCount = 0;
    let fareResponseExpiredCount = 0;
    let reassignedCount = 0;
    let waitingForDriverCount = 0;
    let claimedReassignmentCount = 0;
    let claimRaceCount = 0;
    let resolvedElsewhereCount = 0;

    for (const row of expiredRows) {
      if (!row.needs_reassignment) {
        fareResponseExpiredCount += 1;
        console.log("[JRIDE_RIDE_PASSENGER_FARE_RESPONSE_EXPIRED]", {
          bookingId: row.booking_id,
          bookingCode: row.booking_code,
          previousStatus: row.previous_status,
          expiresAt: row.expires_at,
          outcome: "cancelled_no_driver_penalty",
        });
        continue;
      }

      assignmentExpiredCount += 1;
      console.log("[JRIDE_RIDE_ASSIGNMENT_EXPIRED]", {
        bookingId: row.booking_id,
        bookingCode: row.booking_code,
        previousStatus: row.previous_status,
        expiresAt: row.expires_at,
        expiredDriverId: row.expired_driver_id,
        reassignmentOutcome: "queued",
      });
    }

    const pendingResult = await admin
      .from("bookings")
      .select("id, booking_code, last_expired_driver_id, ride_reassignment_queued_at, ride_reassignment_next_attempt_at")
      .in("service_type", ["motorcycle", "tricycle"])
      .eq("status", "searching")
      .eq("ride_reassignment_pending", true)
      .lte("ride_reassignment_next_attempt_at", generatedAt)
      .is("assigned_driver_id", null)
      .is("driver_id", null)
      .not("last_expired_driver_id", "is", null)
      .not("ride_reassignment_queued_at", "is", null)
      .order("ride_reassignment_next_attempt_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(200);

    if (pendingResult.error) {
      console.error("[ride-expiry-recovery] pending queue read failed", {
        generatedAt,
        code: pendingResult.error.code || null,
        message: pendingResult.error.message,
      });

      return NextResponse.json(
        {
          ok: false,
          error: "RIDE_REASSIGNMENT_QUEUE_READ_FAILED",
          message: pendingResult.error.message,
          generatedAt,
          expiredCount: expiredRows.length,
          assignmentExpiredCount,
          fareResponseExpiredCount,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const pendingRows = Array.isArray(pendingResult.data)
      ? (pendingResult.data as PendingReassignmentRow[])
      : [];

    for (const row of pendingRows) {
      const queuedAt = text(row.ride_reassignment_queued_at);
      const currentNextAttemptAt = text(
        row.ride_reassignment_next_attempt_at
      );
      const nextAttemptAt = new Date(
        Date.now() + REASSIGNMENT_RETRY_DELAY_MS
      ).toISOString();

      if (!queuedAt || !currentNextAttemptAt) {
        errors.push({
          bookingId: text(row.id),
          bookingCode: text(row.booking_code) || null,
          phase: "queue_claim",
          error: "INVALID_REASSIGNMENT_QUEUE_MARKER",
        });
        continue;
      }

      const claimResult = await admin
        .from("bookings")
        .update({ ride_reassignment_next_attempt_at: nextAttemptAt })
        .eq("id", row.id)
        .eq("status", "searching")
        .eq("ride_reassignment_pending", true)
        .eq("last_expired_driver_id", row.last_expired_driver_id)
        .eq("ride_reassignment_queued_at", queuedAt)
        .eq("ride_reassignment_next_attempt_at", currentNextAttemptAt)
        .is("assigned_driver_id", null)
        .is("driver_id", null)
        .select("id")
        .limit(1);

      if (claimResult.error) {
        errors.push({
          bookingId: text(row.id),
          bookingCode: text(row.booking_code) || null,
          phase: "queue_claim",
          error: claimResult.error.message,
        });
        continue;
      }

      if (!claimResult.data?.[0]) {
        claimRaceCount += 1;
        continue;
      }

      claimedReassignmentCount += 1;
      const candidate: PendingRegularRideReassignment = {
        booking_id: row.id,
        booking_code: row.booking_code,
        expired_driver_id: row.last_expired_driver_id,
        reassignment_queued_at: queuedAt,
      };
      const reassignment = await triggerExpiredRideReassignment(req, candidate);

      if (reassignment.assigned) {
        reassignedCount += 1;
      } else if (reassignment.waitingForDriver) {
        waitingForDriverCount += 1;
      } else if (
        [
          "expiry_reassignment_no_longer_pending",
          "booking_assignment_lost_race",
        ].includes(reassignment.outcome)
      ) {
        resolvedElsewhereCount += 1;
      } else {
        errors.push({
          bookingId: text(row.id),
          bookingCode: text(row.booking_code) || null,
          phase: "reassignment",
          error: reassignment.outcome,
        });
      }

      console.log("[JRIDE_RIDE_REASSIGNMENT_ATTEMPT]", {
        bookingId: row.id,
        bookingCode: row.booking_code,
        expiredDriverId: row.last_expired_driver_id,
        queuedAt,
        nextAttemptAt,
        reassignmentStatus: reassignment.status,
        reassignmentOutcome: reassignment.outcome,
        replacementDriverId: reassignment.assignedDriverId,
      });
    }

    console.log("[ride-expiry-recovery] cron completed", {
      generatedAt,
      expiredCount: expiredRows.length,
      assignmentExpiredCount,
      fareResponseExpiredCount,
      pendingReassignmentCount: pendingRows.length,
      claimedReassignmentCount,
      claimRaceCount,
      resolvedElsewhereCount,
      reassignedCount,
      waitingForDriverCount,
      errorCount: errors.length,
    });

    return NextResponse.json(
      {
        ok: errors.length === 0,
        generatedAt,
        expiredCount: expiredRows.length,
        assignmentExpiredCount,
        fareResponseExpiredCount,
        pendingReassignmentCount: pendingRows.length,
        claimedReassignmentCount,
        claimRaceCount,
        resolvedElsewhereCount,
        reassignedCount,
        waitingForDriverCount,
        errors,
      },
      { status: errors.length > 0 ? 500 : 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    const message = text(error?.message || error) || "UNKNOWN_ERROR";
    console.error("[ride-expiry-recovery] unexpected failure", {
      generatedAt,
      message,
    });

    return NextResponse.json(
      {
        ok: false,
        error: "RIDE_EXPIRY_CRON_FAILED",
        message,
        generatedAt,
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
