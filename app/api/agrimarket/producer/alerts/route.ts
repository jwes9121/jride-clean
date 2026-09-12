import { NextRequest } from "next/server";
import { createServiceSupabase, jsonNoStore, requireAgrimarketProducer, agrimarketFarmerPortalEnabled } from "../../_lib/server";
import { validPushEndpoint, validPushKeys } from "@/lib/agrimarket/browserAlerts";
import { browserPushConfig } from "@/lib/agrimarket/browserPushServer";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

function sameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  return !origin || origin === req.nextUrl.origin;
}

export async function GET(req: NextRequest) {
  if (!agrimarketFarmerPortalEnabled()) return jsonNoStore(503, { ok: false, error: "AGRIMARKET_DISABLED" });
  const auth = await requireAgrimarketProducer(req);
  if (!auth.ok) return auth.response;
  const db = createServiceSupabase();
  const now = new Date().toISOString();
  const orders = await db.from("agrimarket_orders").select("order_code,producer_confirm_expires_at")
    .eq("producer_id", auth.producer.id).eq("status", "awaiting_producer")
    .gt("producer_confirm_expires_at", now).order("producer_confirm_expires_at").limit(100);
  if (orders.error) return jsonNoStore(503, { ok: false, error: "ALERT_FEED_UNAVAILABLE" });
  let config = null;
  try { config = await browserPushConfig(db); } catch { /* Foreground alerts remain usable. */ }
  const subscriptionId = req.nextUrl.searchParams.get("subscription_id");
  let subscription = null;
  if (subscriptionId && /^[a-f0-9-]{36}$/i.test(subscriptionId)) {
    const state = await db.rpc("agrimarket_browser_status_v1", { p_producer_id: auth.producer.id, p_subscription_id: subscriptionId });
    if (!state.error) subscription = state.data;
  }
  return jsonNoStore(200, { ok: true, server_time: now, producer_id: auth.producer.id, orders: orders.data || [],
    push_available: Boolean(config), public_key: config?.public_key || null, subscription });
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return jsonNoStore(403, { ok: false, error: "ORIGIN_NOT_ALLOWED" });
  if (!agrimarketFarmerPortalEnabled()) return jsonNoStore(503, { ok: false, error: "AGRIMARKET_DISABLED" });
  const auth = await requireAgrimarketProducer(req);
  if (!auth.ok) return auth.response;
  const raw = await req.text();
  if (raw.length > 8192) return jsonNoStore(413, { ok: false, error: "REQUEST_TOO_LARGE" });
  let body: any;
  try { body = JSON.parse(raw); } catch { return jsonNoStore(400, { ok: false, error: "INVALID_JSON" }); }
  const db = createServiceSupabase();
  try {
    if (body.action === "subscribe") {
      const sub = body.subscription;
      if (!validPushEndpoint(sub?.endpoint) || !validPushKeys(sub?.keys)) {
        return jsonNoStore(400, { ok: false, error: "INVALID_PUSH_SUBSCRIPTION" });
      }
      if (!await browserPushConfig(db)) return jsonNoStore(503, { ok: false, error: "PUSH_NOT_CONFIGURED" });
      const result = await db.rpc("agrimarket_browser_subscribe_v1", { p_producer_id: auth.producer.id,
        p_endpoint: sub.endpoint, p_p256dh: sub.keys.p256dh, p_auth: sub.keys.auth });
      if (result.error) return jsonNoStore(409, { ok: false, error: "SUBSCRIPTION_NOT_SAVED",
        message: "Could not enable this browser. It may be linked to another farm or the device limit was reached." });
      return jsonNoStore(200, { ok: true, subscription: result.data });
    }
    if (!["test", "unsubscribe"].includes(body.action) || !/^[a-f0-9-]{36}$/i.test(body.subscription_id || "")) {
      return jsonNoStore(400, { ok: false, error: "INVALID_ALERT_ACTION" });
    }
    const result = await db.rpc("agrimarket_browser_action_v1", { p_producer_id: auth.producer.id,
      p_subscription_id: body.subscription_id, p_action: body.action });
    if (result.error) return jsonNoStore(409, { ok: false, error: "ALERT_ACTION_UNAVAILABLE",
      message: "Enable this browser first. Wait one minute between test notifications." });
    return jsonNoStore(200, { ok: true, result: result.data });
  } catch { return jsonNoStore(503, { ok: false, error: "ALERT_SERVICE_UNAVAILABLE" }); }
}
