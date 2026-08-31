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

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function validIsoOrNull(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeShortfallItems(value: unknown): Array<{ product_id: string; quantity: number }> | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const seen = new Set<string>();
  const rows: Array<{ product_id: string; quantity: number }> = [];
  for (const row of value) {
    const productId = text((row as any)?.product_id || (row as any)?.productId);
    const quantity = Number((row as any)?.quantity);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(productId)) return null;
    if (!Number.isFinite(quantity) || quantity < 0 || seen.has(productId)) return null;
    seen.add(productId);
    rows.push({ product_id: productId, quantity });
  }
  return rows;
}

export async function POST(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();

  try {
    const producerAuth = await requireAgrimarketProducer(req);
    if (producerAuth.ok === false) return producerAuth.response;

    const body = await req.json().catch(() => ({}));
    const orderCode = text(body?.order_code || body?.orderCode);
    const action = text(body?.action).toLowerCase();
    const reason = text(body?.reason).slice(0, 1000) || null;
    const confirmedCargoWeightRaw = body?.confirmed_cargo_weight_kg ?? body?.confirmedCargoWeightKg;
    const confirmedCargoWeightKg =
      confirmedCargoWeightRaw === null || confirmedCargoWeightRaw === undefined || confirmedCargoWeightRaw === ""
        ? null
        : Number(confirmedCargoWeightRaw);
    const confirmedHandlingTier =
      text(body?.confirmed_handling_tier || body?.confirmedHandlingTier).toLowerCase() || null;

    if (!orderCode) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ORDER_CODE_REQUIRED" });
    }
    if (!new Set(["ready", "delay", "shortfall"]).has(action)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_INVALID_HARVEST_ACTION" });
    }

    let preparationMinutes: number | null = null;
    let proposedStartAt: string | null = null;
    let proposedEndAt: string | null = null;
    let proposedItems: Array<{ product_id: string; quantity: number }> = [];

    if (action === "ready") {
      preparationMinutes = Number(body?.preparation_minutes ?? body?.preparationMinutes);
      if (!Number.isInteger(preparationMinutes) || preparationMinutes < 0 || preparationMinutes > 1440) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_PREPARATION_MINUTES_REQUIRED",
          message: "Choose the actual preparation time after harvest is ready.",
        });
      }
      if (confirmedCargoWeightKg == null || !Number.isFinite(confirmedCargoWeightKg) || confirmedCargoWeightKg <= 0) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_CONFIRMED_CARGO_WEIGHT_REQUIRED",
          message: "Confirm the actual total cargo weight before marking the harvest ready.",
        });
      }
      if (!confirmedHandlingTier || !new Set(["standard", "bulky", "live_single", "live_difficult"]).has(confirmedHandlingTier)) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_INVALID_HANDLING_TIER",
        });
      }
    }

    if (action === "delay") {
      proposedStartAt = validIsoOrNull(body?.proposed_harvest_start_at || body?.proposedHarvestStartAt);
      proposedEndAt = validIsoOrNull(body?.proposed_harvest_end_at || body?.proposedHarvestEndAt);
      if (!proposedStartAt) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_VALID_DELAY_DATE_REQUIRED",
          message: "Enter the new expected harvest date.",
        });
      }
      if (proposedEndAt && Date.parse(proposedEndAt) < Date.parse(proposedStartAt)) {
        return jsonNoStore(400, { ok: false, error: "AGRIMARKET_INVALID_DELAY_WINDOW" });
      }
    }

    if (action === "shortfall") {
      const normalized = normalizeShortfallItems(body?.items || body?.proposed_items);
      if (!normalized) {
        return jsonNoStore(400, {
          ok: false,
          error: "AGRIMARKET_SHORTFALL_ITEMS_REQUIRED",
          message: "Enter the actual available quantity for every product in this harvest order.",
        });
      }
      proposedItems = normalized;
    }

    const admin = createServiceSupabase();
    const actionRes = await admin.rpc("agrimarket_producer_harvest_action_v2", {
      p_order_code: orderCode,
      p_producer_id: producerAuth.producer.id,
      p_action: action,
      p_preparation_minutes: preparationMinutes,
      p_proposed_start_at: proposedStartAt,
      p_proposed_end_at: proposedEndAt,
      p_proposed_items: proposedItems,
      p_reason: reason,
      p_confirmed_cargo_weight_kg: action === "ready" ? confirmedCargoWeightKg : null,
      p_confirmed_handling_tier: action === "ready" ? confirmedHandlingTier : null,
      p_now: new Date().toISOString(),
    });

    if (actionRes.error) {
      return jsonNoStore(500, {
        ok: false,
        error: "AGRIMARKET_HARVEST_ACTION_FAILED",
        message: actionRes.error.message,
      });
    }

    const result: any = actionRes.data || null;
    if (result?.ok === false) {
      const code = String(result.error || "AGRIMARKET_HARVEST_ACTION_FAILED");
      const status = code.includes("NOT_FOUND")
        ? 404
        : code.includes("NOT_OWNED")
          ? 403
          : code.includes("REQUIRED") || code.includes("INVALID")
            ? 400
            : 409;
      return jsonNoStore(status, { ok: false, error: code, result });
    }

    return jsonNoStore(200, { ok: true, result });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_HARVEST_ACTION_FAILED",
      message: String(error?.message || error),
    });
  }
}
