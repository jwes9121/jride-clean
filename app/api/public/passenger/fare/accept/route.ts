import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

type AcceptBody = {
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

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const body = (await req.json().catch(() => ({}))) as AcceptBody;

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

    const currentStatus = text((booking as any).status).toLowerCase();
    if (currentStatus !== "fare_proposed") {
      return NextResponse.json(
        {
          ok: false,
          error: "INVALID_STATUS",
          message: "Fare can only be accepted while booking is in fare_proposed state.",
          status: currentStatus,
        },
        { status: 409, headers: noStoreHeaders() }
      );
    }

    const proposedFareRaw = Number((booking as any).proposed_fare ?? NaN);
    if (!Number.isFinite(proposedFareRaw) || proposedFareRaw <= 0) {
      return NextResponse.json(
        { ok: false, error: "MISSING_PROPOSED_FARE" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const pickupFeeRaw = Number((booking as any).pickup_distance_fee ?? 0);
    const pickupFee = Number.isFinite(pickupFeeRaw) ? pickupFeeRaw : 0;

    const updatePayload: Record<string, unknown> = {
      passenger_fare_response: "accepted",
      verified_fare: proposedFareRaw,
      verified_at: new Date().toISOString(),
      verified_by: "passenger",
      verified_reason: "accepted_by_passenger",
      status: "ready",
    };

    const { error: updateErr } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id);

    if (updateErr) {
      return NextResponse.json(
        {
          ok: false,
          error: "ACCEPT_UPDATE_FAILED",
          message: updateErr.message,
        },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const totalFare = proposedFareRaw + pickupFee;

    return NextResponse.json(
      {
        ok: true,
        booking_code: (booking as any).booking_code,
        booking_id: (booking as any).id,
        verified_fare: proposedFareRaw,
        pickup_distance_fee: pickupFee,
        total_fare: totalFare,
        status: "ready",
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