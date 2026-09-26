import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import {
  evaluateTakeoutAutomaticDeliveryFare,
  TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION,
} from "@/lib/takeoutAutomaticDeliveryFare";
import { handleTakeoutPickupDistanceException } from "@/lib/takeoutPickupDistanceException";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED = new Set([
  "driver_accepted",
  "cash_collected",
  "rider_arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
  "cancelled",
]);

function json(status: number, payload: any) {
  return NextResponse.json(payload, { status });
}

function getAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !key) return null;
  return createAdminClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const configured = String(process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET || "").trim();
  if (!configured) return true;
  const got = String(req.headers.get("x-jride-driver-secret") || "").trim();
  return got.length > 0 && got === configured;
}

function normStatus(value: any) {
  const s = String(value || "").trim().toLowerCase();
  if (s === "assigned") return "driver_assigned";
  if (s === "accepted" || s === "driver_confirmed" || s === "accepted_by_driver") return "driver_accepted";
  if (s === "arrived_vendor" || s === "rider_at_vendor") return "rider_arrived_vendor";
  if (s === "pickedup") return "picked_up";
  if (s === "canceled") return "cancelled";
  return s;
}

function money(value: any): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100) / 100;
}

// JRIDE_TAKEOUT_CANONICAL_COMPLETION_PATH_V2
// Takeout vendor/customer statuses can progress on their own, but DB wallet triggers
// still require bookings.status to follow the canonical ride-safe chain before completed.
// This helper advances only takeout rows, only inside the takeout-status route, and never
// weakens database lifecycle guards.
async function ensureTakeoutCanonicalPathForCompletion(admin: any, order: any, driverId: string) {
  const bookingId = String(order?.id || "").trim();
  const assignedDriverId = String(order?.assigned_driver_id || order?.driver_id || driverId || "").trim();
  if (!bookingId || !assignedDriverId) {
    return { ok: false, error: "TAKEOUT_CANONICAL_DRIVER_MISSING", message: "Takeout completion requires assigned driver." };
  }

  const chain = ["requested", "assigned", "accepted", "fare_proposed", "ready", "on_the_way", "arrived", "on_trip"];
  const current = String(order?.status || "requested").trim().toLowerCase() || "requested";
  if (current === "completed") return { ok: true, skipped: true };

  let startIndex = chain.indexOf(current);
  if (startIndex < 0) startIndex = 0;

  for (let i = startIndex + 1; i < chain.length; i++) {
    const canonicalStatus = chain[i];
    const patch: any = {
      status: canonicalStatus,
      driver_id: assignedDriverId,
      assigned_driver_id: assignedDriverId,
    };

    if (["on_the_way", "arrived", "on_trip"].includes(canonicalStatus)) {
      patch.driver_status = canonicalStatus;
    }

    if (canonicalStatus === "fare_proposed") {
      const nowIso = new Date().toISOString();
      const feeExpiresIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const deliveryFee = Number(order?.takeout_delivery_fee || 0);
      patch.takeout_pricing_status = "customer_confirmed";
      patch.takeout_fee_proposed_at = nowIso;
      patch.takeout_fee_expires_at = feeExpiresIso;
      patch.passenger_fare_response = "accepted";
      if (Number.isFinite(deliveryFee) && deliveryFee > 0) {
        patch.proposed_fare = deliveryFee;
      }
    }

    const step = await admin
      .from("bookings")
      .update(patch)
      .eq("id", bookingId)
      .eq("service_type", "takeout")
      .select("id,status,driver_status,assigned_driver_id,driver_id")
      .single();

    if (step.error) {
      return {
        ok: false,
        error: "TAKEOUT_CANONICAL_STEP_FAILED",
        message: step.error.message,
        attempted_status: canonicalStatus,
      };
    }
  }

  return { ok: true, advanced_to: "on_trip" };
}

export async function POST(req: NextRequest) {
  if (!isDriverSecretAuthorized(req)) {
    return json(401, { ok: false, error: "UNAUTHORIZED" });
  }

  const admin = getAdmin();
  if (!admin) {
    return json(500, { ok: false, error: "SERVER_MISCONFIG" });
  }

  const body = await req.json().catch(() => ({} as any));
  const driverId = String(body?.driver_id || body?.driverId || "").trim();
  const orderId = String(body?.order_id || body?.orderId || body?.booking_id || body?.bookingId || body?.id || "").trim();
  const bookingCode = String(body?.booking_code || body?.bookingCode || body?.code || "").trim();
  const nextStatus = normStatus(body?.status || body?.vendor_status || body?.vendorStatus);
  const cashCollectedAmount = money(
    body?.cash_collected_amount ??
      body?.collected_amount ??
      body?.cashCollectedAmount
  );
  const cashCollectionClientVersion = String(
    body?.takeout_cash_collection_client_version ??
      body?.cash_collection_client_version ??
      ""
  ).trim();
  const strictCashSplitClient =
    cashCollectionClientVersion === "takeout_split_cash_v2";

  if (!driverId) return json(400, { ok: false, error: "driver_id_required" });
  if (!orderId && !bookingCode) return json(400, { ok: false, error: "order_id_or_booking_code_required" });
  if (!ALLOWED.has(nextStatus)) return json(400, { ok: false, error: "bad_status" });

  let q = admin
    .from("bookings")
    .select("id,booking_code,service_type,status,vendor_status,customer_status,driver_status,assigned_driver_id,driver_id,created_by_user_id,vendor_id,town,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,takeout_items_subtotal,takeout_total_payable,takeout_delivery_fee,takeout_service_fee,takeout_pricing_status,takeout_pricing_snapshot,takeout_cash_collection_required,takeout_route_plan,takeout_product_purchase_amount,takeout_cash_first_amount,takeout_pay_on_delivery_amount,takeout_cash_first_collected_amount,takeout_cash_first_collected_at,takeout_final_collected_amount,takeout_final_collected_at,takeout_driver_commission,takeout_company_revenue,takeout_driver_delivery_earnings,company_cut,driver_payout,pickup_distance_fee,takeout_fee_proposed_at,takeout_fee_expires_at,takeout_customer_confirmed_at,driver_accept_expires_at,takeout_driver_accept_expires_at,takeout_fee_proposal_expires_at,driver_fee_proposal_expires_at,last_expired_driver_id,takeout_auto_dispatch_exhausted,takeout_auto_dispatch_exhausted_at,vendor_driver_arrived_at,vendor_order_picked_at,completed_at,notes")
    .eq("service_type", "takeout")
    .eq("assigned_driver_id", driverId)
    .limit(1);

  q = orderId ? q.eq("id", orderId) : q.eq("booking_code", bookingCode);
  const existing = await q.maybeSingle();

  if (existing.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: existing.error.message });
  }
  if (!existing.data) {
    return json(404, { ok: false, error: "TAKEOUT_ORDER_NOT_FOUND" });
  }

  if (nextStatus === "cash_collected") {
    const expectedCashFirst = money(
      (existing.data as any).takeout_cash_first_amount
    );
    if (
      strictCashSplitClient &&
      expectedCashFirst != null &&
      expectedCashFirst > 0 &&
      (cashCollectedAmount == null ||
        Math.abs(cashCollectedAmount - expectedCashFirst) >= 0.01)
    ) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_CASH_FIRST_AMOUNT_MISMATCH",
        message:
          "Collect exactly the vendor purchase amount shown by JRide before continuing.",
        expected_amount: expectedCashFirst,
      });
    }
  }

  if (nextStatus === "completed") {
    const expectedFinal = money(
      (existing.data as any).takeout_pay_on_delivery_amount
    );
    if (
      strictCashSplitClient &&
      expectedFinal != null &&
      expectedFinal > 0 &&
      (cashCollectedAmount == null ||
        Math.abs(cashCollectedAmount - expectedFinal) >= 0.01)
    ) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_FINAL_PAYMENT_AMOUNT_MISMATCH",
        message:
          "Confirm the exact Pay on final delivery amount shown by JRide before completing.",
        expected_amount: expectedFinal,
      });
    }
  }

  const current = normStatus((existing.data as any).vendor_status || "requested");
  const canonicalStatus = normStatus((existing.data as any).status);
  if (["completed", "cancelled"].includes(current) || ["completed", "cancelled"].includes(canonicalStatus)) {
    return json(409, { ok: false, error: "TAKEOUT_ORDER_CLOSED" });
  }

  const postAcceptanceProgress = new Set([
    "cash_collected", "rider_arrived_vendor", "picked_up", "delivering", "completed",
  ]);
  if (
    postAcceptanceProgress.has(nextStatus) &&
    !(existing.data as any).takeout_customer_confirmed_at
  ) {
    return json(409, {
      ok: false,
      error: "TAKEOUT_FARE_NOT_CONFIRMED",
      message: "The passenger must confirm the delivery fee before this step.",
    });
  }

  const driverWorkflowStatus = normStatus((existing.data as any).driver_status);
  const vendorWorkflowStatus = normStatus((existing.data as any).vendor_status);
  const customerWorkflowStatus = normStatus((existing.data as any).customer_status);

  if (nextStatus === "rider_arrived_vendor") {
    const allowedArrivalStates = new Set(["driver_accepted", "cash_collected", "vendor_bound", "rider_arrived_vendor"]);
    if (!allowedArrivalStates.has(driverWorkflowStatus)) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ARRIVAL_STEP_INVALID",
        message: "The driver cannot mark arrival at the vendor from the current Takeout step. Refresh the current order.",
      });
    }
  }

  if (nextStatus === "picked_up") {
    const alreadyPickedUp =
      driverWorkflowStatus === "picked_up" &&
      vendorWorkflowStatus === "picked_up" &&
      customerWorkflowStatus === "picked_up";
    if (alreadyPickedUp) {
      return json(200, { ok: true, order: existing.data, already_picked_up: true });
    }

    const vendorReady = ["pickup_ready", "ready_for_pickup"].includes(vendorWorkflowStatus);
    if (!vendorReady) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_VENDOR_NOT_READY_FOR_PICKUP",
        message: "The vendor must mark the order Ready for pickup before the driver can mark it Picked up.",
      });
    }
    if (driverWorkflowStatus !== "rider_arrived_vendor") {
      return json(409, {
        ok: false,
        error: "TAKEOUT_DRIVER_NOT_AT_VENDOR",
        message: "Mark Arrived at vendor before marking this order Picked up.",
      });
    }
  }

  const isPrePickupProgress =
    nextStatus === "cash_collected" ||
    nextStatus === "rider_arrived_vendor" ||
    nextStatus === "picked_up";
  if (isPrePickupProgress) {
    const states = [current, driverWorkflowStatus, customerWorkflowStatus];
    if (states.some(value => ["delivering", "completed", "cancelled"].includes(value)) ||
      (nextStatus !== "picked_up" && states.includes("picked_up")) ||
      (nextStatus === "cash_collected" && states.includes("rider_arrived_vendor"))) {
      return json(409, { ok: false, error: "TAKEOUT_STEP_CHANGED", message: "This order has moved to a later step. Refresh the current trip." });
    }
  }

  let automaticTakeoutFare: any = null;
  let acceptExpiryRaw = "";
  let acceptExpiryMs = NaN;

  if (nextStatus === "driver_accepted") {
    const currentDriverStatus = normStatus((existing.data as any).driver_status);
    const existingSnapshot =
      (existing.data as any).takeout_pricing_snapshot &&
      typeof (existing.data as any).takeout_pricing_snapshot === "object"
        ? (existing.data as any).takeout_pricing_snapshot
        : {};
    const alreadyAutomatic =
      String(existingSnapshot?.version || "").trim() ===
      TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION;

    if (
      currentDriverStatus === "driver_accepted" &&
      (existing.data as any).takeout_customer_confirmed_at &&
      alreadyAutomatic
    ) {
      return json(200, {
        ok: true,
        order: existing.data,
        already_accepted: true,
        automatic_fare: true,
        takeout_automatic_delivery_fare: true,
        pricing_version: TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION,
      });
    }

    if (currentDriverStatus === "driver_accepted") {
      // Manual (>3 km) pricing retries must never restart the five-minute
      // proposal clock.
      const proposalDeadline = Date.parse(
        String((existing.data as any).driver_fee_proposal_expires_at || "")
      );
      if (Number.isFinite(proposalDeadline) && proposalDeadline <= Date.now()) {
        return json(409, {
          ok: false,
          error: "TAKEOUT_FEE_PROPOSAL_EXPIRED",
          message: "The delivery fee deadline passed. This order will be cancelled.",
        });
      }
      return json(200, {
        ok: true,
        order: existing.data,
        already_accepted: true,
        automatic_fare: false,
      });
    }

    if (currentDriverStatus !== "driver_assigned") {
      return json(409, { ok: false, error: "TAKEOUT_STEP_CHANGED" });
    }

    acceptExpiryRaw = String(
      (existing.data as any).driver_accept_expires_at ||
        (existing.data as any).takeout_driver_accept_expires_at ||
        ""
    ).trim();
    acceptExpiryMs = acceptExpiryRaw
      ? new Date(acceptExpiryRaw).getTime()
      : NaN;

    if (!Number.isFinite(acceptExpiryMs)) {
      return json(409, { ok: false, error: "TAKEOUT_ASSIGNMENT_WINDOW_MISSING" });
    }
    if (acceptExpiryMs <= Date.now()) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ASSIGNMENT_EXPIRED",
        message: "This takeout assignment already expired. Please wait for dispatch to reassign.",
      });
    }

    try {
      automaticTakeoutFare = await evaluateTakeoutAutomaticDeliveryFare({
        booking: existing.data,
        driverId,
        supabase: admin,
      });
    } catch (error: any) {
      console.warn(
        "[TAKEOUT_AUTOMATIC_FARE_EVALUATION_FAILED]",
        JSON.stringify({
          booking_code: (existing.data as any).booking_code || null,
          driver_id: driverId,
          error: String(error?.message ?? error),
        })
      );
      return json(503, {
        ok: false,
        error: "TAKEOUT_AUTOMATIC_FARE_UNAVAILABLE",
        message: "Automatic Takeout pricing is temporarily unavailable. Please retry acceptance.",
      });
    }

    if (automaticTakeoutFare?.outcome === "invalid") {
      return json(409, {
        ok: false,
        error: "TAKEOUT_AUTOMATIC_FARE_INVALID",
        message: "This Takeout order is missing required pricing data. Refresh the order.",
        reason: automaticTakeoutFare?.reason || null,
      });
    }

    if (automaticTakeoutFare?.outcome === "retry") {
      return json(503, {
        ok: false,
        error: "TAKEOUT_AUTOMATIC_FARE_UNAVAILABLE",
        message: "Automatic Takeout pricing is temporarily unavailable. Please retry acceptance.",
        reason: automaticTakeoutFare?.reason || null,
      });
    }

    // Routing/elevation calls can consume the remaining accept window.
    if (acceptExpiryMs <= Date.now()) {
      return json(409, {
        ok: false,
        error: "TAKEOUT_ASSIGNMENT_EXPIRED",
        message: "This takeout assignment expired while pricing was being checked.",
      });
    }

    if (
      automaticTakeoutFare?.outcome === "automatic" &&
      automaticTakeoutFare?.pickupBreakdown
        ?.pickup_distance_exception_required === true
    ) {
      const exceptionResult =
        await handleTakeoutPickupDistanceException({
          req,
          serviceSupabase: admin,
          order: existing.data,
          driverId,
          pricingSnapshot: automaticTakeoutFare.snapshot,
          actualDistanceKm:
            automaticTakeoutFare.pickupBreakdown.pickup_distance_km,
          cappedPickupFee:
            automaticTakeoutFare.pickupBreakdown.pickup_excess_fee,
          source: "automatic",
        });

      return json(409, {
        ok: false,
        error: "TAKEOUT_PICKUP_DISTANCE_EXCEPTION",
        message: exceptionResult.reassigned
          ? "Pickup is outside JRide's normal 10 km approach range. Do not collect customer cash. JRide released this assignment and is checking another eligible driver."
          : "Pickup is outside JRide's normal 10 km approach range. Do not collect customer cash. This order was released for JRide dispatch review.",
        pickup_distance_km: exceptionResult.actualDistanceKm,
        normal_pickup_fee_cap: exceptionResult.cappedPickupFee,
        assignment_released: exceptionResult.released,
        reassigned: exceptionResult.reassigned,
        dispatch_review_required:
          exceptionResult.dispatchReviewRequired,
      });
    }

    if (automaticTakeoutFare?.outcome === "automatic") {
      const automaticResult = await admin.rpc(
        "confirm_takeout_automatic_short_trip_v1",
        {
          p_booking_id: (existing.data as any).id,
          p_driver_id: driverId,
          p_expected_driver_accept_expires_at: acceptExpiryRaw,
          p_expected_subtotal: automaticTakeoutFare.subtotal,
          p_delivery_fee: automaticTakeoutFare.deliveryFee,
          p_service_fee: automaticTakeoutFare.serviceFee,
          p_total_payable: automaticTakeoutFare.totalPayable,
          p_cash_required: automaticTakeoutFare.cashRequired,
          p_route_plan: automaticTakeoutFare.routePlan,
          p_pricing_snapshot: automaticTakeoutFare.snapshot,
        }
      );

      if (automaticResult.error) {
        return json(500, {
          ok: false,
          error: "TAKEOUT_AUTOMATIC_FARE_CONFIRM_FAILED",
          message: automaticResult.error.message,
        });
      }

      const result = automaticResult.data as any;
      if (!result?.ok || !result?.order) {
        return json(409, {
          ok: false,
          error: result?.error || "TAKEOUT_STEP_CHANGED",
          message: "The Takeout order changed while automatic pricing was being confirmed. Refresh the current order.",
        });
      }

      return json(200, {
        ok: true,
        order: result.order,
        automatic_fare: true,
        takeout_automatic_delivery_fare: true,
        pricing_version: TAKEOUT_AUTOMATIC_DELIVERY_FARE_VERSION,
        route_plan: automaticTakeoutFare.routePlan,
        cash_collection_required: automaticTakeoutFare.cashRequired,
      });
    }
  }

  if (nextStatus === "completed") {
    const canonical = await ensureTakeoutCanonicalPathForCompletion(admin, existing.data, driverId);
    if (!canonical.ok) {
      return json(500, canonical);
    }
  }

  const statusNowIso = new Date().toISOString();
  const existingPricingSnapshot =
    (existing.data as any).takeout_pricing_snapshot &&
    typeof (existing.data as any).takeout_pricing_snapshot === "object"
      ? (existing.data as any).takeout_pricing_snapshot
      : {};
  const patch: any = {
    vendor_status: nextStatus,
    customer_status: nextStatus,
    driver_status: nextStatus,
    // JRIDE_TAKEOUT_WORKFLOW_FRESHNESS_V2
    updated_at: statusNowIso,
  };

  if (nextStatus === "cash_collected" && cashCollectedAmount != null) {
    patch.takeout_cash_first_collected_amount = cashCollectedAmount;
    patch.takeout_cash_first_collected_at = statusNowIso;
    const expectedCashFirstAudit = money(
      (existing.data as any).takeout_cash_first_amount
    );
    patch.takeout_pricing_snapshot = {
      ...existingPricingSnapshot,
      takeout_cash_first_collected_amount: cashCollectedAmount,
      takeout_cash_first_collected_at: statusNowIso,
      takeout_cash_first_expected_amount: expectedCashFirstAudit,
      takeout_cash_first_amount_match:
        expectedCashFirstAudit == null
          ? null
          : Math.abs(cashCollectedAmount - expectedCashFirstAudit) < 0.01,
      takeout_cash_first_collection_client_version:
        cashCollectionClientVersion || null,
    };
  }

  if (nextStatus === "completed" && cashCollectedAmount != null) {
    patch.takeout_final_collected_amount = cashCollectedAmount;
    patch.takeout_final_collected_at = statusNowIso;
    const expectedFinalAudit = money(
      (existing.data as any).takeout_pay_on_delivery_amount
    );
    patch.takeout_pricing_snapshot = {
      ...(patch.takeout_pricing_snapshot || existingPricingSnapshot),
      takeout_final_collected_amount: cashCollectedAmount,
      takeout_final_collected_at: statusNowIso,
      takeout_final_expected_amount: expectedFinalAudit,
      takeout_final_amount_match:
        expectedFinalAudit == null
          ? null
          : Math.abs(cashCollectedAmount - expectedFinalAudit) < 0.01,
      takeout_final_collection_client_version:
        cashCollectionClientVersion || null,
    };
  }

  if (nextStatus === "rider_arrived_vendor") {
    patch.vendor_driver_arrived_at =
      (existing.data as any).vendor_driver_arrived_at || statusNowIso;
  }

  if (nextStatus === "picked_up") {
    patch.vendor_order_picked_at =
      (existing.data as any).vendor_order_picked_at || statusNowIso;
  }

  // Cash collection and arrival are driver steps, not a reversal of vendor
  // readiness. Keep the vendor/customer ready signal until actual pickup.
  // The actual picked_up transition must replace Ready with Picked up.
  const preserveVendorReady =
    nextStatus === "cash_collected" || nextStatus === "rider_arrived_vendor";
  if (preserveVendorReady && current === "pickup_ready") {
    delete patch.vendor_status;
    delete patch.customer_status;
  }

  if (nextStatus === "driver_accepted") {
    // Only >3 km Takeout deliveries reach the existing Proposed Fare path.
    // <=3 km automatic fares returned above after the atomic confirmation RPC.
    const feeProposalExpiresIso = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    patch.driver_status = "driver_accepted";
    patch.takeout_pricing_status = "pricing_pending";
    patch.takeout_fee_proposal_expires_at = feeProposalExpiresIso;
    patch.driver_fee_proposal_expires_at = feeProposalExpiresIso;
  }

    if (nextStatus === "completed") {
    const nowIso = new Date().toISOString();
    patch.status = "completed";
    patch.vendor_status = "completed";
    patch.customer_status = "completed";
    patch.driver_status = "completed";
    patch.takeout_pricing_status = "completed";
    patch.driver_accept_expires_at = null;
    patch.takeout_driver_accept_expires_at = null;
    patch.takeout_fee_expires_at = null;
    patch.takeout_fee_proposal_expires_at = null;
    patch.driver_fee_proposal_expires_at = null;
    patch.completed_at = nowIso;
  }

  if (nextStatus === "cancelled") {
    const nowIso = new Date().toISOString();
    patch.status = "cancelled";
    patch.vendor_status = "cancelled";
    patch.customer_status = "cancelled";
    patch.driver_status = "cancelled";
    patch.takeout_pricing_status = "cancelled";
    patch.driver_accept_expires_at = null;
    patch.takeout_driver_accept_expires_at = null;
    patch.takeout_fee_proposal_expires_at = null;
    patch.driver_fee_proposal_expires_at = null;
    patch.takeout_fee_expires_at = null;
    
  }

  let updateQuery = admin
    .from("bookings")
    .update(patch)
    .eq("id", (existing.data as any).id)
    .eq("service_type", "takeout")
    .eq("assigned_driver_id", driverId);

  if (isPrePickupProgress) {
    // Reject stale writes, including Ready, pickup, cancellation, or reassignment
    // arriving between our read and write. Do not touch the completion helper.
    for (const field of ["status", "vendor_status", "customer_status", "driver_status", "driver_id"]) {
      const value = (existing.data as any)[field];
      updateQuery = value == null ? updateQuery.is(field, null) : updateQuery.eq(field, value);
    }
  }
  if (nextStatus === "driver_accepted") {
    // Another accept, cancellation or reassignment between read and write
    // cannot extend an expired window or restore an old assignment.
    updateQuery = updateQuery
      .in("status", ["assigned", "accepted"])
      .eq("driver_status", "driver_assigned")
      .eq("driver_accept_expires_at", (existing.data as any).driver_accept_expires_at)
      .gt("driver_accept_expires_at", new Date().toISOString())
      .is("takeout_fee_proposed_at", null)
      .is("takeout_delivery_fee", null);
  }
  const up = await updateQuery
    .select("id,booking_code,service_type,status,vendor_status,customer_status,driver_status,assigned_driver_id,driver_id,takeout_total_payable,takeout_delivery_fee,takeout_service_fee,takeout_product_purchase_amount,takeout_cash_first_amount,takeout_pay_on_delivery_amount,takeout_cash_first_collected_amount,takeout_cash_first_collected_at,takeout_final_collected_amount,takeout_final_collected_at,takeout_driver_commission,takeout_company_revenue,takeout_driver_delivery_earnings,company_cut,driver_payout,pickup_distance_fee,takeout_pricing_status,takeout_fee_proposed_at,takeout_fee_expires_at,driver_accept_expires_at,takeout_driver_accept_expires_at,takeout_fee_proposal_expires_at,driver_fee_proposal_expires_at,vendor_driver_arrived_at,vendor_order_picked_at,completed_at,updated_at")
    .maybeSingle();

  if (up.error) {
    return json(500, { ok: false, error: "DB_ERROR", message: up.error.message });
  }
  if (!up.data) {
    return json(409, { ok: false, error: "TAKEOUT_STEP_CHANGED", message: "The order changed while saving. Refresh the current trip and try again." });
  }

  const wallet_deduction = {
    ok: true,
    owner: "database_trigger",
    reason: "takeout wallet deduction is handled by the existing database trigger",
  };

  return json(200, {
    ok: true,
    order: up.data,
    wallet_deduction,
    automatic_fare: false,
  });
}
