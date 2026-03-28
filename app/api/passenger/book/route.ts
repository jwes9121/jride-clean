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

/**
 * CRITICAL FIX:
 * Bind access token to Supabase client so RLS sees auth.uid()
 */
function createUserClient(accessToken: string) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      },
    }
  );
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

    const { data: userData, error: userError } =
      await supabase.auth.getUser();

    if (userError || !userData?.user?.id) {
      return NextResponse.json(
        { ok: false, code: "NOT_AUTHED", message: "Invalid user session." },
        { status: 401 }
      );
    }

    const userId = userData.user.id;

    const body = (await req.json().catch(() => ({}))) as BookBody;

    const town = text(body.town);
    const pickupLabel = text(body.from_label || body.pickup_label);
    const dropoffLabel = text(body.to_label || body.dropoff_label);
    const vehicleType = text(
      body.service_type || body.vehicle_type || "tricycle"
    );

    const pickupLat = num(body.pickup_lat);
    const pickupLng = num(body.pickup_lng);
    const dropoffLat = num(body.dropoff_lat);
    const dropoffLng = num(body.dropoff_lng);

    const passengerCount = Math.max(
      1,
      Math.floor(num(body.passenger_count) ?? 1)
    );

    const feesAcknowledged = !!body.fees_acknowledged;

    if (!town) {
      return NextResponse.json(
        { ok: false, code: "MISSING_TOWN", message: "Town is required." },
        { status: 400 }
      );
    }

    if (!pickupLabel || pickupLat == null || pickupLng == null) {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_PICKUP",
          message: "Pickup location is required.",
        },
        { status: 400 }
      );
    }

    if (!dropoffLabel || dropoffLat == null || dropoffLng == null) {
      return NextResponse.json(
        {
          ok: false,
          code: "MISSING_DROPOFF",
          message: "Drop-off location is required.",
        },
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

    const bookingCode = bookingCodeNow();

    const insert = {
      booking_code: bookingCode,
      status: "searching",
      town,
      from_label: pickupLabel,
      to_label: dropoffLabel,
      pickup_lat: pickupLat,
      pickup_lng: pickupLng,
      dropoff_lat: dropoffLat,
      dropoff_lng: dropoffLng,
      service_type: vehicleType,
      passenger_count: passengerCount,
      created_by_user_id: userId,
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
          message: error.message,
        },
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
      { status: e?.status || 500 }
    );
  }
}