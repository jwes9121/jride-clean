import { NextRequest } from "next/server";
import {
  agrimarketDisabledResponse,
  agrimarketEnabled,
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketProducer,
} from "../../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const producerAuth = await requireAgrimarketProducer(req);
    if (producerAuth.ok === false) return producerAuth.response;

    const body = await req.json().catch(() => ({}));
    const orderCode = String(body?.order_code || body?.orderCode || "").trim();
    const decision = String(body?.decision || "").trim().toLowerCase();
    const reason = String(body?.reason || "").trim() || null;

    if (!orderCode) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_ORDER_CODE_REQUIRED",
        message: "order_code is required.",
      });
    }

    if (decision !== "accept" && decision !== "reject") {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_INVALID_PRODUCER_DECISION",
        message: "decision must be accept or reject.",
      });
    }

    const admin = createServiceSupabase();
    const decisionRes = await admin.rpc("agrimarket_producer_decide_order_v1", {
      p_order_code: orderCode,
      p_vendor_account_id: producerAuth.vendorId,
      p_decision: decision,
      p_reason: reason,
      p_now: new Date().toISOString(),
    });

    if (decisionRes.error) {
      const message = String(decisionRes.error.message || "");
      const status = message.includes("NOT_FOUND")
        ? 404
        : message.includes("NOT_OWNED")
          ? 403
          : message.includes("AUTH_REQUIRED")
            ? 401
            : message.includes("INVALID_PRODUCER_DECISION")
              ? 400
              : 409;

      return jsonNoStore(status, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_DECISION_FAILED",
        message,
      });
    }

    const rows = Array.isArray(decisionRes.data) ? decisionRes.data : [];
    const order = rows[0] || decisionRes.data || null;

    return jsonNoStore(200, {
      ok: true,
      order,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_DECISION_FAILED",
      message: String(error?.message || error),
    });
  }
}
