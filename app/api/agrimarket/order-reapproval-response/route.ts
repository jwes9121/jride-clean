import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketPassenger,
} from "../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const passengerAuth = await requireAgrimarketPassenger(req);
    if (passengerAuth.ok === false) return passengerAuth.response;

    const body = await req.json().catch(() => ({}));
    const orderCode = String(body?.order_code || body?.orderCode || "").trim();
    const response = String(body?.response || "").trim().toLowerCase();

    if (!orderCode) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_ORDER_CODE_REQUIRED",
      });
    }

    if (response !== "accept" && response !== "reject") {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_INVALID_REAPPROVAL_RESPONSE",
        message: "response must be accept or reject.",
      });
    }

    const admin = createServiceSupabase();
    const actionRes = await admin.rpc(
      "agrimarket_customer_respond_reapproval_v1",
      {
        p_order_code: orderCode,
        p_customer_user_id: passengerAuth.user.id,
        p_response: response,
        p_now: new Date().toISOString(),
      }
    );

    if (actionRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_REAPPROVAL_RESPONSE_FAILED",
        message: actionRes.error.message,
      });
    }

    const result: any = actionRes.data || null;
    if (result?.ok === false) {
      const code = String(
        result.error || "AGRIMARKET_REAPPROVAL_RESPONSE_FAILED"
      );
      const status = code.includes("NOT_FOUND")
        ? 404
        : code.includes("INVALID")
          ? 400
          : 409;
      return jsonNoStore(status, { ok: false, error: code, result });
    }

    return jsonNoStore(200, {
      ok: true,
      result,
      rejected_revision_cancels_order: response === "reject",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_REAPPROVAL_RESPONSE_FAILED",
      message: String(error?.message || error),
    });
  }
}