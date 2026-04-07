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

function getAnon() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";

  if (!url || !key) {
    throw new Error("Missing SUPABASE anon env");
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function getService() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  if (!url || !key) {
    throw new Error("Missing SUPABASE service env");
  }

  return createClient(url, key, {
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

async function getSignedInUser(req: NextRequest) {
  const token = getBearerToken(req);
  if (!token) {
    return { user: null, token: null, error: "NOT_AUTHED" };
  }

  const anon = getAnon();
  const {
    data: { user },
    error,
  } = await anon.auth.getUser(token);

  if (error || !user?.id) {
    return { user: null, token: null, error: "NOT_AUTHED" };
  }

  return { user, token, error: null };
}

async function loadOwnedBooking(service: any, bookingId: string, bookingCode: string, userId: string) {
  let query = service
    .from("bookings")
    .select("id, booking_code, status, driver_id, created_by_user_id")
    .eq("created_by_user_id", userId)
    .limit(1);

  query = bookingCode ? query.eq("booking_code", bookingCode) : query.eq("id", bookingId);

  const { data, error } = await query.maybeSingle();
  return { booking: data, error };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await getSignedInUser(req);
    if (!auth.user?.id) {
      return NextResponse.json(
        { ok: false, error: auth.error || "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const url = new URL(req.url);
    const bookingId = text(url.searchParams.get("booking_id"));
    const bookingCode = text(url.searchParams.get("booking_code"));

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const service = getService();
    const { booking, error: bookingError } = await loadOwnedBooking(service, bookingId, bookingCode, auth.user.id);

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

    const { data: existing, error: ratingError } = await service
      .from("trip_ratings")
      .select("id, rating, feedback, created_at")
      .eq("booking_id", booking.id)
      .limit(1)
      .maybeSingle();

    if (ratingError) {
      return NextResponse.json(
        { ok: false, error: "RATING_READ_FAILED", message: ratingError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const status = text(booking.status).toLowerCase();
    const alreadyRated = !!existing;
    const canRate = status === "completed" && !alreadyRated;

    return NextResponse.json(
      {
        ok: true,
        booking_id: text(booking.id),
        booking_code: text(booking.booking_code),
        booking_status: status,
        can_rate: canRate,
        already_rated: alreadyRated,
        rating: existing
          ? {
              id: text(existing.id),
              rating: Number(existing.rating || 0),
              feedback: text(existing.feedback),
              created_at: existing.created_at || null,
            }
          : null,
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

export async function POST(req: NextRequest) {
  try {
    const auth = await getSignedInUser(req);
    if (!auth.user?.id) {
      return NextResponse.json(
        { ok: false, error: auth.error || "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const body = await req.json().catch(() => ({}));
    const bookingId = text(body?.booking_id || body?.bookingId);
    const bookingCode = text(body?.booking_code || body?.bookingCode);
    const rating = Number(body?.rating);
    const feedback = text(body?.feedback);

    if ((!bookingId && !bookingCode) || !Number.isFinite(rating)) {
      return NextResponse.json(
        { ok: false, error: "MISSING_FIELDS" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (rating < 1 || rating > 5) {
      return NextResponse.json(
        { ok: false, error: "INVALID_RATING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (feedback.length > 120) {
      return NextResponse.json(
        { ok: false, error: "FEEDBACK_TOO_LONG" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const service = getService();
    const { booking, error: bookingError } = await loadOwnedBooking(service, bookingId, bookingCode, auth.user.id);

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_READ_FAILED", message: bookingError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const status = text(booking.status).toLowerCase();
    if (status !== "completed") {
      return NextResponse.json(
        { ok: false, error: "NOT_COMPLETED" },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const { data: existing, error: existingError } = await service
      .from("trip_ratings")
      .select("id")
      .eq("booking_id", booking.id)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      return NextResponse.json(
        { ok: false, error: "RATING_READ_FAILED", message: existingError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    if (existing) {
      return NextResponse.json(
        { ok: false, error: "ALREADY_RATED" },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const { error: insertError } = await service.from("trip_ratings").insert({
      booking_id: booking.id,
      booking_code: text(booking.booking_code),
      driver_id: booking.driver_id || null,
      passenger_id: auth.user.id,
      rating,
      feedback,
    });

    if (insertError) {
      return NextResponse.json(
        { ok: false, error: "INSERT_FAILED", message: insertError.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: text(booking.id),
        booking_code: text(booking.booking_code),
        rating,
        feedback,
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
