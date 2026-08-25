import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  errandFeatureEnabled,
  errandPabiliAccounting,
  loadErrandBundleByBookingId,
} from "@/lib/errand/server";

type PabiliActionBody = {
  action?: string;
  booking_id?: string;
  bookingId?: string;
  driver_id?: string;
  driverId?: string;
  amount?: number | string | null;
  confirmation_method?: string | null;
  note?: string | null;
};

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function noStoreHeaders() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
    Pragma: "no-cache",
    Expires: "0",
  };
}

function blockedStatus(error: string): number {
  if (error === "DRIVER_NOT_ASSIGNED") return 403;
  if (error === "BOOKING_NOT_FOUND" || error === "ERRAND_JOB_NOT_FOUND") return 404;
  if (error.includes("REQUIRED") || error.includes("INVALID")) return 400;
  return 409;
}

export async function POST(req: Request) {
  try {
    if (!errandFeatureEnabled()) {
      return NextResponse.json(
        { ok: false, error: "ERRAND_BOOKING_NOT_ENABLED" },
        { status: 503, headers: noStoreHeaders() }
      );
    }

    const body = (await req.json().catch(() => ({}))) as PabiliActionBody;
    const bookingId = text(body.booking_id || body.bookingId);
    const action = text(body.action).toLowerCase();
    const amount = num(body.amount);

    if (!bookingId || !action) {
      return NextResponse.json(
        { ok: false, error: "MISSING_ACTION_OR_BOOKING" },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const identity = await resolveDriverRequest(
      req,
      text(body.driver_id || body.driverId)
    );

    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: noStoreHeaders() }
      );
    }

    const admin = supabaseAdmin();
    let rpcName = "";
    let rpcArgs: Record<string, unknown> = {};

    if (action === "record_remote_topup") {
      if (amount == null || amount <= 0) {
        return NextResponse.json(
          { ok: false, error: "REMOTE_TOPUP_AMOUNT_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }

      rpcName = "errand_driver_record_remote_topup_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
        p_amount: amount,
        p_confirmation_method: text(body.confirmation_method) || "phone",
        p_note: text(body.note) || null,
      };
    } else if (action === "record_change_returned") {
      if (amount == null || amount < 0) {
        return NextResponse.json(
          { ok: false, error: "CHANGE_RETURNED_AMOUNT_REQUIRED" },
          { status: 400, headers: noStoreHeaders() }
        );
      }

      rpcName = "errand_driver_record_change_returned_v1";
      rpcArgs = {
        p_booking_id: bookingId,
        p_driver_id: identity.driverId,
        p_amount: amount,
      };
    } else {
      return NextResponse.json(
        { ok: false, error: "UNKNOWN_PABILI_ACTION", action },
        { status: 400, headers: noStoreHeaders() }
      );
    }

    const { data, error } = await admin.rpc(rpcName, rpcArgs);
    if (error) {
      return NextResponse.json(
        { ok: false, error: "PABILI_ACTION_RPC_FAILED", message: error.message },
        { status: 500, headers: noStoreHeaders() }
      );
    }

    const result = (data as any) || {};
    if (result.ok === false) {
      const err = text(result.error) || "PABILI_ACTION_BLOCKED";
      return NextResponse.json(
        result,
        { status: blockedStatus(err), headers: noStoreHeaders() }
      );
    }

    const bundle = await loadErrandBundleByBookingId(bookingId);

    return NextResponse.json(
      {
        ...result,
        ok: true,
        pabili: bundle.ok
          ? errandPabiliAccounting(
              bundle.job,
              bundle.stops,
              bundle.pabiliFundEvents
            )
          : null,
      },
      { status: 200, headers: noStoreHeaders() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PABILI_ACTION_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: noStoreHeaders() }
    );
  }
}
