import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type RejectBody = {
  booking_code?: string;
  booking_id?: string;
};

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

async function retryAutoAssign(req: Request, rejectedDriverId: string) {
  if (!rejectedDriverId) {
    return { attempted: false, skipped: true, reason: "NO_REJECTED_DRIVER_ID" };
  }

  try {
    const url = new URL("/api/dispatch/auto-assign", req.url);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        mode: "scan_requested",
        trigger_reason: "passenger_fare_rejected_exclude_driver",
        exclude_driver_ids: [rejectedDriverId],
      }),
      cache: "no-store",
    });

    const payload = await res.json().catch(() => null);
    return {
      attempted: true,
      ok: res.ok,
      status: res.status,
      excluded_driver_ids: [rejectedDriverId],
      result: payload,
    };
  } catch (e: any) {
    return {
      attempted: true,
      ok: false,
      excluded_driver_ids: [rejectedDriverId],
      error: String(e?.message ?? e),
    };
  }
}

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as RejectBody;

    const bookingCode = text(body.booking_code);
    const bookingId = text(body.booking_id);

    if (!bookingCode && !bookingId) {
      return NextResponse.json(
        { ok: false, error: "MISSING_BOOKING_CODE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const { data: userRes, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userRes?.user) {
      return NextResponse.json(
        { ok: false, error: "NOT_AUTHED", message: "Not signed in." },
        { status: 401, headers: noStoreHeaders() }
      );
    }

    const userId = userRes.user.id;

    let query = supabase
      .from("bookings")
      .select("*")
      .eq("created_by_user_id", userId)
      .limit(1);

    if (bookingCode) {
      query = query.eq("booking_code", bookingCode);
    } else {
      query = query.eq("id", bookingId);
    }

    const { data: rows, error: bookingErr } = await query;

    if (bookingErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "BOOKING_READ_FAILED",
          message: bookingErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const booking = rows?.[0] ?? null;

    if (!booking) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const status = text((booking as any).status).toLowerCase();
    if (status !== "fare_proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: "Fare can only be rejected while booking is in fare_proposed state.",
          status,
        },
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

    const updatePayload: Record<string, unknown> = {
      passenger_fare_response: "rejected",
      proposed_fare: null,
      verified_fare: null,
      verified_at: null,
      verified_by: null,
      verified_reason: null,
      driver_id: null,
      assigned_driver_id: null,
      assigned_at: null,
      driver_fee_proposal_expires_at: null,
      status: "searching",
      updated_at: new Date().toISOString(),
    };

    const updateStartedAt = new Date().toISOString();
    let updateQuery = supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id)
      .eq("created_by_user_id", userId)
      .eq("status", "fare_proposed")
      .is("passenger_fare_response", null)
      .eq("driver_fee_proposal_expires_at", expectedExpiresAt)
      .gt("driver_fee_proposal_expires_at", updateStartedAt);

    updateQuery = rejectedDriverId
      ? updateQuery.eq("assigned_driver_id", rejectedDriverId)
      : updateQuery.is("assigned_driver_id", null);

    const { data: updatedRows, error: updateErr } = await updateQuery
      .select("id,status")
      .limit(1);

    if (updateErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "REJECT_UPDATE_FAILED",
          message: updateErr.message,
        },
        {
          status: updateErr.message.includes("WINDOW_EXPIRED") ? 409 : 500,
          headers: noStoreHeaders(),
        }
      );
    }

    if (!updatedRows?.[0]) {
      return NextResponse.json(
        {
          ok: false,
          error: "FARE_PROPOSAL_EXPIRED_OR_CHANGED",
          message: "The fare response window has closed or was already handled.",
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const reassignResult = await retryAutoAssign(req, rejectedDriverId);

    return NextResponse.json(
      {
        ok: true,
        booking_code: (booking as any).booking_code,
        booking_id: (booking as any).id,
        status: "searching",
        passenger_fare_response: "rejected",
        rejected_driver_id: rejectedDriverId || null,
        reassign: reassignResult,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "SERVER_ERROR",
        message: String(e?.message ?? e),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
