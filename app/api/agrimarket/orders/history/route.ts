import { NextRequest } from "next/server";
import { scheduledActivity } from "@/lib/agrimarket/schedule";
import {
  agrimarketDisabledResponse, agrimarketEnabled, createServiceSupabase,
  jsonNoStore, requireAgrimarketPassenger,
} from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const PAGE_SIZE = 25;
const HISTORY = ["completed", "cancelled", "producer_rejected", "producer_timeout"];
const ACTIVE = ["awaiting_producer", "awaiting_harvest", "producer_accepted", "preparing",
  "awaiting_customer_reapproval", "ready_for_dispatch", "dispatching", "driver_assigned",
  "picked_up", "delivering", "delivered", "exception"];
const ORDER_COLUMNS = "id,producer_id,order_code,status,fulfillment_mode,harvest_expected_start_at,harvest_expected_end_at,producer_confirm_expires_at,producer_responded_at,producer_timeout_at,ready_at,preferred_vehicle_type,total_payable,cancel_reason,cancelled_at,completed_at,created_at,updated_at";
const ITEM_COLUMNS = "order_id,product_id,product_name,product_group,species,meat_cut,selling_unit,quantity,unit_price,line_total,availability_mode,harvest_start_at,harvest_end_at";

function failed() {
  return jsonNoStore(503, { ok: false, error: "AGRIMARKET_PASSENGER_ORDERS_UNAVAILABLE",
    message: "Your orders could not be loaded. Your existing orders have not been changed. Please try again." });
}

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();
  try {
    const auth = await requireAgrimarketPassenger(req);
    if (!auth.ok) return auth.response;
    const view = req.nextUrl.searchParams.get("view") || "active";
    const rawPage = req.nextUrl.searchParams.get("page") || "0";
    if (!["active", "history"].includes(view) || !/^\d{1,6}$/.test(rawPage)) {
      return jsonNoStore(400, { ok: false, error: "AGRIMARKET_ORDER_VIEW_INVALID",
        message: "Choose Active or Past orders and a valid page." });
    }
    const page = Number(rawPage), offset = page * PAGE_SIZE;
    const admin = createServiceSupabase();
    // Identity comes only from the validated passenger session, never a query parameter.
    // Expiry runs independently. Reading history must not mutate other customers' orders.
    const result = await admin.from("agrimarket_orders").select(ORDER_COLUMNS)
      .eq("customer_user_id", auth.user.id).in("status", view === "history" ? HISTORY : ACTIVE)
      .order("created_at", { ascending: false }).order("id", { ascending: false })
      .range(offset, offset + PAGE_SIZE);
    if (result.error || !Array.isArray(result.data)) return failed();
    const hasMore = result.data.length > PAGE_SIZE;
    const orders: any[] = result.data.slice(0, PAGE_SIZE);
    if (!orders.length) return jsonNoStore(200, { ok: true, view, page, page_size: PAGE_SIZE,
      has_more: false, orders: [], server_now: new Date().toISOString() });
    const ids = orders.map(row => row.id);
    const producerIds = Array.from(new Set(orders.map(row => row.producer_id)));
    const [itemsResult, storesResult] = await Promise.all([
      admin.from("agrimarket_order_items").select(ITEM_COLUMNS).in("order_id", ids)
        .order("created_at", { ascending: true }).order("id", { ascending: true }),
      admin.from("agrimarket_producers").select("id,vendor_name,town").in("id", producerIds),
    ]);
    if (itemsResult.error || storesResult.error || !Array.isArray(itemsResult.data) || !Array.isArray(storesResult.data)) return failed();
    const stores = new Map(storesResult.data.map((row: any) => [row.id, row]));
    const byOrder = new Map<string, any[]>();
    for (const row of itemsResult.data as any[]) {
      if (!ids.includes(row.order_id)) continue;
      const { order_id, ...item } = row;
      const items = byOrder.get(order_id) || [];
      items.push(item); byOrder.set(order_id, items);
    }
    return jsonNoStore(200, { ok: true, view, page, page_size: PAGE_SIZE, has_more: hasMore,
      server_now: new Date().toISOString(), orders: orders.map(row => {
        const { id, producer_id, ...order } = row;
        const store: any = stores.get(producer_id);
        const items = byOrder.get(id) || [];
        return { ...order, items, store: store ? { name: store.vendor_name || null, town: store.town || null } : null,
          scheduled_activity: row.fulfillment_mode === "scheduled_harvest" ? scheduledActivity(items) : null };
      }) });
  } catch { return failed(); }
}
