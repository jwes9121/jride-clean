import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { agrimarketEnabled } from "@/app/api/agrimarket/_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function headers() {
  return {
    "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
    Pragma: "no-cache",
  };
}

function statusForError(error: string): number {
  if (error.includes("NOT_FOUND")) return 404;
  if (error.includes("NOT_ASSIGNED") || error.includes("NOT_AUTHED")) return 403;
  if (
    error.includes("WRONG_STATUS") ||
    error.includes("REQUIRED_BEFORE") ||
    error.includes("COLLECT_CUSTOMER_CASH_FIRST") ||
    error.includes("FARMER_PAYMENT_REQUIRED") ||
    error.includes("CUSTOMER_CASH_REQUIRED") ||
    error.includes("CHECK_REQUIRED") ||
    error.includes("HANDLING_FEE_LOCKED") ||
    error.includes("SETTLEMENT_NOT_DUE")
  ) {
    return 409;
  }
  if (
    error.includes("INVALID") ||
    error.includes("MISMATCH") ||
    error.includes("REQUIRED") ||
    error.includes("NOT_ELIGIBLE") ||
    error.includes("UNKNOWN_DRIVER_ACTION")
  ) {
    return 400;
  }
  return 409;
}

export async function POST(req: Request) {
  if (!agrimarketEnabled()) {
    return NextResponse.json(
      { ok: false, error: "AGRIMARKET_DISABLED" },
      { status: 503, headers: headers() }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const orderCode = text(body?.order_code || body?.orderCode);
    const action = text(body?.action).toLowerCase();
    const payload = body?.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? body.payload
      : Object.fromEntries(
          Object.entries(body || {}).filter(
            ([key]) => !["order_code", "orderCode", "action", "driver_id", "driverId"].includes(key)
          )
        );

    if (!orderCode || !action) {
      return NextResponse.json(
        {
          ok: false,
          error: "AGRIMARKET_ORDER_CODE_AND_ACTION_REQUIRED",
          message: "order_code and action are required.",
        },
        { status: 400, headers: headers() }
      );
    }

    const identity = await resolveDriverRequest(
      req,
      text(body?.driver_id || body?.driverId)
    );
    if (!identity.ok || !identity.driverId) {
      return NextResponse.json(
        { ok: false, error: identity.error || "NOT_AUTHED" },
        { status: identity.status || 401, headers: headers() }
      );
    }

    const admin = supabaseAdmin();
    const resultRes = await admin.rpc("agrimarket_driver_execute_v1", {
      p_order_code: orderCode,
      p_driver_id: identity.driverId,
      p_action: action,
      p_payload: payload,
      p_now: new Date().toISOString(),
    });

    if (resultRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "AGRIMARKET_DRIVER_ACTION_RPC_FAILED",
          message: resultRes.error.message,
        },
        { status: 500, headers: headers() }
      );
    }

    const result: any = resultRes.data || {};
    if (result.ok === false) {
      const error = text(result.error) || "AGRIMARKET_DRIVER_ACTION_BLOCKED";
      return NextResponse.json(
        { ...result, ok: false },
        { status: statusForError(error), headers: headers() }
      );
    }

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
      },
      { status: 200, headers: headers() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "AGRIMARKET_DRIVER_ACTION_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: headers() }
    );
  }
}
