import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  jfleetFeatureFlagEnabled,
  requireJfleetDriver,
} from "@/lib/jfleet/server";

export const dynamic = "force-dynamic";

function clean(value: unknown, max = 180): string {
  return String(value ?? "").trim().slice(0, max);
}

function numeric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(req: Request) {
  const headers = { "Cache-Control": "no-store, max-age=0" };

  if (!jfleetFeatureFlagEnabled()) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_NOT_ENABLED", message: "JFleet is not enabled yet." },
      { status: 503, headers }
    );
  }

  const auth = await requireJfleetDriver(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, code: auth.code, message: auth.message },
      { status: auth.status, headers }
    );
  }

  const body = await req.json().catch(() => ({}));
  const bookingId = clean(body?.booking_id, 80);
  const lat = numeric(body?.lat);
  const lng = numeric(body?.lng);
  const accuracy = numeric(body?.accuracy_m);
  const heading = numeric(body?.heading_deg);
  const speed = numeric(body?.speed_mps);
  const deviceId =
    clean(body?.device_id, 180) ||
    clean(req.headers.get("x-device-id"), 180) ||
    null;
  const capturedRaw = clean(body?.captured_at, 80);
  const capturedAt = capturedRaw ? new Date(capturedRaw) : new Date();

  if (
    !bookingId ||
    lat === null ||
    lng === null ||
    !Number.isFinite(capturedAt.getTime())
  ) {
    return NextResponse.json(
      { ok: false, code: "JFLEET_LOCATION_INPUT_INVALID", message: "Location data is incomplete." },
      { status: 400, headers }
    );
  }

  const admin = supabaseAdmin({ noStore: true });
  const result = await admin.rpc("jfleet_driver_location_security_v1", {
    p_driver_id: auth.driver.id,
    p_booking_id: bookingId,
    p_lat: lat,
    p_lng: lng,
    p_accuracy_m: accuracy,
    p_heading_deg: heading,
    p_speed_mps: speed,
    p_device_id: deviceId,
    p_captured_at: capturedAt.toISOString(),
    p_now: new Date().toISOString(),
  });

  if (result.error) {
    return NextResponse.json(
      {
        ok: false,
        code: "JFLEET_LOCATION_REJECTED",
        message: String(result.error.message || "").includes("ACTIVE_DRIVER_BOOKING")
          ? "Location tracking is allowed only for your assigned active JFleet trip."
          : String(result.error.message || "").includes("SECURITY_ROUTE_NOT_BOUND")
            ? "This confirmed JFleet booking does not have an approved route bound to it."
            : "This JFleet location update could not be recorded.",
      },
      { status: 409, headers }
    );
  }

  return NextResponse.json(result.data, { status: 200, headers });
}
