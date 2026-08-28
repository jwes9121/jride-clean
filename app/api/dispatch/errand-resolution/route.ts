import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadErrandBundleByBookingId } from "@/lib/errand/server";
import { getErrandConfirmedRoute } from "@/lib/errand/confirmedRoute";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function allowedRole(role: unknown): boolean {
  return role === "admin" || role === "dispatcher";
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function jsonError(error: string, status = 400, extra: Record<string, unknown> = {}) {
  return NextResponse.json(
    { ok: false, error, ...extra },
    { status, headers: noStoreHeaders() }
  );
}

function chooseRecovery(bundle: any, requested: string) {
  const booking = bundle?.booking || {};
  const job = bundle?.job || {};
  const stops = Array.isArray(bundle?.stops) ? bundle.stops : [];
  const requestedType = text(requested).toLowerCase();

  let resolutionType = requestedType;
  if (!resolutionType) {
    if (text(job?.final_destination_mode).toLowerCase() === "different_address") {
      resolutionType = "return_to_customer";
    } else if (job?.is_pabili === true) {
      resolutionType = "custody_required";
    } else {
      resolutionType = "return_to_source";
    }
  }

  if (resolutionType === "return_to_customer") {
    const lat = num(booking?.pickup_lat);
    const lng = num(booking?.pickup_lng);
    const label = text(booking?.from_label) || "Customer meeting point";
    if (lat == null || lng == null) return { ok: false as const, error: "CUSTOMER_RETURN_PIN_REQUIRED" };
    return {
      ok: true as const,
      resolutionType,
      targetKind: "customer",
      targetLabel: label,
      targetLat: lat,
      targetLng: lng,
      targetStopSequence: null as number | null,
    };
  }

  if (resolutionType === "return_to_source") {
    if (job?.is_pabili === true) {
      return { ok: false as const, error: "PABILI_RETURN_TO_MERCHANT_NOT_AUTOMATIC" };
    }

    const completed = stops
      .filter((stop: any) => text(stop?.status).toLowerCase() === "completed")
      .sort((a: any, b: any) => Number(b?.sequence || 0) - Number(a?.sequence || 0));
    const source = completed[0];
    if (!source) return { ok: false as const, error: "COMPLETED_SOURCE_STOP_REQUIRED" };

    const lat = num(source?.lat);
    const lng = num(source?.lng);
    const label = text(source?.location_label) || text(source?.place_name) || `Task Stop ${source?.sequence || 1}`;
    if (lat == null || lng == null) return { ok: false as const, error: "SOURCE_RETURN_PIN_REQUIRED" };

    return {
      ok: true as const,
      resolutionType,
      targetKind: "source",
      targetLabel: label,
      targetLat: lat,
      targetLng: lng,
      targetStopSequence: Math.max(1, Math.floor(Number(source?.sequence || 1))),
    };
  }

  return { ok: false as const, error: "JRIDE_CUSTODY_REQUIRED" };
}

export async function GET() {
  try {
    const session = await auth();
    const role = (session?.user as any)?.role;
    if (!allowedRole(role)) return jsonError("FORBIDDEN", 403);

    const admin = supabaseAdmin();
    const { data: jobs, error } = await admin
      .from("errand_jobs")
      .select("*")
      .in("errand_stage", [
        "unreachable_escalated",
        "returning_after_unreachable",
        "waiting_at_unreachable_return",
      ])
      .order("updated_at", { ascending: false });

    if (error) return jsonError("ERRAND_ESCALATION_QUEUE_READ_FAILED", 500, { message: error.message });
    if (!jobs?.length) {
      return NextResponse.json({ ok: true, rows: [] }, { headers: noStoreHeaders() });
    }

    const ids = jobs.map((job: any) => text(job?.booking_id)).filter(Boolean);
    const { data: bookings, error: bookingError } = await admin
      .from("bookings")
      .select("id,booking_code,status,service_type,passenger_name,town,from_label,to_label,pickup_lat,pickup_lng,dropoff_lat,dropoff_lng,driver_id,assigned_driver_id,total_errand_fare,distance_fare,waiting_fee,updated_at")
      .in("id", ids);

    if (bookingError) return jsonError("ERRAND_ESCALATION_BOOKING_READ_FAILED", 500, { message: bookingError.message });

    const bookingMap = new Map((bookings || []).map((row: any) => [text(row.id), row]));
    const rows = await Promise.all(
      jobs.map(async (job: any) => {
        const booking = bookingMap.get(text(job.booking_id)) || {};
        let recommendedResolution = "";
        let recommendedLabel = "";

        if (text(job.errand_stage) === "unreachable_escalated") {
          if (text(job.final_destination_mode).toLowerCase() === "different_address") {
            recommendedResolution = "return_to_customer";
            recommendedLabel = "RETURN ITEM TO CUSTOMER";
          } else if (job.is_pabili === true) {
            recommendedResolution = "custody_required";
            recommendedLabel = "JRIDE CUSTODY REQUIRED";
          } else {
            recommendedResolution = "return_to_source";
            recommendedLabel = "RETURN ITEM TO SOURCE";
          }
        } else {
          recommendedResolution = text(job.escalation_resolution_type);
          recommendedLabel =
            recommendedResolution === "return_to_customer"
              ? "RETURN ITEM TO CUSTOMER"
              : "RETURN ITEM TO SOURCE";
        }

        return {
          booking_id: text(booking.id || job.booking_id),
          booking_code: text(booking.booking_code),
          booking_status: text(booking.status),
          errand_stage: text(job.errand_stage),
          passenger_name: text(booking.passenger_name),
          town: text(booking.town),
          is_pabili: job.is_pabili === true,
          final_destination_mode: text(job.final_destination_mode),
          final_label: text(job.final_label),
          total_errand_fare: Number(booking.total_errand_fare || 0),
          distance_fare: Number(booking.distance_fare || 0),
          waiting_fee: Number(booking.waiting_fee || 0),
          unreachable_escalated_at: job.unreachable_escalated_at || null,
          resolution_type: text(job.escalation_resolution_type) || null,
          resolution_status: text(job.escalation_resolution_status) || null,
          return_target_kind: text(job.escalation_return_target_kind) || null,
          return_target_label: text(job.escalation_return_target_label) || null,
          return_distance_km: job.escalation_return_distance_km == null ? null : Number(job.escalation_return_distance_km),
          recommended_resolution: recommendedResolution,
          recommended_label: recommendedLabel,
        };
      })
    );

    return NextResponse.json({ ok: true, rows }, { headers: noStoreHeaders() });
  } catch (error: any) {
    return jsonError("ERRAND_ESCALATION_QUEUE_UNEXPECTED_ERROR", 500, {
      message: String(error?.message || error),
    });
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth();
    const role = (session?.user as any)?.role;
    if (!allowedRole(role)) return jsonError("FORBIDDEN", 403);

    const body: any = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);
    const action = text(body?.action).toLowerCase();
    const requestedResolution = text(body?.resolution_type).toLowerCase();

    if (!bookingId || action !== "start_return") {
      return jsonError("BOOKING_ID_AND_START_RETURN_REQUIRED", 400);
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);
    if (!bundle.ok) return jsonError(bundle.error, 404);

    const booking: any = bundle.booking;
    const job: any = bundle.job;
    if (text(booking?.status).toLowerCase() !== "on_trip") {
      return jsonError("ERRAND_ESCALATION_RETURN_STATUS_INVALID", 409, { status: booking?.status });
    }
    if (text(job?.errand_stage).toLowerCase() !== "unreachable_escalated") {
      return jsonError("ERRAND_NOT_UNREACHABLE_ESCALATED", 409, { errand_stage: job?.errand_stage });
    }

    const recovery = chooseRecovery(bundle, requestedResolution);
    if (!recovery.ok) {
      return jsonError(recovery.error, recovery.error === "JRIDE_CUSTODY_REQUIRED" ? 409 : 400);
    }

    const startLat = num(job?.final_lat ?? booking?.dropoff_lat);
    const startLng = num(job?.final_lng ?? booking?.dropoff_lng);
    const startLabel = text(job?.final_label || booking?.to_label) || "Failed handoff location";
    if (startLat == null || startLng == null) {
      return jsonError("FAILED_HANDOFF_PIN_REQUIRED", 409);
    }

    const route = await getErrandConfirmedRoute([
      { key: "failed-handoff", label: startLabel, lat: startLat, lng: startLng },
      {
        key: `recovery-${recovery.targetKind}`,
        label: recovery.targetLabel,
        lat: recovery.targetLat,
        lng: recovery.targetLng,
      },
    ]);

    if (!route || route.distanceKm <= 0) {
      return jsonError("ESCALATION_RETURN_ROUTE_UNAVAILABLE", 503);
    }

    const admin = supabaseAdmin();
    const dispatcherName = text((session?.user as any)?.name || (session?.user as any)?.email || "dispatch");
    const { data, error } = await admin.rpc("errand_dispatch_start_unreachable_return_v1", {
      p_booking_id: bookingId,
      p_resolution_type: recovery.resolutionType,
      p_target_kind: recovery.targetKind,
      p_target_label: recovery.targetLabel,
      p_target_lat: recovery.targetLat,
      p_target_lng: recovery.targetLng,
      p_target_stop_sequence: recovery.targetStopSequence,
      p_return_distance_km: route.distanceKm,
      p_return_duration_seconds: route.durationSeconds,
      p_return_route_legs: route.legs,
      p_resolved_by: dispatcherName,
    });

    if (error) return jsonError("ERRAND_ESCALATION_RETURN_RPC_FAILED", 500, { message: error.message });
    const result: any = data || {};
    if (result.ok === false) return jsonError(text(result.error) || "ERRAND_ESCALATION_RETURN_BLOCKED", 409, result);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        route,
        recommended_label:
          recovery.resolutionType === "return_to_customer"
            ? "RETURN ITEM TO CUSTOMER"
            : "RETURN ITEM TO SOURCE",
      },
      { headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return jsonError("ERRAND_ESCALATION_RETURN_UNEXPECTED_ERROR", 500, {
      message: String(error?.message || error),
    });
  }
}
