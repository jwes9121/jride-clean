import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function s(v: unknown): string | null {
  const x = String(v ?? "").trim();
  return x.length > 0 ? x : null;
}

function statusOf(raw: unknown): string {
  const s0 = String(raw ?? "").trim().toLowerCase();
  if (s0 === "requested" || s0 === "searching") return "searching";
  if (s0 === "driver_assigned") return "assigned";
  if (s0 === "accepted_by_driver") return "accepted";
  if (s0 === "en_route") return "on_the_way";
  if (s0 === "in_progress") return "on_trip";
  return s0;
}

function getBearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function createAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) throw new Error("Missing Supabase anon client environment variables.");
  return createSupabaseClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function createServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!url || !serviceRole) throw new Error("Missing Supabase service role environment variables.");
  return createSupabaseClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const serviceSupabase = createServiceSupabase();
    const accessToken = getBearerToken(req);

    let driverId: string | null = null;

    if (accessToken) {
      const authSupabase = createAnonSupabase();
      const { data } = await authSupabase.auth.getUser(accessToken);
      const user = data?.user ?? null;
      if (!user?.id) {
        return NextResponse.json({ ok: false, error: "NOT_AUTHED" }, { status: 401, headers: noStoreHeaders() });
      }
      driverId = user.id;
    } else {
      return NextResponse.json({ ok: false, error: "NOT_AUTHED" }, { status: 401, headers: noStoreHeaders() });
    }

    const bookingRes = await serviceSupabase
      .from("bookings")
      .select("*")
      .or(`driver_id.eq.${driverId},assigned_driver_id.eq.${driverId}`)
      .in("status", ["assigned","accepted","fare_proposed","ready","on_the_way","arrived","on_trip"])
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const booking = bookingRes.data;
    if (!booking) {
      return NextResponse.json({ ok: true, trip: null }, { headers: noStoreHeaders() });
    }

    // âœ… FIX: passenger phone
    let passengerPhone: string | null = null;
    if ((booking as any)?.created_by_user_id) {
      const passengerRes = await serviceSupabase
        .from("passenger_profiles")
        .select("phone")
        .eq("id", (booking as any).created_by_user_id)
        .maybeSingle();

      if (passengerRes.data) {
        passengerPhone = s((passengerRes.data as any).phone);
      }
    }

    const trip = {
      id: booking.id,
      booking_code: booking.booking_code,
      status: statusOf(booking.status),
      passenger_name: s((booking as any).passenger_name),
      passenger_phone: passengerPhone,
      driver_id: driverId,
      pickup_lat: n((booking as any).pickup_lat),
      pickup_lng: n((booking as any).pickup_lng),
      dropoff_lat: n((booking as any).dropoff_lat),
      dropoff_lng: n((booking as any).dropoff_lng),
      updated_at: s((booking as any).updated_at)
    };

    return NextResponse.json({ ok: true, trip }, { headers: noStoreHeaders() });

  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || "UNKNOWN_ERROR" },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}