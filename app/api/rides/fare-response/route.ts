import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerSupabase } from "@/utils/supabase/server";
import { createClient } from "@supabase/supabase-js";

const PASSENGER_FARE_REJECTED_CANCEL_REASON =
  "Passenger declined the fare proposal. Please book again if you still need a ride.";

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

async function releaseRejectedFarePromo(
  serviceSupabase: any,
  bookingId: string,
  passengerId: string
) {
  try {
    const { data, error } = await serviceSupabase.rpc(
      "jride_promo_release_for_booking",
      {
        p_booking_id: bookingId,
        p_customer_id: passengerId,
        p_reason: "passenger_fare_rejected",
      }
    );

    if (error) {
      console.error(
        "[JRIDE_REGULAR_RIDE_FARE_REJECT_PROMO_RELEASE_FAILED]",
        JSON.stringify({ bookingId, passengerId, error: error.message })
      );
      return;
    }

    if (data && typeof data === "object" && data.ok === false) {
      console.error(
        "[JRIDE_REGULAR_RIDE_FARE_REJECT_PROMO_RELEASE_FAILED]",
        JSON.stringify({ bookingId, passengerId, result: data })
      );
    }
  } catch (e: any) {
    console.error(
      "[JRIDE_REGULAR_RIDE_FARE_REJECT_PROMO_RELEASE_FAILED]",
      JSON.stringify({ bookingId, passengerId, error: String(e?.message ?? e) })
    );
  }
}

async function notifyRejectedFareDriver(
  serviceSupabase: any,
  driverId: string,
  bookingCode: string
) {
  if (!driverId) return;

  try {
    const label = bookingCode ? ` ${bookingCode}` : "";
    const { error } = await serviceSupabase.from("driver_notifications").insert({
      driver_id: driverId,
      type: "fare_declined",
      message:
        `Ride booking${label} was cancelled because the passenger declined the fare proposal. ` +
        "You may accept another booking.",
    });

    if (error) {
      console.error(
        "[JRIDE_REGULAR_RIDE_FARE_REJECT_DRIVER_NOTIFICATION_FAILED]",
        JSON.stringify({ bookingCode, driverId, error: error.message })
      );
    }
  } catch (e: any) {
    console.error(
      "[JRIDE_REGULAR_RIDE_FARE_REJECT_DRIVER_NOTIFICATION_FAILED]",
      JSON.stringify({ bookingCode, driverId, error: String(e?.message ?? e) })
    );
  }
}

export async function POST(req: NextRequest) {
  try {
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

    let user: any = null;

    try {
      const cookieSupabase = createServerSupabase();
      const cookieUserRes = await cookieSupabase.auth.getUser();
      user = cookieUserRes.data?.user ?? null;
    } catch {}

    if (!user?.id) {
      const accessToken = getBearerToken(req);
      if (accessToken) {
        const bearerUserRes = await anonSupabase.auth.getUser(accessToken);
        user = bearerUserRes.data?.user ?? null;
      }
    }

    if (!user?.id) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Missing or invalid passenger session." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    let bookingQuery = serviceSupabase
      .from("bookings")
      .select(
        "id, booking_code, status, created_by_user_id, driver_id, assigned_driver_id, passenger_fare_response, driver_fee_proposal_expires_at"
      )
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

    const rejectedDriverId = text(
      (booking as any).assigned_driver_id || (booking as any).driver_id
    );
    const expectedExpiresAt = text(
      (booking as any).driver_fee_proposal_expires_at
    );
    const expiresAtMs = Date.parse(expectedExpiresAt);

    if (
      text((booking as any).passenger_fare_response) ||
      !expectedExpiresAt ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= Date.now()
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "FARE_PROPOSAL_EXPIRED_OR_CHANGED",
          message: "The fare response window has closed or was already handled.",
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const nowIso = new Date().toISOString();
    const updatePayload =
      action === "accepted"
        ? {
            passenger_fare_response: "accepted",
            status: "ready",
            driver_fee_proposal_expires_at: null,
            updated_at: nowIso,
          }
        : {
            passenger_fare_response: "rejected",
            status: "cancelled",
            cancel_reason: PASSENGER_FARE_REJECTED_CANCEL_REASON,
            driver_id: null,
            assigned_driver_id: null,
            driver_status: null,
            assigned_at: null,
            driver_accept_expires_at: null,
            driver_fee_proposal_expires_at: null,
            ride_reassignment_pending: false,
            ride_reassignment_queued_at: null,
            ride_reassignment_next_attempt_at: null,
            updated_at: nowIso,
          };

    let updateQuery = serviceSupabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id)
      .eq("created_by_user_id", user.id)
      .eq("status", "fare_proposed")
      .is("passenger_fare_response", null)
      .eq("driver_fee_proposal_expires_at", expectedExpiresAt)
      .gt("driver_fee_proposal_expires_at", nowIso);

    updateQuery = rejectedDriverId
      ? updateQuery.eq("assigned_driver_id", rejectedDriverId)
      : updateQuery.is("assigned_driver_id", null);

    const { data: updatedRows, error: updateError } = await updateQuery
      .select("id, booking_code, status, cancel_reason, passenger_fare_response, driver_id, assigned_driver_id, updated_at")
      .limit(1);

    if (updateError) {
      return NextResponse.json(
        { ok: false, error: "UPDATE_FAILED", message: updateError.message },
        {
          status: updateError.message.includes("WINDOW_EXPIRED") ? 409 : 500,
          headers: noStoreHeaders(),
        }
      );
    }

    const updated = updatedRows?.[0] ?? null;
    if (!updated) {
      return NextResponse.json(
        {
          ok: false,
          error: "FARE_PROPOSAL_EXPIRED_OR_CHANGED",
          message: "The fare response window has closed or was already handled.",
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    if (action === "rejected") {
      await releaseRejectedFarePromo(
        serviceSupabase,
        String(updated.id),
        user.id
      );
      await notifyRejectedFareDriver(
        serviceSupabase,
        rejectedDriverId,
        text(updated?.booking_code || (booking as any).booking_code)
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: text(updated?.id || (booking as any).id),
        booking_code: text(updated?.booking_code || (booking as any).booking_code),
        status: text(updated?.status || updatePayload.status),
        cancel_reason: text(updated?.cancel_reason || "") || null,
        passenger_fare_response: text(updated?.passenger_fare_response || action),
        driver_id: updated?.driver_id ?? null,
        assigned_driver_id: updated?.assigned_driver_id ?? null,
        updated_at: updated?.updated_at ?? nowIso,
        rejected_driver_id: action === "rejected" ? rejectedDriverId || null : null,
        reassign:
          action === "rejected"
            ? {
                attempted: false,
                skipped: true,
                reason: "PASSENGER_DECLINED_FARE_BOOKING_CANCELLED",
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
