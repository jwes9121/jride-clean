import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type BookBody = {
  town?: string;
  pickup_label?: string;
  dropoff_label?: string;
  pickup_lat?: number | string | null;
  pickup_lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
  vehicle_type?: string;
  passenger_count?: number | string | null;
  notes?: string;
  fees_acknowledged?: boolean;
};

function text(v: any): string {
  return String(v ?? "").trim();
}

function num(v: any): number | null {
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

async function frGetUserAndVerified(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase.auth.getUser();
  const user = data?.user ?? null;
  let verified = false;

  if (user?.id) {
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
        const truthy = (v: any) =>
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
          const r = await supabase.from("passengers").select(selV).eq(col, val).limit(1).maybeSingle();
          if (!r.error && r.data) {
            const row: any = r.data;
            verified = truthy(row.is_verified) || truthy(row.verified) || truthy(row.verification_tier);
            if (verified) break;
          }
        }
      } catch {}
    }
  }

  return { user, verified };
}

function jrideNightGateBypass(): boolean {
  const v = String(process.env.JRIDE_NIGHT_GATE_BYPASS || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

async function canBookOrThrow(supabase: ReturnType<typeof createClient>) {
  const uv = await frGetUserAndVerified(supabase as any);
  if (!uv.user?.id) {
    return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });
  }

  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", hour12: false, hour: "2-digit" });
  const hour = parseInt(fmt.format(new Date()), 10);
  const nightGate = hour >= 20 || hour < 5;

  if (nightGate && !uv.verified && !jrideNightGateBypass()) {
    throw { code: "NIGHT_GATE_UNVERIFIED", message: "Booking is restricted from 8PM to 5AM unless verified.", status: 403 };
  }

  return { ok: true, userId: uv.user.id, verified: uv.verified };
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as BookBody;

    const town = text(body.town);
    const pickupLabel = text(body.pickup_label);
    const dropoffLabel = text(body.dropoff_label);
    const pickupLat = num(body.pickup_lat);
    const pickupLng = num(body.pickup_lng);
    const dropoffLat = num(body.dropoff_lat);
    const dropoffLng = num(body.dropoff_lng);
    const vehicleType = text(body.vehicle_type || "tricycle");
    const passengerCount = Math.max(1, Math.floor(num(body.passenger_count) ?? 1));
    const notes = text(body.notes);
    const feesAcknowledged = !!body.fees_acknowledged;

    if (!town) {
      return NextResponse.json({ ok: false, code: "MISSING_TOWN", message: "Town is required." }, { status: 400 });
    }
    if (!pickupLabel || pickupLat == null || pickupLng == null) {
      return NextResponse.json({ ok: false, code: "MISSING_PICKUP", message: "Pickup location is required." }, { status: 400 });
    }
    if (!dropoffLabel || dropoffLat == null || dropoffLng == null) {
      return NextResponse.json({ ok: false, code: "MISSING_DROPOFF", message: "Drop-off location is required." }, { status: 400 });
    }
    if (!feesAcknowledged) {
      return NextResponse.json(
        { ok: false, code: "ACK_REQUIRED", message: "You must acknowledge the fee notice first." },
        { status: 400 }
      );
    }

    const canRes: any = await canBookOrThrow(supabase as any);
    if (canRes && typeof canRes.headers?.get === "function") {
      return canRes;
    }

    const createdByUserId = String((canRes as any).userId || "").trim();
    if (!createdByUserId) {
      return NextResponse.json({ ok: false, code: "NOT_AUTHED", message: "Not signed in." }, { status: 401 });
    }

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

       
    const { data: booking, error } = await supabase
      .from("bookings")
      .insert(insert)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_INSERT_FAILED", message: error.message || "Booking insert failed." },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_code: bookingCode,
        booking,
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