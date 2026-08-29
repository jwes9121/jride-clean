import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveDriverRequest } from "@/lib/driver/resolveDriverRequest";
import {
  nativeDriverTestAuthorized,
  nativeTestJson,
  nativeTestOrderCode,
} from "../_lib";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

export async function POST(req: Request) {
  if (!nativeDriverTestAuthorized(req)) {
    return nativeTestJson(404, { ok: false, error: "NATIVE_TEST_NOT_AVAILABLE" });
  }

  const body = await req.json().catch(() => ({}));
  const explicitDriverId = text(body?.driver_id || body?.driverId);
  const identity = await resolveDriverRequest(req, explicitDriverId);
  if (!identity.ok || !identity.driverId) {
    return nativeTestJson(identity.status || 401, { ok: false, error: identity.error || "NOT_AUTHED" });
  }

  const driverId = identity.driverId;
  const orderCode = nativeTestOrderCode(driverId);
  const admin = supabaseAdmin();

  const orderRes = await admin
    .from("agrimarket_orders")
    .select("id,producer_id,pricing_snapshot")
    .eq("order_code", orderCode)
    .limit(1)
    .maybeSingle();

  if (orderRes.error) {
    return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_CLEANUP_LOOKUP_FAILED", message: orderRes.error.message });
  }
  if (!orderRes.data) {
    return nativeTestJson(200, { ok: true, cleaned: false, message: "No native test fixture found." });
  }

  const order: any = orderRes.data;
  const snapshot = order.pricing_snapshot && typeof order.pricing_snapshot === "object" ? order.pricing_snapshot : {};
  if (snapshot?.native_driver_test !== true || text(snapshot?.native_test_driver_id) !== driverId) {
    return nativeTestJson(403, { ok: false, error: "NATIVE_TEST_FIXTURE_TAG_MISMATCH" });
  }

  const producerId = text(order.producer_id);
  const deleteOrder = await admin.from("agrimarket_orders").delete().eq("id", order.id);
  if (deleteOrder.error) {
    return nativeTestJson(500, { ok: false, error: "NATIVE_TEST_ORDER_CLEANUP_FAILED", message: deleteOrder.error.message });
  }

  if (producerId) {
    const producerRead = await admin
      .from("agrimarket_producers")
      .select("id,contact_name")
      .eq("id", producerId)
      .limit(1)
      .maybeSingle();
    if (!producerRead.error && producerRead.data && text((producerRead.data as any).contact_name) === "JRide TEST Farmer - DO NOT PAY") {
      await admin.from("agrimarket_producers").delete().eq("id", producerId);
    }
  }

  return nativeTestJson(200, {
    ok: true,
    cleaned: true,
    order_code: orderCode,
    native_driver_test: true,
  });
}
