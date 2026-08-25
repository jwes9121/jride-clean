import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandFareBreakdown,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";
import {
  getErrandConfirmedRoute,
  type ErrandRoutePoint,
} from "@/lib/errand/confirmedRoute";

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

function routePointsFromBundle(bundle: any): ErrandRoutePoint[] | null {
  const booking = bundle.booking || {};
  const job = bundle.job || {};
  const stops = Array.isArray(bundle.stops) ? bundle.stops : [];

  const stage0Lat = num(booking.pickup_lat);
  const stage0Lng = num(booking.pickup_lng);
  const finalLat = num(job.final_lat);
  const finalLng = num(job.final_lng);

  if (stage0Lat == null || stage0Lng == null || finalLat == null || finalLng == null) {
    return null;
  }

  const points: ErrandRoutePoint[] = [
    {
      key: "stage0",
      label: text(booking.from_label) || "Stage 0",
      lat: stage0Lat,
      lng: stage0Lng,
    },
  ];

  for (const stop of stops) {
    const lat = num(stop?.lat);
    const lng = num(stop?.lng);
    if (lat == null || lng == null) return null;

    points.push({
      key: `stop-${Number(stop?.sequence || points.length)}`,
      label: text(stop?.location_label) || `Stop ${Number(stop?.sequence || points.length)}`,
      lat,
      lng,
    });
  }

  points.push({
    key: "final",
    label: text(job.final_label) || text(booking.to_label) || "Final destination",
    lat: finalLat,
    lng: finalLng,
  });

  return points;
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

      const points = routePointsFromBundle(bundle);
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

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        route,
        errand: bundle.ok
          ? {
              booking: bundle.booking,
              job: bundle.job,
              stops: bundle.stops,
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
