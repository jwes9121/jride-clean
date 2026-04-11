import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function s(v: any) {
  const x = String(v ?? "").trim();
  return x.length ? x : null;
}

function n(v: any) {
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim();
}

function isDriverSecretAuthorized(req: NextRequest): boolean {
  const provided = s(req.headers.get("x-jride-driver-secret"));
  const expected = s(process.env.DRIVER_PING_SECRET) ?? s(process.env.NEXT_PUBLIC_DRIVER_PING_SECRET);
  return provided && expected && provided === expected;
}

function createServiceSupabase() {
  return createSupabaseClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createServiceSupabase();

    let driverId: string | null = null;

    const token = getBearerToken(req);

    if (token) {
      const anon = createSupabaseClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data } = await anon.auth.getUser(token);
      driverId = data?.user?.id ?? null;
    } else if (isDriverSecretAuthorized(req)) {
      driverId = s(req.nextUrl.searchParams.get("driver_id"));
    } else {
      return NextResponse.json({ ok: false, error: "NOT_AUTHED" }, { status: 401 });
    }

    if (!driverId) {
      return NextResponse.json({ ok: false, error: "DRIVER_NOT_FOUND" }, { status: 404 });
    }

    const { data: booking } = await supabase
      .from("bookings")
      .select("*")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .in("status", ["assigned","accepted","fare_proposed","ready","on_the_way","arrived","on_trip"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!booking) {
      return NextResponse.json({ ok: true, trip: null });
    }

    // âœ… passenger phone (SAFE ADD)
    let passengerPhone = null;
    if (booking.created_by_user_id) {
      const { data } = await supabase
        .from("passenger_profiles")
        .select("phone")
        .eq("id", booking.created_by_user_id)
        .maybeSingle();

      passengerPhone = data?.phone ?? null;
    }

    return NextResponse.json({
      ok: true,
      trip: {
        id: booking.id,
        booking_code: booking.booking_code,
        status: booking.status,
        passenger_name: booking.passenger_name,
        passenger_phone: passengerPhone,
        driver_id: driverId,
        pickup_lat: booking.pickup_lat,
        pickup_lng: booking.pickup_lng,
        dropoff_lat: booking.dropoff_lat,
        dropoff_lng: booking.dropoff_lng,
        updated_at: booking.updated_at
      }
    });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e.message }, { status: 500 });
  }
}