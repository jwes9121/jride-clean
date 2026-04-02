import { NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

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
  notes?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
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
    throw new Error("SUPABASE_ENV_MISSING");
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

function normalizeBaseUrl(v: string): string {
  return String(v || "").trim().replace(/\/+$/, "");
}

function requestOrigin(req: Request): string {
  try {
    const u = new URL(req.url);
    if (u.origin && u.origin !== "null") return normalizeBaseUrl(u.origin);
  } catch {}

  const proto = req.headers.get("x-forwarded-proto") || "https";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "";
  if (host) return normalizeBaseUrl(`${proto}://${host}`);

  return "";
}

function envAny(names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return "";
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

async function getTokenUserAndVerified(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
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
  const v = String(process.env.JRIDE_NIGHT_GATE_BYPASS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function canBookOrThrow(supabase: any) {
  const uv = await getTokenUserAndVerified(supabase);

  if (!uv.user?.id) {
    return NextResponse.json(
      { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
      { status: 401 }
    );
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

  return {
    ok: true,
    userId: uv.user.id,
    verified: uv.verified,
    user: uv.user,
  };
}

async function triggerSingleAutoAssign(req: Request, bookingId: string) {
  const baseUrl = normalizeBaseUrl(
    envAny(["INTERNAL_BASE_URL", "NEXTAUTH_URL", "NEXT_PUBLIC_BASE_URL"]) || requestOrigin(req)
  );

  if (!baseUrl) {
    return {
      attempted: false,
      ok: false,
      skipped: true,
      reason: "BASE_URL_MISSING",
    };
  }

  const url = `${baseUrl}/api/dispatch/auto-assign`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ mode: "single", bookingId }),
    });

    let body: any = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }

    return {
      attempted: true,
      ok: res.ok,
      status: res.status,
      url,
      body,
    };
  } catch (e: any) {
    return {
      attempted: true,
      ok: false,
      status: 0,
      url,
      error: String(e?.message ?? e),
    };
  }
}

export async function POST(req: Request) {
  try {
    const accessToken = getBearerToken(req);

    if (!accessToken) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401 }
      );
    }

    const supabase = createUserClient(accessToken);
    const body = (await req.json().catch(() => ({}))) as BookBody;

    const town = text(body.town);
    const pickupLabel = text(body.from_label || body.pickup_label);
    const dropoffLabel = text(body.to_label || body.dropoff_label);
    const vehicleType = text(body.service_type || body.vehicle_type || "tricycle");

    const pickupLat = num(body.pickup_lat);
    const pickupLng = num(body.pickup_lng);
    const dropoffLat = num(body.dropoff_lat);
    const dropoffLng = num(body.dropoff_lng);

    const passengerCount = Math.max(1, Math.floor(num(body.passenger_count) ?? 1));
    const feesAcknowledged = !!body.fees_acknowledged;
    const notes = text(body.notes);

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
          code: "ACK_REQUIRED",
          message: "You must acknowledge the fee notice first.",
        },
        { status: 400 }
      );
    }

    const canRes: any = await canBookOrThrow(supabase);
    if (canRes && typeof canRes.headers?.get === "function") {
      return canRes;
    }

    const createdByUserId = text((canRes as any).userId);
    if (!createdByUserId) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Not signed in." },
        { status: 401 }
      );
    }

    const passengerName =
      text(body.passenger_name) ||
      text(body.full_name) ||
      userDisplayName((canRes as any).user);

    const bookingCode = bookingCodeNow();

    const insert: Record<string, any> = {
      booking_code: bookingCode,
      status: "requested",
      town,
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

    if (passengerName) {
      insert.passenger_name = passengerName;
    }

    if (notes) {
      insert.notes = notes;
    }

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

    const bookingId = text((booking as any)?.id);
    const autoAssign = bookingId
      ? await triggerSingleAutoAssign(req, bookingId)
      : {
          attempted: false,
          ok: false,
          skipped: true,
          reason: "BOOKING_ID_MISSING_AFTER_INSERT",
        };

    return NextResponse.json(
      {
        ok: true,
        booking_code: bookingCode,
        booking,
        auto_assign: autoAssign,
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
