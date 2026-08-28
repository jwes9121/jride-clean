import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import { offerAgrimarketDriver } from "@/lib/agrimarket/dispatch";
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

export async function POST(req: Request) {
  if (!agrimarketEnabled()) {
    return NextResponse.json(
      { ok: false, error: "AGRIMARKET_DISABLED" },
      { status: 503, headers: headers() }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const offerId = text(body?.offer_id || body?.offerId);
    const decision = text(body?.decision).toLowerCase();
    const reason = text(body?.reason || body?.reason_code) || null;

    if (!offerId || (decision !== "accept" && decision !== "decline")) {
      return NextResponse.json(
        {
          ok: false,
          error: "AGRIMARKET_OFFER_ID_AND_DECISION_REQUIRED",
          message: "offer_id and decision accept or decline are required.",
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
    const offerRead = await admin
      .from("agrimarket_driver_offers")
      .select("id,order_id,driver_id")
      .eq("id", offerId)
      .eq("driver_id", identity.driverId)
      .limit(1)
      .maybeSingle();

    if (offerRead.error) {
      return NextResponse.json(
        { ok: false, error: "AGRIMARKET_DRIVER_OFFER_READ_FAILED", message: offerRead.error.message },
        { status: 500, headers: headers() }
      );
    }
    if (!offerRead.data) {
      return NextResponse.json(
        { ok: false, error: "AGRIMARKET_DRIVER_OFFER_NOT_FOUND" },
        { status: 404, headers: headers() }
      );
    }

    const resultRes = await admin.rpc("agrimarket_driver_decide_offer_v1", {
      p_offer_id: offerId,
      p_driver_id: identity.driverId,
      p_decision: decision,
      p_reason: reason,
      p_now: new Date().toISOString(),
    });

    if (resultRes.error) {
      return NextResponse.json(
        {
          ok: false,
          error: "AGRIMARKET_DRIVER_DECISION_RPC_FAILED",
          message: resultRes.error.message,
        },
        { status: 500, headers: headers() }
      );
    }

    const result = (resultRes.data as any) || {};
    if (result.ok === false) {
      const error = text(result.error) || "AGRIMARKET_DRIVER_DECISION_BLOCKED";
      const status = error.includes("NOT_FOUND")
        ? 404
        : error.includes("EXPIRED") || error.includes("ALREADY_ASSIGNED") || error.includes("NOT_DRIVER_ASSIGNABLE")
          ? 409
          : 403;
      return NextResponse.json(
        { ...result, ok: false },
        { status, headers: headers() }
      );
    }

    let reassignment: any = null;
    if (decision === "decline") {
      reassignment = await offerAgrimarketDriver({
        orderId: text((offerRead.data as any).order_id),
      });
    }

    return NextResponse.json(
      {
        ...result,
        ok: true,
        auth_mode: identity.authMode,
        reassignment,
        next: decision === "accept" ? "fetch_current_agrimarket_order" : undefined,
      },
      { status: 200, headers: headers() }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "AGRIMARKET_DRIVER_DECISION_UNEXPECTED_ERROR",
        message: String(error?.message || error),
      },
      { status: 500, headers: headers() }
    );
  }
}
