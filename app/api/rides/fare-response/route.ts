import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  return auth.slice(7).trim() || null;
}

function createAuthClient(token: string) {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }
  );
}

function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req);
    if (!token) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const authClient = createAuthClient(token);
    const { data: { user } } = await authClient.auth.getUser();

    if (!user?.id) {
      return NextResponse.json(
        { ok: false, error: "INVALID_TOKEN" },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const body = await req.json().catch(() => ({}));

    const bookingId = text(body.booking_id || body.bookingId);
    const bookingCode = text(body.booking_code || body.bookingCode);
    const action = text(body.response || body.action).toLowerCase();

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const responseValue =
      action === "accept" ? "accepted" :
      action === "reject" ? "rejected" : "";

    if (!responseValue) {
      return NextResponse.json(
        { ok: false, error: "INVALID_ACTION" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const admin = createAdminClient();

    let query = admin.from("bookings").select("*").limit(1);

    query = bookingId
      ? query.eq("id", bookingId)
      : query.eq("booking_code", bookingCode);

    const { data: rows } = await query;
    const booking = rows?.[0];

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    // 🔒 STRICT OWNER CHECK (after fetch, not before)
    if (booking.created_by_user_id !== user.id) {
      return NextResponse.json(
        { ok: false, error: "NOT_OWNER" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    if (booking.status !== "fare_proposed") {
      return NextResponse.json(
        { ok: false, error: "INVALID_STATUS", status: booking.status },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    if (responseValue === "accepted") {
      const proposed = Number(booking.proposed_fare ?? 0);

      await admin.from("bookings").update({
        passenger_fare_response: "accepted",
        verified_fare: proposed > 0 ? proposed : null,
        status: "ready",
      }).eq("id", booking.id);

      return NextResponse.json({ ok: true, status: "ready" });
    }

    await admin.from("bookings").update({
      passenger_fare_response: "rejected",
      status: "searching",
      assigned_driver_id: null,
      driver_id: null,
      proposed_fare: null,
      verified_fare: null,
    }).eq("id", booking.id);

    return NextResponse.json({ ok: true, status: "searching" });

  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message || e) },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}