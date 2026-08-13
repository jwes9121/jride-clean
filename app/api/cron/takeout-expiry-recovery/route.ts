import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  logTakeoutFeeProposalExpired,
  recordTakeoutExpiryLifecycleEvent,
  resetExpiredTakeoutDriverAcceptance,
  resetExpiredTakeoutFeeProposal,
  triggerTakeoutFeeProposalReassign,
} from "@/lib/takeout-expiry-recovery";

export const dynamic = "force-dynamic";

function noStore() {
  return { "Cache-Control": "no-store, no-cache", Pragma: "no-cache" };
}

// Vercel automatically sends Authorization: Bearer <CRON_SECRET> when
// invoking a scheduled route, per Vercel's documented cron-security
// pattern (https://vercel.com/docs/cron-jobs/manage-cron-jobs). Missing
// or unset CRON_SECRET fails closed (never authorizes) rather than
// skipping the check.
function isAuthorizedCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET || "";
  if (!secret) return false;
  const authHeader = req.headers.get("authorization") || "";
  return authHeader === `Bearer ${secret}`;
}

type CandidateRow = {
  id: string;
  booking_code: string | null;
  status: string | null;
  assigned_driver_id: string | null;
  driver_fee_proposal_expires_at: string | null;
  town: string | null;
};

type SweepError = {
  bookingId: string;
  bookingCode: string | null;
  error: string;
};

export async function GET(req: NextRequest) {
  if (!isAuthorizedCronRequest(req)) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED" },
      { status: 401, headers: noStore() }
    );
  }

  const supabase = supabaseAdmin();
  const nowIso = new Date().toISOString();

  console.log("[takeout-expiry-recovery] cron started", {
    generatedAt: nowIso,
  });

  const errors: SweepError[] = [];
  let resetCount = 0;
  let reassignedCount = 0;
  let driverAcceptResetCount = 0;
  let driverAcceptReassignedCount = 0;

  const {
    data: driverAcceptCandidateRows,
    error: driverAcceptScanError,
  } = await supabase
    .from("bookings")
    .select(
      "id,booking_code,status,assigned_driver_id,driver_accept_expires_at,town,driver_status"
    )
    .eq("service_type", "takeout")
    .eq("status", "assigned")
    .eq("driver_status", "driver_assigned")
    .not("assigned_driver_id", "is", null)
    .not("driver_accept_expires_at", "is", null)
    .lte("driver_accept_expires_at", nowIso)
    .is("takeout_customer_confirmed_at", null)
    .is("takeout_fee_proposed_at", null)
    .is("takeout_delivery_fee", null)
    .limit(50);

  if (driverAcceptScanError) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_DRIVER_ACCEPT_EXPIRY_SCAN_FAILED",
        message: driverAcceptScanError.message,
      },
      { status: 500, headers: noStore() }
    );
  }

  const driverAcceptRows =
    (driverAcceptCandidateRows ?? []) as any[];

  for (const row of driverAcceptRows) {
    const bookingId = String(row?.id || "");
    const bookingCode =
      row?.booking_code ? String(row.booking_code) : null;
    const expiredDriverId =
      String(row?.assigned_driver_id || "");

    if (!bookingId || !expiredDriverId) continue;

    try {
      const resetResult =
        await resetExpiredTakeoutDriverAcceptance(
          supabase,
          {
            bookingId,
            bookingCode,
            expiredDriverId,
          }
        );

      if (resetResult.error) {
        errors.push({
          bookingId,
          bookingCode,
          error: resetResult.error,
        });
        continue;
      }

      if (!resetResult.didReset || !resetResult.bookingId) {
        continue;
      }

      driverAcceptResetCount += 1;
      resetCount += 1;

      const reassignResult =
        await triggerTakeoutFeeProposalReassign(
          req,
          resetResult.bookingId,
          expiredDriverId,
          "driver_accept_expired_cron_sweep"
        );

      const reassignmentSuccess =
        !!reassignResult.payload?.assigned;

      if (reassignmentSuccess) {
        driverAcceptReassignedCount += 1;
        reassignedCount += 1;
      }

      await recordTakeoutExpiryLifecycleEvent(
        supabase,
        {
          bookingId: resetResult.bookingId,
          bookingCode: resetResult.bookingCode,
          expiredDriverId,
          townRaw: row?.town ? String(row.town) : null,
          reason: "driver_accept_expired_cron_sweep",
          reassignmentAttempted: reassignResult.attempted,
          reassignmentSuccess,
          dispatchStatus: reassignResult.status,
          statusBefore: String(row?.status || "unknown"),
          expiryType: "driver_accept_window",
        }
      );

      console.log(
        "[JRIDE_TAKEOUT_DRIVER_ACCEPT_EXPIRED]",
        JSON.stringify({
          bookingCode: resetResult.bookingCode,
          expiredDriverId,
          expiredAt: row?.driver_accept_expires_at || null,
          reassigned: reassignmentSuccess,
          dispatchStatus: reassignResult.status,
          dispatchPayload: reassignResult.payload,
          reason: "driver_accept_expired_cron_sweep",
        })
      );
    } catch (err: any) {
      errors.push({
        bookingId,
        bookingCode,
        error: String(err?.message ?? err),
      });
    }
  }

  const { data: candidateRows, error: scanError } = await supabase
    .from("bookings")
    .select(
      "id,booking_code,status,assigned_driver_id,driver_fee_proposal_expires_at,town"
    )
    .eq("service_type", "takeout")
    .in("status", ["assigned", "accepted"])
    .not("assigned_driver_id", "is", null)
    .not("driver_fee_proposal_expires_at", "is", null)
    .lte("driver_fee_proposal_expires_at", nowIso)
    .is("takeout_customer_confirmed_at", null)
    .is("takeout_fee_proposed_at", null)
    .is("takeout_delivery_fee", null)
    .limit(50);

  if (scanError) {
    return NextResponse.json(
      {
        ok: false,
        error: "TAKEOUT_EXPIRY_SCAN_FAILED",
        message: scanError.message,
      },
      { status: 500, headers: noStore() }
    );
  }

  const rows = (candidateRows ?? []) as CandidateRow[];

  for (const row of rows) {
    const bookingId = String(row.id || "");
    const bookingCode = row.booking_code ? String(row.booking_code) : null;
    const expiredDriverId = String(row.assigned_driver_id || "");

    if (!bookingId || !expiredDriverId) continue;

    try {
      const resetResult = await resetExpiredTakeoutFeeProposal(supabase, {
        bookingId,
        bookingCode,
        expiredDriverId,
      });

      if (resetResult.error) {
        errors.push({ bookingId, bookingCode, error: resetResult.error });
        continue;
      }

      if (!resetResult.didReset || !resetResult.bookingId) continue;

      resetCount += 1;

      const reassignResult = await triggerTakeoutFeeProposalReassign(
        req,
        resetResult.bookingId,
        expiredDriverId,
        "fee_proposal_expired_cron_sweep"
      );
      const reassignmentSuccess = !!reassignResult.payload?.assigned;

      if (reassignmentSuccess) reassignedCount += 1;

      await recordTakeoutExpiryLifecycleEvent(supabase, {
        bookingId: resetResult.bookingId,
        bookingCode: resetResult.bookingCode,
        expiredDriverId,
        townRaw: row.town ? String(row.town) : null,
        reason: "fee_proposal_expired_cron_sweep",
        reassignmentAttempted: reassignResult.attempted,
        reassignmentSuccess,
        dispatchStatus: reassignResult.status,
        statusBefore: String(row.status || "unknown"),
      });

      logTakeoutFeeProposalExpired({
        bookingCode: resetResult.bookingCode,
        expiredDriverId,
        expiredAt: row.driver_fee_proposal_expires_at,
        reset: true,
        reassigned: reassignmentSuccess,
        newDriverId: null,
        dispatchPayload: reassignResult.payload,
        reason: "fee_proposal_expired_cron_sweep",
      });
    } catch (err: any) {
      errors.push({
        bookingId,
        bookingCode,
        error: String(err?.message ?? err),
      });
    }
  }

  console.log("[takeout-expiry-recovery] cron completed", {
    generatedAt: nowIso,
    expiredCandidates: rows.length,
    resetBookings: resetCount,
    reassigned: reassignedCount,
    errors: errors.length,
  });

  return NextResponse.json(
    {
      ok: true,
      generatedAt: nowIso,
      expiredCandidates:
        driverAcceptRows.length + rows.length,
      driverAcceptExpiredCandidates:
        driverAcceptRows.length,
      driverAcceptReset: driverAcceptResetCount,
      driverAcceptReassigned:
        driverAcceptReassignedCount,
      feeProposalExpiredCandidates: rows.length,
      resetBookings: resetCount,
      reassigned: reassignedCount,
      errors,
    },
    { status: 200, headers: noStore() }
  );
}