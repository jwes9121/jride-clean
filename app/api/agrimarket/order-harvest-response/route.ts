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
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ORDER_CODE_REQUIRED" });
    }
    if (response !== "accept" && response !== "reject") {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_INVALID_HARVEST_RESPONSE",
        message: "response must be accept or reject.",
      });
    }

    const proposalId = String(body?.proposal_id || "").trim();
    const expectedRevision = String(body?.expected_updated_at || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(proposalId) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(expectedRevision) || !Number.isFinite(Date.parse(expectedRevision))) {
      return jsonNoStore(409, {ok:false,error:"AGRIMARKET_HARVEST_REVISION_REQUIRED",message:"Refresh and review the exact farmer proposal before responding. An app update may be required."});
    }
    const admin = createServiceSupabase();
    const actionRes = await admin.rpc("agrimarket_customer_respond_harvest_v2", {
      p_order_code: orderCode,
      p_customer_user_id: passengerAuth.user.id,
      p_response: response,
      p_proposal_id: proposalId,
      p_expected_updated_at: expectedRevision,
    });

    if (actionRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_HARVEST_RESPONSE_FAILED",
        message: "Your response could not be confirmed. Refresh this reservation before retrying.",
      });
    }

    const result: any = actionRes.data || null;
    if (result?.ok === false) {
      const code = String(result.error || "AGRIMARKET_HARVEST_RESPONSE_FAILED");
      const status = code.includes("NOT_FOUND")
        ? 404
        : code.includes("INVALID")
          ? 400
          : 409;
      return jsonNoStore(status, { ok: false, error: code, message: "This proposal changed or is no longer pending. Refresh and review the current details. Your response was not applied to a different proposal." });
    }

    return jsonNoStore(200, {
      ok: true,
      result,
      rejected_change_cancels_order: response === "reject",
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_HARVEST_RESPONSE_FAILED",
      message: "Your response could not be confirmed. Refresh this reservation before retrying.",
    });
  }
}
