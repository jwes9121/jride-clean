import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

type FareResponseBody = {
  booking_id?: string;
  bookingId?: string;
  booking_code?: string;
  bookingCode?: string;
  response?: string;
  action?: string;
};

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function createAuthClient(token: string) {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const supabaseAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing Supabase URL or anon key");
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createAdminClient() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const serviceRoleKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || "";

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing Supabase service role env");
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function getBearerToken(req: Request): string | null {
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

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing bearer token." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const authClient = createAuthClient(token);

    const {
      data: { user },
      error: authError,
    } = await authClient.auth.getUser();

    if (authError || !user?.id) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_AUTHED",
          message: authError?.message || "Invalid bearer token.",
        },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const body = (await req.json().catch(() => ({}))) as FareResponseBody;

    const bookingId = text(body.booking_id || body.bookingId);
    const bookingCode = text(body.booking_code || body.bookingCode);
    const rawResponse = text(body.response || body.action).toLowerCase();

    const responseValue =
      rawResponse === "accept" || rawResponse === "accepted"
        ? "accepted"
        : rawResponse === "reject" || rawResponse === "rejected"
        ? "rejected"
        : "";

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_ID" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!responseValue) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RESPONSE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let adminClient;
    try {
      adminClient = createAdminClient();
    } catch (e: any) {
      return NextResponse.json(
        {
          ok: false,
          error: "ADMIN_CLIENT_INIT_FAILED",
          message: String(e?.message || e),
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    let bookingQuery = adminClient
      .from("bookings")
      .select("*")
      .eq("created_by_user_id", user.id)
      .limit(1);

    bookingQuery = bookingId
      ? bookingQuery.eq("id", bookingId)
      : bookingQuery.eq("booking_code", bookingCode);

    const { data: bookingRows, error: bookingReadError } = await bookingQuery;

    if (bookingReadError) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingReadError.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = bookingRows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const currentStatus = text((booking as any).status).toLowerCase();

    if (currentStatus !== "fare_proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: "Fare response is only allowed in fare_proposed state.",
          status: currentStatus,
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    if (responseValue === "accepted") {
      const proposedFare = Number((booking as any).proposed_fare ?? NaN);
      const pickupFee = Number((booking as any).pickup_distance_fee ?? 0);

      const updatePayload: Record<string, unknown> = {
        passenger_fare_response: "accepted",
        status: "ready",
      };

      if (Number.isFinite(proposedFare) && proposedFare > 0) {
        updatePayload.verified_fare = proposedFare;
      }

      const { error: updateError } = await adminClient
        .from("bookings")
        .update(updatePayload)
        .eq("id", (booking as any).id);

      if (updateError) {
        return NextResponse.json(
          {
            ok: false,
            error: "FARE_ACCEPT_UPDATE_FAILED",
            message: updateError.message,
            booking_id: (booking as any).id,
          },
          { status: 500, headers: noStoreHeaders() }
        );
      }

      return NextResponse.json(
        {
          ok: true,
          booking_id: (booking as any).id,
          booking_code: (booking as any).booking_code,
          response: "accepted",
          status: "ready",
          verified_fare: Number.isFinite(proposedFare) ? proposedFare : null,
          pickup_distance_fee: Number.isFinite(pickupFee) ? pickupFee : 0,
        },
        { status: 200, headers: noStoreHeaders() }
      );
    }

    const rejectPayload: Record<string, unknown> = {
      passenger_fare_response: "rejected",
      status: "searching",
      assigned_driver_id: null,
      driver_id: null,
      proposed_fare: null,
      verified_fare: null,
      driver_to_pickup_km: null,
      pickup_distance_fee: 0,
    };

    const { error: rejectError } = await adminClient
      .from("bookings")
      .update(rejectPayload)
      .eq("id", (booking as any).id);

    if (rejectError) {
      return NextResponse.json(
        {
          ok: false,
          error: "FARE_REJECT_UPDATE_FAILED",
          message: rejectError.message,
          booking_id: (booking as any).id,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: (booking as any).id,
        booking_code: (booking as any).booking_code,
        response: "rejected",
        status: "searching",
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message || e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}