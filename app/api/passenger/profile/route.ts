import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === "null") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";

  if (!url || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function resolvePassengerFromBearer(req: NextRequest) {
  const auth = text(req.headers.get("authorization"));
  if (!auth.toLowerCase().startsWith("bearer ")) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: "Missing bearer token.",
    };
  }

  const token = auth.slice(7).trim();
  if (!token) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: "Missing bearer token.",
    };
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data?.user?.id) {
    return {
      ok: false as const,
      error: "NOT_AUTHED",
      message: error?.message || "Invalid bearer token.",
    };
  }

  return {
    ok: true as const,
    userId: data.user.id,
    email: text(data.user.email),
    phone: text((data.user as any)?.phone),
  };
}

function buildTripSummary(row: any, driverNameById: Record<string, string>) {
  const verifiedFare = num(row?.verified_fare);
  const proposedFare = num(row?.proposed_fare);
  const pickupDistanceFee = num(row?.pickup_distance_fee) ?? 0;
  const totalFare = (verifiedFare ?? proposedFare ?? 0) + pickupDistanceFee;

  const assignedDriverId = text(row?.assigned_driver_id);
  const resolvedDriverName =
    assignedDriverId && driverNameById[assignedDriverId]
      ? driverNameById[assignedDriverId]
      : null;

  return {
    id: text(row?.id) || null,
    booking_code: text(row?.booking_code) || null,
    status: text(row?.status) || null,
    town: text(row?.town) || null,
    pickup_label: text(row?.from_label) || null,
    dropoff_label: text(row?.to_label) || null,
    driver_name: resolvedDriverName,
    passenger_name: text(row?.passenger_name) || null,
    proposed_fare: proposedFare,
    verified_fare: verifiedFare,
    pickup_distance_fee: pickupDistanceFee,
    total_fare: totalFare,
    created_at: text(row?.created_at) || null,
    updated_at: text(row?.updated_at) || null,
  };
}

export async function GET(req: NextRequest) {
  try {
    const authRes = await resolvePassengerFromBearer(req);
    if (!authRes.ok) {
      return NextResponse.json(authRes, {
        status: 401,
        headers: noStoreHeaders(),
      });
    }

    const supabase = getSupabase();

    let profile: any = null;
    let savedAddressCount = 0;

    try {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, phone, email")
        .eq("id", authRes.userId)
        .limit(1);

      profile = data?.[0] ?? null;
    } catch {
      profile = null;
    }

    try {
      const { data } = await supabase
        .from("passenger_addresses")
        .select("id")
        .eq("created_by_user_id", authRes.userId)
        .eq("is_active", true);

      savedAddressCount = Array.isArray(data) ? data.length : 0;
    } catch {
      savedAddressCount = 0;
    }

    const { data: tripRows, error: tripErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, town, from_label, to_label, assigned_driver_id, passenger_name, proposed_fare, verified_fare, pickup_distance_fee, created_at, updated_at"
      )
      .eq("created_by_user_id", authRes.userId)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tripErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "TRIP_HISTORY_READ_FAILED",
          message: tripErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const driverIds = Array.from(
      new Set(
        (tripRows ?? [])
          .map((row: any) => text(row?.assigned_driver_id))
          .filter((v): v is string => Boolean(v))
      )
    );

    let driverNameById: Record<string, string> = {};

    if (driverIds.length > 0) {
      try {
        const { data: driverRows } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name")
          .in("driver_id", driverIds);

        for (const row of driverRows ?? []) {
          const id = text((row as any)?.driver_id);
          const name = text((row as any)?.full_name);
          if (id && name) {
            driverNameById[id] = name;
          }
        }
      } catch {
        driverNameById = {};
      }
    }

    return NextResponse.json(
      {
        ok: true,
        profile: {
          user_id: authRes.userId,
          full_name: text(profile?.full_name) || null,
          phone: text(profile?.phone) || authRes.phone || null,
          email: text(profile?.email) || authRes.email || null,
          saved_address_count: savedAddressCount,
        },
        recent_trips: (tripRows ?? []).map((row: any) =>
          buildTripSummary(row, driverNameById)
        ),
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PASSENGER_PROFILE_ROUTE_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}