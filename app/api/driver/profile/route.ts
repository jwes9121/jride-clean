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

async function resolveDriverIdentity(req: NextRequest) {
  const supabase = getSupabase();

  const auth = text(req.headers.get("authorization"));
  if (auth.toLowerCase().startsWith("bearer ")) {
    const token = auth.slice(7).trim();
    if (token) {
      const { data, error } = await supabase.auth.getUser(token);
      if (!error && data?.user?.id) {
        const userId = data.user.id;

        const { data: dp } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name, municipality, phone, email")
          .eq("driver_id", userId)
          .maybeSingle();

        if (dp?.driver_id) {
          return {
            ok: true as const,
            driverId: text(dp.driver_id),
            profileHint: dp,
          };
        }

        const email = text(data.user.email);
        if (email) {
          const { data: byEmail } = await supabase
            .from("driver_profiles")
            .select("driver_id, full_name, municipality, phone, email")
            .eq("email", email)
            .maybeSingle();

          if (byEmail?.driver_id) {
            return {
              ok: true as const,
              driverId: text(byEmail.driver_id),
              profileHint: byEmail,
            };
          }
        }
      }
    }
  }

  const secret = text(req.headers.get("x-jride-driver-secret"));
  const expectedSecret = text(
    process.env.DRIVER_PING_SECRET || process.env.NEXT_PUBLIC_DRIVER_PING_SECRET
  );
  const driverId = text(req.nextUrl.searchParams.get("driver_id"));

  if (driverId && secret && expectedSecret && secret === expectedSecret) {
    return {
      ok: true as const,
      driverId,
      profileHint: null,
    };
  }

  return {
    ok: false as const,
    error: "NOT_AUTHED",
    message: "Missing valid driver auth.",
  };
}

function buildTripSummary(row: any) {
  const verifiedFare = num(row?.verified_fare);
  const proposedFare = num(row?.proposed_fare);
  const pickupDistanceFee = num(row?.pickup_distance_fee) ?? 0;
  const totalFare = (verifiedFare ?? proposedFare ?? 0) + pickupDistanceFee;

  return {
    id: text(row?.id) || null,
    booking_code: text(row?.booking_code) || null,
    status: text(row?.status) || null,
    town: text(row?.town) || null,
    pickup_label: text(row?.from_label) || null,
    dropoff_label: text(row?.to_label) || null,
    driver_name: text(row?.driver_name) || null,
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
    const authRes = await resolveDriverIdentity(req);
    if (!authRes.ok) {
      return NextResponse.json(authRes, {
        status: 401,
        headers: noStoreHeaders(),
      });
    }

    const supabase = getSupabase();

    let profileRow: any = authRes.profileHint ?? null;
    if (!profileRow) {
      try {
        const { data } = await supabase
          .from("driver_profiles")
          .select("driver_id, full_name, municipality, phone, email")
          .eq("driver_id", authRes.driverId)
          .maybeSingle();

        profileRow = data ?? null;
      } catch {
        profileRow = null;
      }
    }

    let wallet: any = null;
    try {
      const { data } = await supabase
        .from("driver_wallet_balances")
        .select("driver_id, balance, min_required_balance, locked, status")
        .eq("driver_id", authRes.driverId)
        .limit(1);

      wallet = data?.[0] ?? null;
    } catch {
      wallet = null;
    }

    const { data: tripRows, error: tripErr } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, status, town, from_label, to_label, driver_name, passenger_name, proposed_fare, verified_fare, pickup_distance_fee, created_at, updated_at, driver_id, assigned_driver_id"
      )
      .or(`driver_id.eq.${authRes.driverId},assigned_driver_id.eq.${authRes.driverId}`)
      .order("created_at", { ascending: false })
      .limit(10);

    if (tripErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_TRIP_HISTORY_READ_FAILED",
          message: tripErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        profile: {
          driver_id: authRes.driverId,
          full_name: text(profileRow?.full_name) || null,
          town: text(profileRow?.municipality) || null,
          phone: text(profileRow?.phone) || null,
          email: text(profileRow?.email) || null,
          wallet_balance: num(wallet?.balance) ?? 0,
          wallet_min_required: num(wallet?.min_required_balance) ?? 0,
          wallet_locked: Boolean(wallet?.locked),
          wallet_status: text(wallet?.status) || null,
        },
        recent_trips: (tripRows ?? []).map(buildTripSummary),
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "DRIVER_PROFILE_ROUTE_FAILED",
        message: String(err?.message ?? err),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
