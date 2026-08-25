import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";
import { getErrandConfirmedRoute } from "@/lib/errand/confirmedRoute";
import { buildErrandBillingRoutePoints } from "@/lib/errand/routePoints";

type DriverErrandActionBody = {
  action?: string;
  booking_id?: string;
  bookingId?: string;
  driver_id?: string;
  driverId?: string;
  task_description?: string;
  stops?: any[];
  final_destination_mode?: string;
  final_label?: string | null;
  final_lat?: number | string | null;
  final_lng?: number | string | null;
  is_pabili?: boolean;
  estimated_purchase_amount?: number | string | null;
  pabili_cash_received?: number | string | null;
  confirmed_cargo_weight_kg?: number | string | null;
  vehicle_requirement?: string | null;
  sequence?: number | string | null;
  receipt_photo_url?: string | null;
  purchase_total?: number | string | null;
  substitute_place_name?: string | null;
  substitute_location_label?: string | null;
  substitute_lat?: number | string | null;
  substitute_lng?: number | string | null;
  confirmation_method?: string | null;
  reason_code?: string | null;
  requested_additional_cash?: number | string | null;
  received_additional_cash?: number | string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function positiveSequence(value: unknown): number | null {
  const parsed = num(value);
  if (parsed == null || parsed < 1) return null;
  return Math.floor(parsed);
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function blockedStatus(error: string): number {
  if (error === "DRIVER_NOT_ASSIGNED") return 403;
  if (error === "BOOKING_NOT_FOUND" || error === "ERRAND_JOB_NOT_FOUND") return 404;
  if (error.includes("REQUIRED") || error.includes("INVALID")) return 400;
  return 409;
}

async function loadDriverBundle(bookingId: string, driverId: string) {
  const bundle = await loadErrandBundleByBookingId(bookingId);
  if (!bundle.ok) return bundle;

  const assignedDriverId = text(
    (bundle.booking as any).assigned_driver_id || (bundle.booking as any).driver_id
  );

  if (assignedDriverId !== driverId) {
    return { ok: false as const, error: "DRIVER_NOT_ASSIGNED" };
  }

  return bundle;
}

function cashTopupRoutePoints(bundle: any, sequence: number) {
  const booking = bundle?.booking || {};
  const stops = Array.isArray(bundle?.stops) ? bundle.stops : [];
  const stop = stops.find((row: any) => Number(row?.sequence) === sequence);

  const stopLat = num(stop?.lat);
  const stopLng = num(stop?.lng);
  const customerLat = num(booking?.pickup_lat);
  const customerLng = num(booking?.pickup_lng);

  if (
    !stop ||
    stopLat == null ||
    stopLng == null ||
    customerLat == null ||
    customerLng == null
  ) {
    return null;
  }

  const stopLabel = text(stop?.location_label) || `Stop ${sequence}`;
  const customerLabel = text(booking?.from_label) || "Customer";

  return [
    {
      key: `cash-topup-stop-${sequence}-out`,
      label: stopLabel,
      lat: stopLat,
      lng: stopLng,
    },
    {
      key: "cash-topup-customer",
      label: customerLabel,
      lat: customerLat,
      lng: customerLng,
    },
    {
      key: `cash-topup-stop-${sequence}-return`,
      label: stopLabel,
      lat: stopLat,
      lng: stopLng,
    },
  ];
}

export async function POST(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const body = (await req.json().catch(() => ({}))) as DriverErrandActionBody;
    const bookingId = text(body.booking_id || body.bookingId);
    const action = text(body.action).toLowerCase();

    if (!bookingId || !action) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ACTION_OR_BOOKING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const identity = await resolveDriverRequest(
      req,
      text(body.driver_id || body.driverId)
    );

    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    const driverId = identity.driverId;
    let rpcName = "";
    let rpcArgs: Record<string, unknown> = {};
    let route: Awaited<ReturnType<typeof getErrandConfirmedRoute>> = null;
    let settlement: any = null;

    if (action === "accept") {
      rpcName = "errand_driver_accept_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "arrive_stage0") {
      rpcName = "errand_driver_arrive_stage0_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "save_stage0_review") {
      rpcName = "errand_driver_save_stage0_review_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_task_description: text(body.task_description),
        p_stops: Array.isArray(body.stops) ? body.stops : [],
        p_final_destination_mode:
          text(body.final_destination_mode) || "return_to_customer",
        p_final_label: text(body.final_label) || null,
        p_final_lat: num(body.final_lat),
        p_final_lng: num(body.final_lng),
        p_is_pabili: body.is_pabili === true,
        p_estimated_purchase_amount: num(body.estimated_purchase_amount),
        p_pabili_cash_received: num(body.pabili_cash_received),
        p_confirmed_cargo_weight_kg: num(body.confirmed_cargo_weight_kg),
        p_vehicle_requirement: text(body.vehicle_requirement) || null,
      };
    } else if (action === "ready_for_customer_review") {
      const bundle = await loadDriverBundle(bookingId, driverId);
      if (!bundle.ok) {
        return NextResponse.json(
          { ok: false, error: bundle.error },
          { status: blockedStatus(bundle.error), headers: noStoreHeaders() }
        );
      }

      const points = buildErrandBillingRoutePoints(bundle);
      if (!points) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_ROUTE_PINS_INCOMPLETE",
            message: "Every confirmed stop and final destination must have a map pin.",
          },
          { status: 409, headers: noStoreHeaders() }
        );
      }

      route = await getErrandConfirmedRoute(points);
      if (!route) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_CONFIRMED_ROUTE_UNAVAILABLE",
            message: "Driving-road distance could not be calculated. The task was not sent for confirmation.",
          },
          { status: 503, headers: noStoreHeaders() }
        );
      }

      rpcName = "errand_driver_ready_for_review_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_route_distance_km: route.distanceKm,
        p_route_duration_seconds: route.durationSeconds,
        p_route_legs: route.legs,
      };
    } else if (action === "start_execution") {
      rpcName = "errand_driver_start_execution_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "arrive_stop") {
      const sequence = positiveSequence(body.sequence);
      if (sequence == null) {
        return NextResponse.json(
          { ok: false, error: "STOP_SEQUENCE_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }
      rpcName = "errand_driver_arrive_stop_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_sequence: sequence,
      };
    } else if (action === "complete_stop") {
      const sequence = positiveSequence(body.sequence);
      if (sequence == null) {
        return NextResponse.json(
          { ok: false, error: "STOP_SEQUENCE_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }
      rpcName = "errand_driver_complete_stop_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_sequence: sequence,
        p_receipt_photo_url: text(body.receipt_photo_url) || null,
        p_purchase_total: num(body.purchase_total),
      };
    } else if (action === "mark_stop_closed") {
      const sequence = positiveSequence(body.sequence);
      if (sequence == null) {
        return NextResponse.json(
          { ok: false, error: "STOP_SEQUENCE_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }
      rpcName = "errand_driver_mark_stop_closed_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_sequence: sequence,
      };
    } else if (action === "confirm_substitute") {
      const sequence = positiveSequence(body.sequence);
      const substituteLabel = text(body.substitute_location_label);
      const substituteLat = num(body.substitute_lat);
      const substituteLng = num(body.substitute_lng);

      if (
        sequence == null ||
        !substituteLabel ||
        substituteLat == null ||
        substituteLng == null
      ) {
        return NextResponse.json(
          { ok: false, error: "SUBSTITUTE_LOCATION_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }

      const bundle = await loadDriverBundle(bookingId, driverId);
      if (!bundle.ok) {
        return NextResponse.json(
          { ok: false, error: bundle.error },
          { status: blockedStatus(bundle.error), headers: noStoreHeaders() }
        );
      }

      const points = buildErrandBillingRoutePoints(bundle, {
        sequence,
        placeName: text(body.substitute_place_name) || null,
        locationLabel: substituteLabel,
        lat: substituteLat,
        lng: substituteLng,
      });

      if (!points) {
        return NextResponse.json(
          { ok: false, error: "ERRAND_SUBSTITUTE_ROUTE_PINS_INCOMPLETE" },
          { status: 409, headers: noStoreHeaders() }
        );
      }

      route = await getErrandConfirmedRoute(points);
      if (!route) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_SUBSTITUTE_ROUTE_UNAVAILABLE",
            message: "The substitute was not confirmed because routed-road distance is unavailable.",
          },
          { status: 503, headers: noStoreHeaders() }
        );
      }

      rpcName = "errand_driver_confirm_substitute_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_sequence: sequence,
        p_place_name: text(body.substitute_place_name) || null,
        p_location_label: substituteLabel,
        p_lat: substituteLat,
        p_lng: substituteLng,
        p_confirmation_method: text(body.confirmation_method) || "phone",
        p_route_distance_km: route.distanceKm,
        p_route_duration_seconds: route.durationSeconds,
        p_route_legs: route.legs,
      };
    } else if (action === "mark_stop_unfulfilled") {
      const sequence = positiveSequence(body.sequence);
      const reasonCode = text(body.reason_code).toLowerCase();
      if (sequence == null || !reasonCode) {
        return NextResponse.json(
          { ok: false, error: "STOP_SEQUENCE_AND_REASON_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }
      rpcName = "errand_driver_mark_stop_unfulfilled_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_sequence: sequence,
        p_reason_code: reasonCode,
      };
    } else if (action === "confirm_cash_topup_return") {
      const sequence = positiveSequence(body.sequence);
      const requestedCash = num(body.requested_additional_cash);
      if (sequence == null || requestedCash == null || requestedCash < 0) {
        return NextResponse.json(
          { ok: false, error: "CASH_TOPUP_SEQUENCE_AND_AMOUNT_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }

      const bundle = await loadDriverBundle(bookingId, driverId);
      if (!bundle.ok) {
        return NextResponse.json(
          { ok: false, error: bundle.error },
          { status: blockedStatus(bundle.error), headers: noStoreHeaders() }
        );
      }

      const points = cashTopupRoutePoints(bundle, sequence);
      if (!points) {
        return NextResponse.json(
          { ok: false, error: "CASH_TOPUP_ROUTE_PINS_INCOMPLETE" },
          { status: 409, headers: noStoreHeaders() }
        );
      }

      route = await getErrandConfirmedRoute(points);
      if (!route) {
        return NextResponse.json(
          {
            ok: false,
            error: "CASH_TOPUP_ROUTE_UNAVAILABLE",
            message: "The return for cash was not confirmed because routed-road distance is unavailable.",
          },
          { status: 503, headers: noStoreHeaders() }
        );
      }

      rpcName = "errand_driver_confirm_cash_topup_return_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_stop_sequence: sequence,
        p_requested_additional_cash: requestedCash,
        p_confirmation_method: text(body.confirmation_method) || "phone",
        p_adjustment_distance_km: route.distanceKm,
        p_adjustment_duration_seconds: route.durationSeconds,
        p_adjustment_route_legs: route.legs,
      };
    } else if (action === "arrive_cash_topup_customer") {
      rpcName = "errand_driver_arrive_cash_topup_customer_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "receive_cash_topup") {
      const receivedCash = num(body.received_additional_cash);
      if (receivedCash == null || receivedCash <= 0) {
        return NextResponse.json(
          { ok: false, error: "ADDITIONAL_CASH_RECEIVED_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }
      rpcName = "errand_driver_receive_cash_topup_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: driverId,
        p_received_additional_cash: receivedCash,
      };
    } else if (action === "return_to_stop_after_cash") {
      rpcName = "errand_driver_return_to_stop_after_cash_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "arrive_final") {
      rpcName = "errand_driver_arrive_final_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "complete_errand") {
      rpcName = "errand_driver_complete_handoff_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else if (action === "escalate_unreachable") {
      rpcName = "errand_driver_escalate_unreachable_v1";
      rpcArgs = { p_booking_id: bookingId, p_driver_id: driverId };
    } else {
      return NextResponse.json(
        { ok: false, error: "UNKNOWN_ERRAND_ACTION", action },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const { data, error } = await admin.rpc(rpcName, rpcArgs);
    if (error) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_ACTION_RPC_FAILED", message: error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const result = (data as any) || {};
    if (result.ok === false) {
      const err = text(result.error) || "ERRAND_ACTION_BLOCKED";
      return NextResponse.json(
        { ...result, ok: false },
        { status: blockedStatus(err), headers: noStoreHeaders() }
      );
    }

    if (action === "complete_errand") {
      const settled = await admin.rpc("settle_completed_errand_wallet_v1", {
        p_booking_id: bookingId,
        p_settled_by: "driver_errand_action",
      });

      if (settled.error) {
        return NextResponse.json(
          {
            ok: false,
            error: "ERRAND_SETTLEMENT_RPC_FAILED",
            message: settled.error.message,
            handoff: result,
          },
          { status: 500, headers: noStoreHeaders() }
        );
      }

      settlement = (settled.data as any) || {};
      if (settlement.ok === false) {
        return NextResponse.json(
          {
            ok: false,
            error: settlement.error || "ERRAND_SETTLEMENT_BLOCKED",
            handoff: result,
            settlement,
          },
          { status: 409, headers: noStoreHeaders() }
        );
      }
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        route,
        settlement,
        errand: bundle.ok
          ? {
              booking: bundle.booking,
              job: bundle.job,
              stops: bundle.stops,
              route_adjustments: bundle.routeAdjustments,
              fare: errandFareBreakdown(
                bundle.booking,
                bundle.job,
                bundle.settings
              ),
            }
          : null,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "ERRAND_DRIVER_ACTION_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
