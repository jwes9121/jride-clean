import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function getBearerToken(req: NextRequest): string | null {
  const auth = text(req.headers.get("authorization"));
  if (!auth.startsWith("Bearer ")) return null;
  const token = auth.slice(7).trim();
  return token || null;
}

function normalizeAction(v: unknown): "accepted" | "rejected" | null {
  const raw = text(v).toLowerCase();
  if (raw === "accept" || raw === "accepted") return "accepted";
  if (raw === "reject" || raw === "rejected") return "rejected";
  return null;
}

function getAnonSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE URL or anon key");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getServiceSupabase() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !serviceRole) {
    throw new Error("Missing SUPABASE URL or service role key");
  }

  return createClient(url, serviceRole, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function POST(req: NextRequest) {
  try {
    const accessToken = getBearerToken(req);
    if (!accessToken) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const body = await req.json().catch(() => ({}));

    const bookingId = text(body?.booking_id || body?.bookingId || body?.id);
    const bookingCode = text(body?.booking_code || body?.bookingCode);
    const action = normalizeAction(body?.response || body?.action || body?.fare_response);

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!action) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RESPONSE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const anonSupabase = getAnonSupabase();
    const serviceSupabase = getServiceSupabase();

    const {
      data: { user },
      error: authError,
    } = await anonSupabase.auth.getUser(accessToken);

    if (authError || !user?.id) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Invalid bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    let bookingQuery = serviceSupabase
      .from("bookings")
      .select("id, booking_code, status, created_by_user_id, driver_id, assigned_driver_id")
      .limit(1);

    bookingQuery = bookingCode
      ? bookingQuery.eq("booking_code", bookingCode)
      : bookingQuery.eq("id", bookingId);

    const { data: booking, error: bookingError } = await bookingQuery.maybeSingle();

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_READ_FAILED", message: bookingError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const ownerId = text((booking as any).created_by_user_id);
    if (!ownerId || ownerId !== user.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "FORBIDDEN",
          message: "This booking does not belong to the signed-in passenger.",
        },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const currentStatus = text((booking as any).status).toLowerCase();
    if (currentStatus !== "fare_proposed") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", current: currentStatus },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const nowIso = new Date().toISOString();
    const updatePayload =
      action === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            updated_at: nowIso,
          }
        : {
            passenger_fare_response: "rejected",
            status: "searching",
            driver_id: null,
            assigned_driver_id: null,
            assigned_at: null,
            proposed_fare: null,
            verified_fare: null,
            driver_to_pickup_km: null,
            pickup_distance_fee: null,
            updated_at: nowIso,
          };

    const { data: updatedRows, error: updateError } = await serviceSupabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id)
      .select("id, booking_code, status, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", message: updateError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const updated = updatedRows?.[0] ?? null;

    return NextResponse.json(
      {
        ok: true,
        booking_id: text(updated?.id || (booking as any).id),
        booking_code: text(updated?.booking_code || (booking as any).booking_code),
        status: text(updated?.status || updatePayload.status),
        passenger_fare_response: text(updated?.passenger_fare_response || action),
        driver_id: updated?.driver_id ?? null,
        assigned_driver_id: updated?.assigned_driver_id ?? null,
        updated_at: updated?.updated_at ?? nowIso,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message ?? e) },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}