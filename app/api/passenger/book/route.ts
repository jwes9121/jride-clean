import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type BookBody = {
  town?: string;

  pickup_label?: string;
  dropoff_label?: string;
  vehicle_type?: string;

  from_label?: string;
  to_label?: string;
  service_type?: string;

  pickup_lat?: number | string | null;
  pickup_lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;

  passenger_count?: number | string | null;
  fees_acknowledged?: boolean;
  emergency_mode?: boolean;
  emergency_fee_acknowledged?: boolean;

  passenger_name?: string;
  full_name?: string;
  user_id?: string;
  created_by_user_id?: string;
  phone?: string;
  role?: string;
  promo_code?: string;
  device_id?: string;
  platform?: string;
  notes?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function normalizeVehicleType(v: unknown): string {
  const s = norm(v);
  if (!s) return "";
  if (s.includes("motor")) return "motorcycle";
  if (s.includes("trike")) return "tricycle";
  if (s.includes("tricycle")) return "tricycle";
  return s;
}

function oppositeVehicleType(v: string): string | null {
  if (v === "tricycle") return "motorcycle";
  if (v === "motorcycle") return "tricycle";
  return null;
}

function vehicleLabel(v: string): string {
  if (v === "tricycle") return "tricycle";
  if (v === "motorcycle") return "motorcycle";
  return v || "vehicle";
}

type DriverLocationRow = {
  driver_id?: string | null;
  status?: string | null;
  updated_at?: string | null;
  lat?: number | null;
  lng?: number | null;
  town?: string | null;
  vehicle_type?: string | null;
};

type DriverWalletRow = {
  id?: string | null;
  wallet_balance?: number | null;
  min_wallet_required?: number | null;
  wallet_locked?: boolean | null;
};

type AvailabilitySummary = {
  requested_vehicle_type: string;
  alternate_vehicle_type: string | null;
  local_requested_count: number;
  local_alternate_count: number;
  emergency_requested_count: number;
  emergency_alternate_count: number;
};

async function logDriverSearchFailure(input: {
  passengerId?: string | null;
  passengerName?: string | null;
  town?: string | null;
  fromLabel?: string | null;
  toLabel?: string | null;
  pickupLat?: number | null;
  pickupLng?: number | null;
  dropoffLat?: number | null;
  dropoffLng?: number | null;
  requestedVehicleType?: string | null;
  alternateVehicleType?: string | null;
  code?: string | null;
  message?: string | null;
  availability?: AvailabilitySummary | null;
}) {
  try {
    const admin = supabaseAdmin();
    const availability = input.availability || null;

    await admin.from("driver_search_failures").insert({
      passenger_id: text(input.passengerId) || null,
      passenger_name: text(input.passengerName) || null,
      town: text(input.town) || null,
      from_label: text(input.fromLabel) || null,
      to_label: text(input.toLabel) || null,
      pickup_lat: input.pickupLat ?? null,
      pickup_lng: input.pickupLng ?? null,
      dropoff_lat: input.dropoffLat ?? null,
      dropoff_lng: input.dropoffLng ?? null,
      requested_vehicle_type: text(input.requestedVehicleType) || null,
      alternate_vehicle_type: text(input.alternateVehicleType) || null,
      code: text(input.code) || "NO_DRIVERS_AVAILABLE",
      message: text(input.message) || null,
      local_requested_count: Number((availability as any)?.local_requested_count || 0),
      local_alternate_count: Number((availability as any)?.local_alternate_count || 0),
      emergency_requested_count: Number((availability as any)?.emergency_requested_count || 0),
      emergency_alternate_count: Number((availability as any)?.emergency_alternate_count || 0),
    });
  } catch (e) {
    console.warn("[BOOK] driver_search_failures insert failed", {
      code: text(input.code) || "NO_DRIVERS_AVAILABLE",
      town: text(input.town) || null,
      requested_vehicle_type: text(input.requestedVehicleType) || null,
      passenger_id: text(input.passengerId) || null,
      error: e,
    });
  }
}


const DRIVER_STALE_AFTER_SECONDS = 120;
const DRIVER_ONLINE_LIKE = new Set(["online", "available", "idle", "waiting"]);

function getNearbyTowns(town: string): string[] {
  const map: Record<string, string[]> = {
    Lagawe: ["Lamut", "Hingyon"],
    Lamut: ["Lagawe", "Kiangan"],
    Hingyon: ["Lagawe"],
    Banaue: ["Hingyon"],
  };
  return map[town] || [];
}

function effectiveMinWalletRequired(v: unknown): number {
  const n = num(v);
  if (n == null) return 250;
  return Math.max(250, n);
}

function driverAssignCutoffMinutes(): number {
  const n = Number(process.env.JRIDE_DRIVER_FRESH_MINUTES || "10");
  return Number.isFinite(n) && n > 0 ? n : 10;
}

function bookingAvailabilityFreshnessSeconds(): number {
  const assignCutoffSeconds = driverAssignCutoffMinutes() * 60;
  return Math.min(DRIVER_STALE_AFTER_SECONDS, assignCutoffSeconds);
}

async function getAvailabilitySummary(bookingTown: string, requestedVehicleType: string): Promise<AvailabilitySummary> {
  const supabase = supabaseAdmin();
  const localTown = text(bookingTown);
  const requested = normalizeVehicleType(requestedVehicleType) || "tricycle";
  const alternate = oppositeVehicleType(requested);
  const localTownSet = new Set([localTown.toLowerCase()]);
  const emergencyTownSet = new Set([localTown.toLowerCase(), ...getNearbyTowns(localTown).map((x) => text(x).toLowerCase())]);

  const summary: AvailabilitySummary = {
    requested_vehicle_type: requested,
    alternate_vehicle_type: alternate,
    local_requested_count: 0,
    local_alternate_count: 0,
    emergency_requested_count: 0,
    emergency_alternate_count: 0,
  };

  if (!localTown) {
    return summary;
  }

  const { data: driverRows, error: driverError } = await supabase
    .from("driver_locations")
    .select("driver_id, status, updated_at, lat, lng, town, vehicle_type");

  if (driverError) {
    throw {
      code: "DRIVER_AVAILABILITY_SCAN_FAILED",
      message: driverError.message || "Could not scan driver availability.",
      status: 500,
    };
  }

  const allDrivers = Array.isArray(driverRows) ? (driverRows as DriverLocationRow[]) : [];
  const driverIds = allDrivers.map((row) => text(row.driver_id)).filter(Boolean);

  const walletByDriverId = new Map<string, DriverWalletRow>();
  if (driverIds.length > 0) {
    const { data: walletRows, error: walletError } = await supabase
      .from("drivers")
      .select("id, wallet_balance, min_wallet_required, wallet_locked")
      .in("id", driverIds);

    if (walletError) {
      throw {
        code: "DRIVER_WALLET_SCAN_FAILED",
        message: walletError.message || "Could not scan driver wallets.",
        status: 500,
      };
    }

    for (const row of Array.isArray(walletRows) ? (walletRows as DriverWalletRow[]) : []) {
      walletByDriverId.set(text(row.id), row);
    }
  }

  const nowMs = Date.now();
  const freshnessSeconds = bookingAvailabilityFreshnessSeconds();

  for (const row of allDrivers) {
    const driverId = text(row.driver_id);
    if (!driverId) continue;

    const rawStatus = norm(row.status);
    if (!DRIVER_ONLINE_LIKE.has(rawStatus)) continue;

    const driverTown = text(row.town).toLowerCase();
    if (!driverTown) continue;

    const updatedAt = text(row.updated_at);
    if (!updatedAt) continue;

    const updatedMs = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedMs)) continue;

    const ageSec = (nowMs - updatedMs) / 1000;
    if (ageSec > freshnessSeconds) continue;

    const wallet = walletByDriverId.get(driverId);
    if (Boolean(wallet?.wallet_locked)) continue;

    const walletBalance = num(wallet?.wallet_balance) ?? 0;
    const walletMinRequired = effectiveMinWalletRequired(wallet?.min_wallet_required);
    if (walletBalance < walletMinRequired) continue;

    const driverVehicleType = normalizeVehicleType(row.vehicle_type);
    if (!driverVehicleType) continue;

    const inLocal = localTownSet.has(driverTown);
    const inEmergency = emergencyTownSet.has(driverTown);

    if (driverVehicleType === requested) {
      if (inLocal) summary.local_requested_count++;
      if (inEmergency) summary.emergency_requested_count++;
    } else if (alternate && driverVehicleType === alternate) {
      if (inLocal) summary.local_alternate_count++;
      if (inEmergency) summary.emergency_alternate_count++;
    }
  }

  return summary;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function bookingCodeNow(): string {
  const d = new Date();
  const stamp =
    d.getFullYear().toString() +
    pad2(d.getMonth() + 1) +
    pad2(d.getDate()) +
    pad2(d.getHours()) +
    pad2(d.getMinutes()) +
    pad2(d.getSeconds());
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `JR-UI-${stamp}-${rand}`;
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function createUserClient(accessToken: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!url || !anon) {
    throw {
      code: "SUPABASE_ENV_MISSING",
      message: "Supabase environment is missing for authenticated booking.",
      status: 500,
    };
  }

  return createSupabaseClient(url, anon, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
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

function normalizeTownKey(v: unknown): string {
  return text(v).replace(/\s+/g, " ").toLowerCase();
}

function canApplyBoundaryOverride(selectedTown: string, derivedTown: string, requested: boolean): boolean {
  if (!requested) return false;
  const selectedKey = normalizeTownKey(selectedTown);
  const derivedKey = normalizeTownKey(derivedTown);
  const map: Record<string, string[]> = {
    lagawe: ["kiangan"],
  };
  return !!map[selectedKey]?.includes(derivedKey);
}

function normalizePassengerName(v: unknown): string {
  return String(v ?? "").trim().replace(/\s+/g, " ");
}

function isValidPassengerName(v: string): boolean {
  const parts = String(v ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return false;
  return parts.every((part) => /^[A-Za-z]{2,}$/.test(part));
}

function userDisplayName(user: any): string {
  const direct = [
    user?.user_metadata?.full_name,
    user?.user_metadata?.name,
    user?.user_metadata?.display_name,
    user?.user_metadata?.passenger_name,
    user?.raw_user_meta_data?.full_name,
    user?.raw_user_meta_data?.name,
    user?.raw_user_meta_data?.display_name,
    user?.email,
  ];

  for (const v of direct) {
    const s = text(v);
    if (s) return s;
  }

  return "";
}

async function resolvePickupTownFromCoords(pickupLng: number, pickupLat: number): Promise<string> {
  const token = getMapboxToken();
  if (!token) {
    throw {
      code: "PICKUP_TOWN_VALIDATION_UNAVAILABLE",
      message: "Mapbox token missing for pickup town validation.",
      status: 500,
    };
  }

  const url =
    "https://api.mapbox.com/geocoding/v5/mapbox.places/" +
    `${pickupLng},${pickupLat}.json` +
    `?types=place&limit=1&access_token=${encodeURIComponent(token)}`;

  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    throw {
      code: "PICKUP_TOWN_VALIDATION_UNAVAILABLE",
      message: `Mapbox reverse geocode failed with status ${res.status}.`,
      status: 500,
    };
  }

  const json: any = await res.json().catch(() => ({}));
  const features = Array.isArray(json?.features) ? json.features : [];
  const placeFeature = features.find((f: any) => Array.isArray(f?.place_type) && f.place_type.includes("place"));
  const derivedTown = text(placeFeature?.text);

  if (!derivedTown) {
    throw {
      code: "PICKUP_TOWN_VALIDATION_UNAVAILABLE",
      message: "Pickup town could not be resolved from coordinates.",
      status: 500,
    };
  }

  return derivedTown;
}

async function getTokenUserAndVerified(
  supabase: ReturnType<typeof createClient>,
  accessToken: string
) {
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data?.user?.id) {
    return { user: null, verified: false };
  }

  const user = data.user;
  let verified = false;

  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const s = String((pv.data as any)?.status ?? "").toLowerCase().trim();
    verified = s === "approved_admin";
  } catch {}

  if (!verified) {
    try {
      const pr = await supabase
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", user.id)
        .maybeSingle();

      const s = String((pr.data as any)?.status ?? "").toLowerCase().trim();
      verified = s === "approved_admin";
    } catch {}
  }

  if (!verified) {
    try {
      const truthy = (v: unknown) =>
        v === true ||
        (typeof v === "string" &&
          v.trim().toLowerCase() !== "" &&
          v.trim().toLowerCase() !== "false" &&
          v.trim().toLowerCase() !== "0" &&
          v.trim().toLowerCase() !== "no") ||
        (typeof v === "number" && v > 0);

      const selV = "is_verified,verified,verification_tier";
      const tries: Array<["auth_user_id" | "user_id", string]> = [
        ["auth_user_id", user.id],
        ["user_id", user.id],
      ];

      for (const [col, val] of tries) {
        const r = await supabase
          .from("passengers")
          .select(selV)
          .eq(col, val)
          .limit(1)
          .maybeSingle();

        if (!r.error && r.data) {
          const row: any = r.data;
          verified =
            truthy(row.is_verified) ||
            truthy(row.verified) ||
            truthy(row.verification_tier);

          if (verified) break;
        }
      }
    } catch {}
  }

  return { user, verified };
}

function jrideNightGateBypass(): boolean {
  const v = String(process.env.JRIDE_NIGHT_GATE_BYPASS || "")
    .trim()
    .toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function canBookOrThrow(
  supabase: ReturnType<typeof createClient>,
  accessToken: string
) {
  const uv = await getTokenUserAndVerified(supabase, accessToken);

  if (!uv.user?.id) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
      { status: 401 }
    );
  }

  if (!uv.verified) {
    const priorCountRes = await supabase
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("created_by_user_id", uv.user.id);

    if (priorCountRes.error) {
      throw {
        code: "UNVERIFIED_BOOKING_CHECK_FAILED",
        message: priorCountRes.error.message || "Could not validate prior unverified bookings.",
        status: 500,
      };
    }

    const priorCount = Number(priorCountRes.count || 0);

    if (priorCount >= 1) {
      throw {
        code: "UNVERIFIED_BOOKING_LIMIT",
        message: "Passenger verification is required after the first unverified booking.",
        status: 403,
      };
    }
  }

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
  });

  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  if (nightGate && !uv.verified && !jrideNightGateBypass()) {
    throw {
      code: "NIGHT_GATE_UNVERIFIED",
      message: "Booking is restricted from 8PM to 5AM unless verified.",
      status: 403,
    };
  }

  return { ok: true, userId: uv.user.id, user: uv.user, verified: uv.verified };
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401 }
      );
    }

    const userSupabase = createUserClient(accessToken);

    const body = (await req.json().catch(() => ({}))) as BookBody;

const boundaryOverrideRequested =
  (body as any).boundary_override === true ||
  (body as any).boundaryOverride === true ||
  String((body as any).boundary_override || "").trim() === "1" ||
  String((body as any).boundaryOverride || "").trim().toLowerCase() === "true";

    const selectedTown = text(body.town);
    const pickupLabel = text(body.from_label || body.pickup_label);
    const dropoffLabel = text(body.to_label || body.dropoff_label);
    const vehicleType = normalizeVehicleType(body.service_type || body.vehicle_type || "tricycle") || "tricycle";

    const pickupLat = num(body.pickup_lat);
    const pickupLng = num(body.pickup_lng);
    const dropoffLat = num(body.dropoff_lat);
    const dropoffLng = num(body.dropoff_lng);

    const passengerCount = Math.max(1, Math.floor(num(body.passenger_count) ?? 1));
    const feesAcknowledged = !!body.fees_acknowledged;
    const emergencyMode = !!body.emergency_mode;
    const emergencyFeeAcknowledged = !!body.emergency_fee_acknowledged;
    const promoCode = text(body.promo_code).toUpperCase();
    const deviceId = text(body.device_id);
    const promoProgramCode =
      promoCode && text(body.platform).toLowerCase() === "android"
        ? "ANDROID_FIRST_RIDE_40"
        : "";
    const platform = norm(body.platform || "android") || "android";
    const notes = text(body.notes).slice(0, 300) || null;

    if (!selectedTown) {
      return NextResponse.json(
        { ok: false, code: "MISSING_TOWN", message: "Town is required." },
        { status: 400 }
      );
    }

    if (!pickupLabel || pickupLat == null || pickupLng == null) {
      return NextResponse.json(
        { ok: false, code: "MISSING_PICKUP", message: "Pickup location is required." },
        { status: 400 }
      );
    }

    if (!dropoffLabel || dropoffLat == null || dropoffLng == null) {
      return NextResponse.json(
        { ok: false, code: "MISSING_DROPOFF", message: "Drop-off location is required." },
        { status: 400 }
      );
    }

    if (!feesAcknowledged) {
      return NextResponse.json(
        {
          ok: false,
          code: "ACK_REQUIRED",
          message: "You must acknowledge the fee notice first.",
        },
        { status: 400 }
      );
    }

    const derivedTown = await resolvePickupTownFromCoords(pickupLng, pickupLat);
    const boundaryOverrideApplied =
      normalizeTownKey(derivedTown) !== normalizeTownKey(selectedTown) &&
      canApplyBoundaryOverride(selectedTown, derivedTown, boundaryOverrideRequested);
    const effectiveTown = boundaryOverrideApplied ? selectedTown : derivedTown;

    if (!boundaryOverrideApplied && normalizeTownKey(derivedTown) !== normalizeTownKey(selectedTown)) {
      return NextResponse.json(
        {
          ok: false,
          code: "PICKUP_TOWN_MISMATCH",
          message: `Pickup point belongs to ${derivedTown}, not ${selectedTown}.`,
          selected_town: selectedTown,
          derived_town: derivedTown,
        },
        { status: 409 }
      );
    }

    const canRes: any = await canBookOrThrow(userSupabase as any, accessToken);
    if (canRes && typeof canRes.headers?.get === "function") {
      return canRes;
    }

    const createdByUserId = String((canRes as any).userId || "").trim();
    if (!createdByUserId) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
        { status: 401 }
      );
    }

    const passengerName = normalizePassengerName(
      text(body.passenger_name) ||
      text(body.full_name) ||
      userDisplayName((canRes as any).user)
    );

    if (!isValidPassengerName(passengerName)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_PASSENGER_NAME",
          message: "Passenger name must contain at least first name and last name, using letters only, with at least 2 letters per word.",
        },
        { status: 400 }
      );
    }

    const availability = await getAvailabilitySummary(effectiveTown, vehicleType);

    if (!emergencyMode) {
      if (availability.local_requested_count <= 0 && availability.local_alternate_count > 0) {
        return NextResponse.json(
          {
            ok: false,
            code: "ALTERNATE_VEHICLE_AVAILABLE",
            message: `No available ${vehicleLabel(vehicleType)} drivers in ${derivedTown}. ${vehicleLabel(availability.alternate_vehicle_type || "")} is available now.`,
            requested_vehicle_type: vehicleType,
            alternate_vehicle_type: availability.alternate_vehicle_type,
            availability,
          },
          { status: 409 }
        );
      }

      if (availability.local_requested_count <= 0 && availability.local_alternate_count <= 0) {
        if (availability.emergency_requested_count > 0) {
          await logDriverSearchFailure({
            passengerId: createdByUserId,
            passengerName,
            town: effectiveTown,
            fromLabel: pickupLabel,
            toLabel: dropoffLabel,
            pickupLat,
            pickupLng,
            dropoffLat,
            dropoffLng,
            requestedVehicleType: vehicleType,
            alternateVehicleType: availability.alternate_vehicle_type,
            code: "EMERGENCY_BOOKING_AVAILABLE",
            message: `No local ${vehicleLabel(vehicleType)} drivers were found for ${derivedTown}. Emergency search in nearby towns is available.`,
            availability,
          });

          return NextResponse.json(
            {
              ok: false,
              code: "EMERGENCY_BOOKING_AVAILABLE",
              message: "No drivers are currently available in your town. You can continue with Emergency Booking to search nearby towns. A pickup distance fee may apply depending on how far the assigned driver is from your pickup point.",
              requested_vehicle_type: vehicleType,
              alternate_vehicle_type: availability.alternate_vehicle_type,
              availability,
            },
            { status: 409 }
          );
        }

        await logDriverSearchFailure({
          passengerId: createdByUserId,
          passengerName,
          town: effectiveTown,
          fromLabel: pickupLabel,
          toLabel: dropoffLabel,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          requestedVehicleType: vehicleType,
          alternateVehicleType: availability.alternate_vehicle_type,
          code: "NO_DRIVERS_AVAILABLE",
          message: `No available ${vehicleLabel(vehicleType)} or alternate local drivers were found for ${derivedTown} right now.`,
          availability,
        });


        return NextResponse.json(


          {


            ok: false,


            code: "NO_DRIVERS_AVAILABLE",


            message: `No available ${vehicleLabel(vehicleType)} or alternate local drivers were found for ${derivedTown} right now.`,


            requested_vehicle_type: vehicleType,


            alternate_vehicle_type: availability.alternate_vehicle_type,


            availability,


          },


          { status: 409 }


        );
      }
    } else {
      if (!emergencyFeeAcknowledged) {
        return NextResponse.json(
          {
            ok: false,
            code: "EMERGENCY_ACK_REQUIRED",
            message: "You must acknowledge the emergency pickup distance fee notice first.",
          },
          { status: 400 }
        );
      }

      if (availability.emergency_requested_count <= 0) {
        await logDriverSearchFailure({
          passengerId: createdByUserId,
          passengerName,
          town: effectiveTown,
          fromLabel: pickupLabel,
          toLabel: dropoffLabel,
          pickupLat,
          pickupLng,
          dropoffLat,
          dropoffLng,
          requestedVehicleType: vehicleType,
          alternateVehicleType: availability.alternate_vehicle_type,
          code: "NO_DRIVERS_AVAILABLE",
          message: `No emergency ${vehicleLabel(vehicleType)} drivers were found in nearby towns right now.`,
          availability,
        });


        return NextResponse.json(


          {


            ok: false,


            code: "NO_DRIVERS_AVAILABLE",


            message: `No emergency ${vehicleLabel(vehicleType)} drivers were found in nearby towns right now.`,


            requested_vehicle_type: vehicleType,


            alternate_vehicle_type: availability.alternate_vehicle_type,


            availability,


          },


          { status: 409 }


        );
      }
    }

    const bookingCode = bookingCodeNow();

    const insert: Record<string, any> = {
      booking_code: bookingCode,
      status: "searching",
      town: effectiveTown,
      from_label: pickupLabel,
      to_label: dropoffLabel,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      service_type: vehicleType,
      passenger_count: passengerCount,
      created_by_user_id: createdByUserId,
      passenger_name: passengerName,
      notes,
      customer_status: "pending",
      is_emergency: emergencyMode,
    };

    const { data: booking, error } = await userSupabase
      .from("bookings")
      .insert(insert)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        {
          ok: false,
          code: "BOOKING_INSERT_FAILED",
          message: error.message || "Booking insert failed.",
        },
        { status: 500 }
      );
    }

    let promo: Record<string, any> | null = null;

    if (promoCode && deviceId && booking?.id && bookingCode) {
      const ensureRes = await userSupabase.rpc("jride_promo_ensure_android_credit", {
        p_user_id: createdByUserId,
        p_device_id: deviceId,
        p_program_code: promoProgramCode,
      });

      if (ensureRes.error) {
        promo = {
          ok: false,
          stage: "ensure",
          error: ensureRes.error.message || "PROMO_ENSURE_FAILED",
        };
      } else {
        const ensureData = (ensureRes.data as any) || null;

        if ((ensureData as any)?.ok === false) {
          await userSupabase.from("bookings").delete().eq("id", booking.id);

          return NextResponse.json(
            {
              ok: false,
              code: "PROMO_ENSURE_BLOCKED",
              message: String((ensureData as any)?.error || "Promo is not available for this account or device."),
              promo: {
                ok: false,
                stage: "ensure",
                ensure: ensureData,
                error: String((ensureData as any)?.error || "PROMO_ENSURE_BLOCKED"),
              },
            },
            { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } }
          );
        }

        const reserveRes = await userSupabase.rpc("jride_promo_reserve_for_booking", {
          p_user_id: createdByUserId,
          p_device_id: deviceId,
          p_booking_id: booking.id,
          p_booking_code: bookingCode,
          p_program_code: promoProgramCode,
        });
        const reserveData = (reserveRes.data as any) || null;

        if (reserveRes.error || (reserveData as any)?.ok === false) {
          await userSupabase.from("bookings").delete().eq("id", booking.id);

          return NextResponse.json(
            {
              ok: false,
              code: "PROMO_RESERVE_BLOCKED",
              message: String(
                reserveRes.error?.message ||
                  (reserveData as any)?.error ||
                  "Promo could not be reserved for this booking."
              ),
              promo: {
                ok: false,
                stage: "reserve",
                ensure: ensureData,
                reserve: reserveData,
                error: String(
                  reserveRes.error?.message ||
                    (reserveData as any)?.error ||
                    "PROMO_RESERVE_BLOCKED"
                ),
              },
            },
            { status: 409, headers: { "Cache-Control": "no-store, max-age=0" } }
          );
        }

        const reservedPromo = reserveData;
        const reservedCreditId = text((reservedPromo as any)?.credit_id);
        const reservedStatus =
          text((reservedPromo as any)?.reservation_status || (reservedPromo as any)?.status) || "reserved";
        const reservedAmountRaw = Number((reservedPromo as any)?.credit_amount ?? 40);
        const reservedAmount = Number.isFinite(reservedAmountRaw)
          ? Math.max(0, reservedAmountRaw)
          : 40;

        if (!((reserveRes as any)?.error) && reservedCreditId) {
          const promoBookingPatch = {
            promo_program_code: promoProgramCode || "ANDROID_FIRST_RIDE_40",
            promo_credit_id: reservedCreditId,
            promo_status: reservedStatus,
            promo_applied_amount: reservedAmount,
            updated_at: new Date().toISOString(),
          };

          const persistPromoRes = await userSupabase
            .from("bookings")
            .update(promoBookingPatch)
            .eq("id", booking.id)
            .select("id, promo_program_code, promo_credit_id, promo_status, promo_applied_amount")
            .single();

          if (!(persistPromoRes as any)?.error && (persistPromoRes as any)?.data) {
            (booking as any).promo_program_code =
              ((persistPromoRes as any).data as any).promo_program_code ?? promoBookingPatch.promo_program_code;
            (booking as any).promo_credit_id =
              ((persistPromoRes as any).data as any).promo_credit_id ?? promoBookingPatch.promo_credit_id;
            (booking as any).promo_status =
              ((persistPromoRes as any).data as any).promo_status ?? promoBookingPatch.promo_status;
            (booking as any).promo_applied_amount =
              ((persistPromoRes as any).data as any).promo_applied_amount ?? promoBookingPatch.promo_applied_amount;
          }
        }


        promo = {
          ok: true,
          stage: "reserve",
          ensure: ensureData,
          reserve: reserveData,
        };
      }
    } else if (promoCode || deviceId) {
      promo = {
        ok: false,
        stage: "skipped",
        error: !promoCode ? "MISSING_PROMO_CODE" : !deviceId ? "MISSING_DEVICE_ID" : "PROMO_SKIPPED",
      };
    }

    return NextResponse.json(
      {
        ok: true,
        booking_code: bookingCode,
        booking,
        validated_town: derivedTown,
        service_town: effectiveTown,
        boundary_override_applied: boundaryOverrideApplied,
        promo,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        code: e?.code || "BOOK_ROUTE_FAILED",
        message: e?.message || "Unknown error",
      },
      { status: e?.status || 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}






