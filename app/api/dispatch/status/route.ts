import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

type DispatchStatusBody = {
  bookingId?: string | null;
  bookingCode?: string | null;
  status?: string | null;
  driverId?: string | null;
};

const CANONICAL_LIFECYCLE_STATUSES = new Set<string>([
  "requested",
  "searching",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
  "cancelled",
]);

function normalizeStatus(input: unknown): string {
  return String(input ?? "").trim().toLowerCase();
}

function pickBookingKey(body: DispatchStatusBody) {
  const bookingId = String(body.bookingId ?? "").trim();
  const bookingCode = String(body.bookingCode ?? "").trim();
  return { bookingId, bookingCode };
}

export async function POST(req: Request) {
  try {
    const supabase = supabaseAdmin();
    const body = (await req.json().catch(() => ({}))) as DispatchStatusBody;

    const { bookingId, bookingCode } = pickBookingKey(body);
    const normalizedStatus = normalizeStatus(body.status);
    const requestedDriverId = String(body.driverId ?? "").trim() || null;

    if (!bookingId && !bookingCode) {
      return NextResponse.json(
        { ok: false, code: "BOOKING_KEY_REQUIRED", message: "Missing bookingId or bookingCode." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!normalizedStatus) {
      return NextResponse.json(
        { ok: false, code: "STATUS_REQUIRED", message: "Missing status." },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    if (!CANONICAL_LIFECYCLE_STATUSES.has(normalizedStatus)) {
      return NextResponse.json(
        {
          ok: false,
          code: "INVALID_STATUS",
          message: `Unsupported lifecycle status: ${normalizedStatus}`,
        },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    let bookingQuery = supabase
      .from("bookings")
      .select("id, booking_code, status, driver_id, assigned_driver_id, assigned_at, updated_at")
      .limit(1);

    if (bookingId) {
      bookingQuery = bookingQuery.eq("id", bookingId);
    } else {
      bookingQuery = bookingQuery.eq("booking_code", bookingCode);
    }

    const { data: booking, error: bookingError } = await bookingQuery.single();

    if (bookingError || !booking) {
      return NextResponse.json(
        {
          ok: false,
          code: "BOOKING_NOT_FOUND",
          message: bookingError?.message || "Booking not found.",
        },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const existingDriverId =
      String((booking as any).driver_id ?? "").trim() ||
      String((booking as any).assigned_driver_id ?? "").trim() ||
      null;

    const effectiveDriverId = requestedDriverId || existingDriverId || null;

    const updatePayload: Record<string, any> = {
      status: normalizedStatus,
      updated_at: new Date().toISOString(),
    };

    // Lifecycle ownership only:
    // - assignment should already be handled by /api/dispatch/assign
    // - but preserve driver linkage for accepted/fare/later lifecycle statuses
    if (
      effectiveDriverId &&
      [
        "assigned",
        "accepted",
        "fare_proposed",
        "ready",
        "on_the_way",
        "arrived",
        "on_trip",
        "completed",
      ].includes(normalizedStatus)
    ) {
      updatePayload.driver_id = effectiveDriverId;
      updatePayload.assigned_driver_id = effectiveDriverId;

      if (normalizedStatus === "assigned" && !(booking as any).assigned_at) {
        updatePayload.assigned_at = new Date().toISOString();
      }
    }

    // Clear assignment on terminal cancellation/search reset states
    if (["cancelled", "searching", "requested"].includes(normalizedStatus)) {
      updatePayload.driver_id = null;
      updatePayload.assigned_driver_id = null;
      updatePayload.assigned_at = null;
    }

    const { data: updated, error: updateError } = await supabase
      .from("bookings")
      .update(updatePayload)
      .eq("id", (booking as any).id)
      .select(
        "id, booking_code, status, driver_id, assigned_driver_id, assigned_at, updated_at, proposed_fare, verified_fare"
      )
      .single();

    if (updateError) {
      const msg = String(updateError.message || "STATUS_UPDATE_FAILED");
      const lower = msg.toLowerCase();

      if (lower.includes("invalid_transition") || lower.includes("invalid transition")) {
        return NextResponse.json(
          {
            ok: false,
            code: "INVALID_TRANSITION",
            from: String((booking as any).status ?? ""),
            to: normalizedStatus,
            message: msg,
          },
          { status: 400, headers: noStoreHeaders() }
        );
      }

      return NextResponse.json(
        { ok: false, code: "STATUS_UPDATE_FAILED", message: msg },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking: updated,
        status: (updated as any)?.status ?? normalizedStatus,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        code: "DISPATCH_STATUS_UNEXPECTED",
        message: String(e?.message || e || "Unexpected error"),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}