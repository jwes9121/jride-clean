import { NextRequest } from "next/server";
import { scheduledActivity } from "@/lib/agrimarket/schedule";
import { customerDispatchWait } from "@/lib/agrimarket/dispatchWait";
import { agrimarketDisabledResponse, agrimarketEnabled, createServiceSupabase,
  jsonNoStore, requireAgrimarketPassenger } from "../../_lib/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";
const VIEWS = ["deliveries", "reservations", "history"];
const unavailable = () => jsonNoStore(503, { ok: false, error: "AGRIMARKET_PASSENGER_ORDERS_UNAVAILABLE",
  message: "Your orders could not be refreshed. Existing orders have not been changed. Please try again." });

export async function GET(req: NextRequest) {
  if (!agrimarketEnabled()) return agrimarketDisabledResponse();
  try {
    const auth = await requireAgrimarketPassenger(req);
    if (!auth.ok) return auth.response;
    const view = req.nextUrl.searchParams.get("view") || "deliveries";
    const rawPage = req.nextUrl.searchParams.get("page") || "0";
    if (!VIEWS.includes(view) || !/^\d{1,6}$/.test(rawPage)) return jsonNoStore(400, {
      ok: false, error: "AGRIMARKET_ORDER_VIEW_INVALID", message: "Choose a valid order section and page." });
    const admin = createServiceSupabase();
    const result = await admin.rpc("agrimarket_passenger_order_sections_v1", {
      p_customer_user_id: auth.user.id, p_view: view, p_page: Number(rawPage),
    });
    const data = result.data;
    if (result.error || !data || data.ok !== true || data.layout !== "sections_v1" || data.view !== view ||
      !Array.isArray(data.orders) || !data.counts ||
      ![data.page, data.total_count, data.active_count, ...Object.values(data.counts)].every(n => Number.isInteger(n) && Number(n) >= 0)) return unavailable();
    const codes = Array.from(new Set(data.orders.map((order: any) => String(order.order_code || "").trim()).filter(Boolean)));
    const waitByCode = new Map<string, any>();
    if (view === "deliveries" && codes.length) {
      const waitResult = await admin.from("agrimarket_orders")
        .select("order_code,status,preferred_vehicle_type,ready_at,assigned_driver_id,dispatch_wait_code,dispatch_wait_vehicle_type,dispatch_checked_at")
        .eq("customer_user_id", auth.user.id).in("order_code", codes);
      if (waitResult.error || !Array.isArray(waitResult.data)) return unavailable();
      for (const row of waitResult.data) waitByCode.set(row.order_code, row);
    }
    return jsonNoStore(200, { ...data, orders: data.orders.map((order: any) => ({ ...order,
      scheduled_activity: order.fulfillment_mode === "scheduled_harvest" ? scheduledActivity(order.items) : null,
      dispatch_wait: waitByCode.get(order.order_code)?.status === order.status &&
        waitByCode.get(order.order_code)?.preferred_vehicle_type === order.preferred_vehicle_type
        ? customerDispatchWait({
            status: order.status, vehicle: order.preferred_vehicle_type,
            code: waitByCode.get(order.order_code).dispatch_wait_code,
            checkedAt: waitByCode.get(order.order_code).dispatch_checked_at,
            checkedVehicle: waitByCode.get(order.order_code).dispatch_wait_vehicle_type,
            readyAt: waitByCode.get(order.order_code).ready_at,
            assignedDriverId: waitByCode.get(order.order_code).assigned_driver_id,
            now: Date.now(),
          }) : null,
    })) });
  } catch { return unavailable(); }
}
