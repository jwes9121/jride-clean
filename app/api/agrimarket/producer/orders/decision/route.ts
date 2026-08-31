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
    const preparationMinutesRaw = body?.preparation_minutes ?? body?.preparationMinutes;
    const preparationMinutes =
      preparationMinutesRaw === null || preparationMinutesRaw === undefined || preparationMinutesRaw === ""
        ? null
        : Number(preparationMinutesRaw);
    const confirmedCargoWeightRaw = body?.confirmed_cargo_weight_kg ?? body?.confirmedCargoWeightKg;
    const confirmedCargoWeightKg =
      confirmedCargoWeightRaw === null || confirmedCargoWeightRaw === undefined || confirmedCargoWeightRaw === ""
        ? null
        : Number(confirmedCargoWeightRaw);
    const confirmedHandlingTier =
      String(body?.confirmed_handling_tier || body?.confirmedHandlingTier || "").trim().toLowerCase() || null;

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

    if (
      preparationMinutes != null &&
      (!Number.isInteger(preparationMinutes) || preparationMinutes < 0 || preparationMinutes > 1440)
    ) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_PREPARATION_MINUTES_INVALID",
        message: "preparation_minutes must be from 0 to 1440 when supplied.",
      });
    }

    if (confirmedCargoWeightKg != null && (!Number.isFinite(confirmedCargoWeightKg) || confirmedCargoWeightKg <= 0)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_CONFIRMED_CARGO_WEIGHT_INVALID",
      });
    }

    if (
      confirmedHandlingTier != null &&
      !new Set(["standard", "bulky", "live_single", "live_difficult"]).has(confirmedHandlingTier)
    ) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_INVALID_HANDLING_TIER",
      });
    }

    const admin = createServiceSupabase();
    const decisionRes = await admin.rpc("agrimarket_producer_decide_order_v5", {
      p_order_code: orderCode,
      p_producer_id: producerAuth.producer.id,
      p_decision: decision,
      p_preparation_minutes: decision === "accept" ? preparationMinutes : null,
      p_reason: reason,
      p_confirmed_cargo_weight_kg: decision === "accept" ? confirmedCargoWeightKg : null,
      p_confirmed_handling_tier: decision === "accept" ? confirmedHandlingTier : null,
      p_now: new Date().toISOString(),
    });

    if (decisionRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_DECISION_FAILED",
        message: decisionRes.error.message,
      });
    }

    const result: any = decisionRes.data || null;
    if (result?.ok === false) {
      const code = String(result.error || "AGRIMARKET_PRODUCER_DECISION_FAILED");
      const status = code.includes("NOT_FOUND")
        ? 404
        : code.includes("NOT_OWNED")
          ? 403
          : code.includes("AUTH_REQUIRED")
            ? 401
            : code.includes("INVALID") || code.includes("REQUIRED") || code.includes("HANDLING_TIER") || code.includes("PREPARATION_MINUTES")
              ? 400
              : 409;
      return jsonNoStore(status, { ok: false, error: code, order: result });
    }

    return jsonNoStore(200, {
      ok: true,
      order: result,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_PRODUCER_DECISION_FAILED",
      message: String(error?.message || error),
    });
  }
}
