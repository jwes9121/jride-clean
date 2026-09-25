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
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) {
    return jsonNoStore(403, { ok: false, error: "AGRIMARKET_ORIGIN_INVALID" });
  }
  const passenger = await requireAgrimarketPassenger(req);
  if (passenger.ok === false) return passenger.response;

  const body = await req.json().catch(() => ({}));
  const orderCode = String(body?.order_code || "").trim();
  const expectedTotal = Number(body?.expected_total);
  if (!orderCode || body?.expected_vehicle !== "motorcycle" ||
      body?.expected_total == null || !Number.isFinite(expectedTotal) || expectedTotal < 0) {
    return jsonNoStore(400, { ok: false, error: "AGRIMARKET_VEHICLE_SWITCH_REVISION_REQUIRED" });
  }

  const action = await createServiceSupabase().rpc("agrimarket_customer_switch_to_tricycle_v1", {
    p_order_code: orderCode,
    p_customer_user_id: passenger.user.id,
    p_expected_vehicle: "motorcycle",
    p_expected_total: expectedTotal,
  });
  if (action.error) {
    return jsonNoStore(503, { ok: false, error: "AGRIMARKET_VEHICLE_SWITCH_FAILED" });
  }
  const result = action.data as { ok?: boolean; error?: string } | null;
  if (!result?.ok) {
    const code = result?.error || "AGRIMARKET_VEHICLE_SWITCH_FAILED";
    return jsonNoStore(code === "AGRIMARKET_ORDER_NOT_FOUND" ? 404 : 409, { ok: false, error: code });
  }
  return jsonNoStore(200, { ok: true, result });
}
