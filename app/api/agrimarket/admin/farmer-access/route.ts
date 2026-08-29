import { randomInt } from "crypto";
import { NextRequest } from "next/server";
import {
  createServiceSupabase,
  jsonNoStore,
  requireAgrimarketStaff,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

const VALID_ACTIONS = new Set(["reset_pin", "revoke_access", "suspend_farmer", "reactivate_farmer"]);

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function temporaryPin(): string {
  return String(randomInt(100000, 1000000));
}

export async function POST(req: NextRequest) {
  const staff = await requireAgrimarketStaff(true);
  if (staff.ok === false) return staff.response;

  try {
    const body = await req.json().catch(() => ({}));
    const producerId = text(body?.producer_id || body?.producerId);
    const action = text(body?.action).toLowerCase();
    const reason = text(body?.reason).slice(0, 1000) || null;

    if (!isUuid(producerId)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_PRODUCER_ID_INVALID",
        message: "A valid Agrimarket producer ID is required.",
      });
    }

    if (!VALID_ACTIONS.has(action)) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_FARMER_ACCESS_ACTION_INVALID",
      });
    }

    if ((action === "revoke_access" || action === "suspend_farmer") && !reason) {
      return jsonNoStore(400, {
        ok: false,
        error: "AGRIMARKET_FARMER_ACCESS_REASON_REQUIRED",
        message: "Enter a reason before suspending or revoking farmer access.",
      });
    }

    const newPin = action === "reset_pin" ? temporaryPin() : null;
    const admin = createServiceSupabase();
    const actionRes = await admin.rpc("agrimarket_admin_manage_farmer_access_v1", {
      p_producer_id: producerId,
      p_action: action,
      p_actor: staff.actor,
      p_reason: reason,
      p_new_pin: newPin,
      p_now: new Date().toISOString(),
    });

    if (actionRes.error) {
      const message = String(actionRes.error.message || "");
      const status = message.includes("NOT_FOUND") ? 404 : message.includes("RESET_PIN_REQUIRED") ? 409 : 400;
      return jsonNoStore(status, {
        ok: false,
        error: "AGRIMARKET_FARMER_ACCESS_ACTION_FAILED",
        message,
      });
    }

    const rows = Array.isArray(actionRes.data) ? actionRes.data : [];
    const result: any = rows[0] || actionRes.data || null;

    return jsonNoStore(200, {
      ok: true,
      result,
      credential: action === "reset_pin"
        ? {
            access_code: result?.access_code || null,
            temporary_pin: newPin,
            pin_visible_once: true,
          }
        : null,
      farmer_wallet_enabled: false,
      marketplace_fee_percent: 0,
    });
  } catch (error: any) {
    return jsonNoStore(500, {
      ok: false,
      error: "AGRIMARKET_FARMER_ACCESS_ACTION_FAILED",
      message: String(error?.message || error),
    });
  }
}
