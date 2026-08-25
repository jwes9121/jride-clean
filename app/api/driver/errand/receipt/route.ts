import { NextResponse } from "next/server";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  createErrandReceiptSignedUrl,
  errandFeatureEnabled,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function positiveInt(value: unknown): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return Math.floor(parsed);
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

export async function GET(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const url = new URL(req.url);
    const bookingId = text(url.searchParams.get("booking_id"));
    const sequence = positiveInt(url.searchParams.get("sequence"));
    const identity = await resolveDriverRequest(
      req,
      text(url.searchParams.get("driver_id"))
    );

    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    if (!bookingId || sequence == null) {
      return NextResponse.json(
        { ok: false, error: "BOOKING_AND_STOP_SEQUENCE_REQUIRED" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);
    if (!bundle.ok) {
      return NextResponse.json(
        { ok: false, error: bundle.error },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const assignedDriverId = text(
      (bundle.booking as any).assigned_driver_id ||
        (bundle.booking as any).driver_id
    );
    if (assignedDriverId !== identity.driverId) {
      return NextResponse.json(
        { ok: false, error: "DRIVER_NOT_ASSIGNED" },
        { status: 403, headers: noStoreHeaders() }
      );
    }

    const stop = bundle.stops.find(
      (row: any) => Number(row?.sequence) === sequence
    );
    const receiptPath = text((stop as any)?.receipt_photo_url);
    if (!stop || !receiptPath) {
      return NextResponse.json(
        { ok: false, error: "RECEIPT_NOT_FOUND" },
        { status: 404, headers: noStoreHeaders() }
      );
    }

    const signed = await createErrandReceiptSignedUrl(receiptPath, 600);
    if (!signed.ok) {
      return NextResponse.json(
        { ok: false, error: signed.error },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    return NextResponse.json(
      {
        ok: true,
        booking_id: bookingId,
        sequence,
        signed_url: signed.signedUrl,
        expires_in_seconds: signed.expiresInSeconds,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "DRIVER_RECEIPT_VIEW_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
