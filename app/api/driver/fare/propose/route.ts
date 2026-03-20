import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type Body = {
  driver_id?: string | null;
  driverId?: string | null;
  booking_id?: string | null;
  bookingId?: string | null;
  booking_code?: string | null;
  bookingCode?: string | null;
  proposed_fare?: number | string | null;
};

function pickFirstString(values: any[]): string {
  for (const value of values) {
    const s = String(value ?? "").trim();
    if (s) return s;
  }
  return "";
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function parseMoney(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

const ALLOWED_STATUSES = new Set([
  "pending",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
]);

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as Body;

    const requestedDriverId = pickFirstString([body.driver_id, body.driverId]);
    const bookingId = pickFirstString([body.booking_id, body.bookingId]);
    const bookingCode = pickFirstString([body.booking_code, body.bookingCode]);
    const proposedFare = parseMoney(body.proposed_fare);

    if (!bookingId && !bookingCode) {
      return NextResponse.json({ ok: false, error: "MISSING_BOOKING_ID" }, { status: 400 });
    }

    if (!Number.isFinite(proposedFare) || proposedFare < 0) {
      return NextResponse.json({ ok: false, error: "INVALID_PROPOSED_FARE" }, { status: 400 });
    }

    let selectQuery = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id, proposed_fare, passenger_fare_response")
      .limit(1);

    selectQuery = bookingId
      ? selectQuery.eq("id", bookingId)
      : selectQuery.eq("booking_code", bookingCode);

    const { data: bookingRows, error: bookingError } = await selectQuery;

    if (bookingError) {
      return NextResponse.json(
        { ok: false, error: "DB_SELECT_ERROR", message: bookingError.message },
        { status: 500 }
      );
    }

    const booking = bookingRows?.[0] as any;
    if (!booking?.id) {
      return NextResponse.json({ ok: false, error: "BOOKING_NOT_FOUND" }, { status: 404 });
    }

    const currentStatus = normalizeStatus(booking.status);
    if (currentStatus && !ALLOWED_STATUSES.has(currentStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: "NOT_ALLOWED",
          message: "Booking status not allowed for fare proposal.",
          status: currentStatus,
        },
        { status: 409 }
      );
    }

    const currentDriverId = pickFirstString([booking.driver_id]);
    const currentAssignedDriverId = pickFirstString([booking.assigned_driver_id]);

    if (
      requestedDriverId &&
      currentAssignedDriverId &&
      requestedDriverId !== currentAssignedDriverId &&
      currentStatus !== "pending"
    ) {
      return NextResponse.json(
        {
          ok: false,
          error: "DRIVER_MISMATCH",
          message: "Requested driver does not match the booking's assigned driver.",
          booking_driver_id: currentDriverId || null,
          assigned_driver_id: currentAssignedDriverId || null,
          requested_driver_id: requestedDriverId,
        },
        { status: 409 }
      );
    }

    const effectiveDriverId = pickFirstString([
      requestedDriverId,
      currentAssignedDriverId,
      currentDriverId,
    ]);

    const updatePayload: Record<string, any> = {
      proposed_fare: proposedFare,
      passenger_fare_response: null,
      status: "fare_proposed",
    };

    if (effectiveDriverId) {
      updatePayload.driver_id = effectiveDriverId;
      updatePayload.assigned_driver_id = effectiveDriverId;
    }

    const { error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", booking.id);

    if (updateError) {
      return NextResponse.json(
        {
          ok: false,
          error: "DB_UPDATE_ERROR",
          message: updateError.message,
          payload: updatePayload,
        },
        { status: 500 }
      );
    }

    const { data: rereadRows, error: rereadError } = await supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id, proposed_fare, passenger_fare_response, updated_at")
      .eq("id", booking.id)
      .limit(1);

    if (rereadError) {
      return NextResponse.json(
        { ok: false, error: "DB_REREAD_ERROR", message: rereadError.message },
        { status: 500 }
      );
    }

    const updated = rereadRows?.[0] as any;

    return NextResponse.json(
      {
        ok: true,
        booking_id: updated?.id ?? booking.id,
        booking_code: updated?.booking_code ?? booking.booking_code,
        driver_id: updated?.driver_id ?? effectiveDriverId ?? null,
        assigned_driver_id: updated?.assigned_driver_id ?? effectiveDriverId ?? null,
        proposed_fare: updated?.proposed_fare ?? proposedFare,
        passenger_fare_response: updated?.passenger_fare_response ?? null,
        status: updated?.status ?? "fare_proposed",
        canonical_route: "driver/fare/propose",
      },
      { status: 200 }
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: "SERVER_ERROR", message: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}