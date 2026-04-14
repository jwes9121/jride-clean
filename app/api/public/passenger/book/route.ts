import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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

  passenger_name?: string;
  full_name?: string;
  user_id?: string;
  created_by_user_id?: string;
  phone?: string;
  role?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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

  return { ok: true, userId: uv.user.id, verified: uv.verified };
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

    const body = (await req.json().catch(() => ({}))) as BookBody;

    const selectedTown = text(body.town);
    const pickupLabel = text(body.from_label || body.pickup_label);
    const dropoffLabel = text(body.to_label || body.dropoff_label);
    const vehicleType = text(body.service_type || body.vehicle_type || "tricycle");

    const pickupLat = num(body.pickup_lat);
    const pickupLng = num(body.pickup_lng);
    const dropoffLat = num(body.dropoff_lat);
    const dropoffLng = num(body.dropoff_lng);

    const passengerCount = Math.max(1, Math.floor(num(body.passenger_count) ?? 1));
    const feesAcknowledged = !!body.fees_acknowledged;

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

    if (normalizeTownKey(derivedTown) !== normalizeTownKey(selectedTown)) {
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

    const canRes: any = await canBookOrThrow(supabase as any, accessToken);
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

    const bookingCode = bookingCodeNow();

    const insert: Record<string, any> = {
      booking_code: bookingCode,
      status: "searching",
      town: derivedTown,
      from_label: pickupLabel,
      to_label: dropoffLabel,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      service_type: vehicleType,
      passenger_count: passengerCount,
      created_by_user_id: createdByUserId,
      customer_status: "pending",
    };

    const { data: booking, error } = await supabase
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

    return NextResponse.json(
      {
        ok: true,
        booking_code: bookingCode,
        booking,
        validated_town: derivedTown,
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
