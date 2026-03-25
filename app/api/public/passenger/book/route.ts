import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type Json = Record<string, any>;

function text(v: any): string {
  return String(v ?? "").trim();
}

function num(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function jrideNightGateBypass(): boolean {
  const v = String(process.env.JRIDE_NIGHT_GATE_BYPASS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

function mobileBookSecretOk(req: Request): boolean {
  const got = text(req.headers.get("x-jride-mobile-book-secret"));
  const expected = text(process.env.JRIDE_MOBILE_BOOK_SECRET);
  return !!expected && got === expected;
}

async function frGetUserAndVerified(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.auth.getUser();
  const user = data?.user ?? null;

  if (!user?.id) {
    return { user: null, verified: false };
  }

  let verified = false;

  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle();

    const s = text((pv.data as any)?.status).toLowerCase();
    if (s === "approved_admin" || s === "approved" || s === "verified") {
      verified = true;
    }
  } catch {}

  if (!verified) {
    try {
      const pr = await supabase
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", user.id)
        .maybeSingle();

      const s = text((pr.data as any)?.status).toLowerCase();
      if (s === "approved_admin" || s === "approved" || s === "verified") {
        verified = true;
      }
    } catch {}
  }

  if (!verified) {
    try {
      const truthy = (v: any) =>
        v === true ||
        (typeof v === "string" &&
          v.trim().toLowerCase() !== "" &&
          v.trim().toLowerCase() !== "false" &&
          v.trim().toLowerCase() !== "0" &&
          v.trim().toLowerCase() !== "no") ||
        (typeof v === "number" && v > 0);

      const tries: Array<["auth_user_id" | "user_id", string]> = [
        ["auth_user_id", user.id],
        ["user_id", user.id],
      ];

      for (const [col, val] of tries) {
        const r = await supabase
          .from("passengers")
          .select("is_verified,verified,verification_tier")
          .eq(col, val)
          .limit(1)
          .maybeSingle();

        if (!r.error && r.data) {
          const row: any = r.data;
          verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
          if (verified) break;
        }
      }
    } catch {}
  }

  return { user, verified };
}

async function lookupVerifiedByUserId(
  supabase: ReturnType<typeof createClient>,
  userId: string
) {
  let verified = false;

  try {
    const pv = await supabase
      .from("passenger_verifications")
      .select("status")
      .eq("user_id", userId)
      .maybeSingle();

    const s = text((pv.data as any)?.status).toLowerCase();
    if (s === "approved_admin" || s === "approved" || s === "verified") {
      verified = true;
    }
  } catch {}

  if (!verified) {
    try {
      const pr = await supabase
        .from("passenger_verification_requests")
        .select("status")
        .eq("passenger_id", userId)
        .maybeSingle();

      const s = text((pr.data as any)?.status).toLowerCase();
      if (s === "approved_admin" || s === "approved" || s === "verified") {
        verified = true;
      }
    } catch {}
  }

  if (!verified) {
    try {
      const truthy = (v: any) =>
        v === true ||
        (typeof v === "string" &&
          v.trim().toLowerCase() !== "" &&
          v.trim().toLowerCase() !== "false" &&
          v.trim().toLowerCase() !== "0" &&
          v.trim().toLowerCase() !== "no") ||
        (typeof v === "number" && v > 0);

      const tries: Array<["auth_user_id" | "user_id", string]> = [
        ["auth_user_id", userId],
        ["user_id", userId],
      ];

      for (const [col, val] of tries) {
        const r = await supabase
          .from("passengers")
          .select("is_verified,verified,verification_tier")
          .eq(col, val)
          .limit(1)
          .maybeSingle();

        if (!r.error && r.data) {
          const row: any = r.data;
          verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
          if (verified) break;
        }
      }
    } catch {}
  }

  return verified;
}

async function resolveBookActor(
  supabase: ReturnType<typeof createClient>,
  req: Request,
  body: Json
) {
  const uv = await frGetUserAndVerified(supabase);
  if (uv.user?.id) {
    return {
      userId: String(uv.user.id),
      verified: !!uv.verified,
      source: "web_session" as const,
    };
  }

  if (mobileBookSecretOk(req)) {
    const uid = text(body?.created_by_user_id || body?.user_id);
    if (uid) {
      const verified = await lookupVerifiedByUserId(supabase, uid);
      return {
        userId: uid,
        verified,
        source: "android_mobile_secret" as const,
      };
    }
  }

  return {
    userId: "",
    verified: false,
    source: "none" as const,
  };
}

function phtHourNow(): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    hour12: false,
    hour: "2-digit",
  });
  return parseInt(fmt.format(new Date()), 10);
}

async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const uv = await frGetUserAndVerified(supabase);
  if (!uv.user?.id) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
      { status: 401 }
    );
  }

  const hour = phtHourNow();
  const nightGate = hour >= 20 || hour < 5;

  if (nightGate && !uv.verified && !jrideNightGateBypass()) {
    throw {
      code: "NIGHT_GATE_UNVERIFIED",
      message: "Booking is restricted from 8PM to 5AM unless verified.",
      status: 403,
    };
  }

  return { ok: true };
}

function bookingCodeNow() {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp =
    d.getFullYear().toString() +
    pad(d.getMonth() + 1) +
    pad(d.getDate()) +
    pad(d.getHours()) +
    pad(d.getMinutes()) +
    pad(d.getSeconds());
  const rand = Math.floor(1000 + Math.random() * 9000);
  return `JR-UI-${stamp}-${rand}`;
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as Json;

    const actor = await resolveBookActor(supabase, req, body);
    const createdByUserId = actor.userId || null;
    const isVerified = !!actor.verified;

    if (!createdByUserId) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
        { status: 401 }
      );
    }

    try {
      if (actor.source === "web_session") {
        const canRes: any = await canBookOrThrow(supabase);
        if (canRes && typeof (canRes as any).headers?.get === "function") {
          return canRes;
        }
      } else {
        const hour = phtHourNow();
        const nightGate = hour >= 20 || hour < 5;

        if (nightGate && !isVerified && !jrideNightGateBypass()) {
          return NextResponse.json(
            {
              ok: false,
              code: "NIGHT_GATE_UNVERIFIED",
              message: "Booking is restricted from 8PM to 5AM unless verified.",
            },
            { status: 403 }
          );
        }
      }
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          code: e.code || "CAN_BOOK_FAILED",
          message: e.message || "Not allowed",
        },
        { status: e.status || 403 }
      );
    }

    const town = text(body.town);
    const passengerName = text(body.passenger_name || body.full_name);
    const vehicleType = text(body.vehicle_type || body.vehicle || "tricycle");
    const passengerCount = Math.max(1, Math.floor(num(body.passenger_count) ?? 1));

    const pickupLabel = text(body.pickup_label || body.from_label || body.pickup || body.from);
    const dropoffLabel = text(body.dropoff_label || body.to_label || body.dropoff || body.to);

    const pickupLat = num(body.pickup_lat ?? body.from_lat ?? body.origin_lat);
    const pickupLng = num(body.pickup_lng ?? body.from_lng ?? body.origin_lng);
    const dropoffLat = num(body.dropoff_lat ?? body.to_lat ?? body.destination_lat ?? body.dest_lat);
    const dropoffLng = num(body.dropoff_lng ?? body.to_lng ?? body.destination_lng ?? body.dest_lng);

    const notes = text(body.notes);
    const feesAcknowledged = !!body.fees_acknowledged;

    if (!town) {
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
          code: "FARE_NOTICE_REQUIRED",
          message: "Please acknowledge the fare notice before requesting a ride.",
        },
        { status: 400 }
      );
    }

    const booking_code = bookingCodeNow();

    const insertRow: Json = {
      booking_code,
      status: "pending",
      town,
      passenger_name: passengerName || null,
      vehicle_type: vehicleType || "tricycle",
      passenger_count: passengerCount,
      pickup_label: pickupLabel,
      dropoff_label: dropoffLabel,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      notes: notes || null,
      created_by_user_id: createdByUserId,
      customer_status: "pending",
    };

    const { data, error } = await supabase
      .from("bookings")
      .insert(insertRow)
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
        booking_code,
        booking: data,
      },
      { status: 200, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "BOOK_ROUTE_FAILED",
        message: e?.message || "Unknown error",
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}