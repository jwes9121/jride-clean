import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolvePassengerBookingIdentity } from "@/lib/passenger/bookingIdentity";

type ErrandStopInput = {
  place_name?: string | null;
  location_label?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
  instructions?: string | null;
};

type ErrandBookBody = {
  stage0_label?: string;
  stage0_lat?: number | string | null;
  stage0_lng?: number | string | null;
  task_description?: string;
  stops?: ErrandStopInput[];
  final_destination_mode?: "return_to_customer" | "different_address";
  final_label?: string | null;
  final_lat?: number | string | null;
  final_lng?: number | string | null;
  is_pabili?: boolean;
  estimated_purchase_amount?: number | string | null;
  estimated_cargo_weight_kg?: number | string | null;
  vehicle_requirement?: "motorcycle" | "tricycle" | "either";
  accompanied?: boolean;
};

function text(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function featureEnabled(): boolean {
  const raw = text(process.env.JRIDE_ERRAND_BOOKING_ENABLED).toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function envAny(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) return String(value).trim();
  }
  return "";
}

function getMapboxToken(): string {
  return envAny([
    "MAPBOX_ACCESS_TOKEN",
    "MAPBOX_TOKEN",
    "NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN",
    "NEXT_PUBLIC_MAPBOX_TOKEN",
  ]);
}

async function resolveStage0Town(lng: number, lat: number): Promise<string> {
  const token = getMapboxToken();
  if (!token) {
    throw new Error("ERRAND_STAGE0_TOWN_VALIDATION_UNAVAILABLE");
  }

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    `${lng},${lat}.json` +
    `?types=place&limit=1&access_token=${encodeURIComponent(token)}`;

  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error("ERRAND_STAGE0_TOWN_VALIDATION_UNAVAILABLE");
  }

  const json: any = await response.json().catch(() => ({}));
  const features = Array.isArray(json?.features) ? json.features : [];
  const place = features.find(
    (feature: any) =>
      Array.isArray(feature?.place_type) && feature.place_type.includes("place")
  );
  const town = text(place?.text);

  if (!town) {
    throw new Error("ERRAND_STAGE0_TOWN_VALIDATION_UNAVAILABLE");
  }

  return town;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function bookingCodeNow(): string {
  const date = new Date();
  const stamp =
    date.getFullYear().toString() +
    pad2(date.getMonth() + 1) +
    pad2(date.getDate()) +
    pad2(date.getHours()) +
    pad2(date.getMinutes()) +
    pad2(date.getSeconds());
  const random = Math.floor(1000 + Math.random() * 9000);
  return `JR-ERR-${stamp}-${random}`;
}

export async function POST(req: Request) {
  try {
    if (!featureEnabled()) {
      return NextResponse.json(
        {
          ok: false,
          code: "ERRAND_BOOKING_NOT_ENABLED",
          message: "Errand booking is not enabled yet.",
        },
        { status: 503 }
      );
    }

    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401 }
      );
    }

    const supabase = createClient();
    const { data: authData, error: authError } = await supabase.auth.getUser(accessToken);
    const userId = text(authData?.user?.id);

    if (authError || !userId) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Invalid passenger session." },
        { status: 401 }
      );
    }

    const admin = supabaseAdmin();
    const verification = await admin
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    if (verification.error) {
      return NextResponse.json(
        {
          ok: false,
          code: "VERIFICATION_CHECK_FAILED",
          message: verification.error.message,
        },
        { status: 500 }
      );
    }

    if (text((verification.data as any)?.status).toLowerCase() !== "approved_admin") {
      return NextResponse.json(
        {
          ok: false,
          code: "ERRAND_REQUIRES_VERIFIED_PASSENGER",
          message: "Errand is available only to fully verified passengers.",
        },
        { status: 403 }
      );
    }

    const identity = await resolvePassengerBookingIdentity(admin, userId);
    if (!identity.name) {
      return NextResponse.json(
        {
          ok: false,
          code: "PASSENGER_NAME_REQUIRED",
          message: "Update your passenger profile before booking an Errand.",
        },
        { status: 409 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as ErrandBookBody;

    if (body.accompanied === true) {
      return NextResponse.json(
        {
          ok: false,
          code: "ACCOMPANIED_ERRAND_NOT_ENABLED",
          message:
            "Accompanied Errand is defined but not enabled until its LGU ride-fare integration is implemented.",
        },
        { status: 409 }
      );
    }

    const stage0Label = text(body.stage0_label);
    const stage0Lat = num(body.stage0_lat);
    const stage0Lng = num(body.stage0_lng);
    const taskDescription = text(body.task_description);
    const stops = Array.isArray(body.stops) ? body.stops : [];
    const finalMode = body.final_destination_mode || "return_to_customer";
    const finalLabel = text(body.final_label) || null;
    const finalLat = num(body.final_lat);
    const finalLng = num(body.final_lng);
    const estimatedPurchaseAmount = num(body.estimated_purchase_amount);
    const estimatedCargoWeightKg = num(body.estimated_cargo_weight_kg);
    const vehicleRequirement = text(body.vehicle_requirement || "either").toLowerCase();

    if (!stage0Label || stage0Lat == null || stage0Lng == null) {
      return NextResponse.json(
        { ok: false, code: "STAGE0_LOCATION_REQUIRED" },
        { status: 400 }
      );
    }

    if (taskDescription.length < 3) {
      return NextResponse.json(
        { ok: false, code: "TASK_DESCRIPTION_REQUIRED" },
        { status: 400 }
      );
    }

    if (stops.length < 1) {
      return NextResponse.json(
        { ok: false, code: "AT_LEAST_ONE_STOP_REQUIRED" },
        { status: 400 }
      );
    }

    if (!stops.every((stop) => text(stop?.location_label).length >= 2)) {
      return NextResponse.json(
        { ok: false, code: "STOP_LOCATION_REQUIRED" },
        { status: 400 }
      );
    }

    if (finalMode === "different_address" && (!finalLabel || finalLat == null || finalLng == null)) {
      return NextResponse.json(
        { ok: false, code: "FINAL_DESTINATION_REQUIRED" },
        { status: 400 }
      );
    }

    if (!["motorcycle", "tricycle", "either"].includes(vehicleRequirement)) {
      return NextResponse.json(
        { ok: false, code: "INVALID_VEHICLE_REQUIREMENT" },
        { status: 400 }
      );
    }

    if (estimatedCargoWeightKg != null && estimatedCargoWeightKg < 0) {
      return NextResponse.json(
        { ok: false, code: "INVALID_CARGO_WEIGHT" },
        { status: 400 }
      );
    }

    let stage0Town: string;
    try {
      stage0Town = await resolveStage0Town(stage0Lng, stage0Lat);
    } catch {
      return NextResponse.json(
        {
          ok: false,
          code: "ERRAND_STAGE0_TOWN_VALIDATION_UNAVAILABLE",
          message: "The Stage 0 town could not be validated from the map pin.",
        },
        { status: 503 }
      );
    }

    const bookingCode = bookingCodeNow();
    const normalizedStops = stops.map((stop) => ({
      place_name: text(stop.place_name) || null,
      location_label: text(stop.location_label),
      lat: num(stop.lat),
      lng: num(stop.lng),
      instructions: text(stop.instructions) || null,
    }));

    const { data, error } = await admin.rpc("create_errand_booking_v1", {
      p_booking_code: bookingCode,
      p_user_id: userId,
      p_passenger_name: identity.name,
      p_town: stage0Town,
      p_stage0_label: stage0Label,
      p_stage0_lat: stage0Lat,
      p_stage0_lng: stage0Lng,
      p_task_description: taskDescription,
      p_stops: normalizedStops,
      p_final_destination_mode: finalMode,
      p_final_label: finalLabel,
      p_final_lat: finalLat,
      p_final_lng: finalLng,
      p_is_pabili: body.is_pabili === true,
      p_estimated_purchase_amount: estimatedPurchaseAmount,
      p_estimated_cargo_weight_kg: estimatedCargoWeightKg,
      p_vehicle_requirement: vehicleRequirement,
      p_accompanied: false,
    });

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          code: "ERRAND_BOOKING_CREATE_FAILED",
          message: error.message,
        },
        { status: 500 }
      );
    }

    const result = (data as any) || {};
    if (result.ok === false) {
      const code = text(result.error) || "ERRAND_BOOKING_CREATE_BLOCKED";
      const status =
        code === "PASSENGER_ALREADY_HAS_ACTIVE_BOOKING"
          ? 409
          : code === "ERRAND_REQUIRES_VERIFIED_PASSENGER"
            ? 403
            : 400;

      return NextResponse.json({ ...result, code }, { status });
    }

    return NextResponse.json({
      ...result,
      ok: true,
      stage0_town: stage0Town,
      dispatch_pending: true,
      feature_status: "gated_backend_only",
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "ERRAND_BOOKING_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500 }
    );
  }
}
