export const VENDOR_ACCEPT_WINDOW_MS = 5 * 60 * 1000;
export const VENDOR_ACCEPT_TIMEOUT_REASON = "Vendor did not respond within 5 minutes";

export type VendorOrder = {
  id?: string | null;
  booking_code?: string | null;
  vendor_id?: string | null;
  vendor_status?: string | null;
  status?: string | null;
  created_at?: string | null;
  vendor_accept_expires_at?: string | null;
  items?: Array<{ name?: string | null; quantity?: number | string | null; price?: number | string | null }> | null;
  [key: string]: any;
};

export const clean = (value: unknown): string => String(value ?? "").trim();
export const orderKey = (order: VendorOrder): string => clean(order.id || order.order_id || order.booking_id || order.booking_code);
export const shortOrderCode = (order: VendorOrder): string => "#" + (clean(order.booking_code).split("-").pop() || orderKey(order).slice(0,8));

export function orderStatus(order: VendorOrder): string {
  const vendor = clean(order.vendor_status).toLowerCase();
  const canonical = clean(order.status).toLowerCase();
  if (vendor === "vendor_timeout") return vendor;
  if (["completed", "cancelled", "canceled"].includes(canonical)) return canonical === "canceled" ? "cancelled" : canonical;
  const raw = vendor || canonical || "vendor_pending";
  if (raw === "requested") return "vendor_pending";
  if (raw === "accepted") return "vendor_accepted";
  if (raw === "canceled") return "cancelled";
  if (["ready", "prepared", "ready_for_pickup"].includes(raw)) return "pickup_ready";
  return raw === "preparing_order" ? "preparing" : raw;
}

export function isClosed(order: VendorOrder): boolean {
  return ["completed", "cancelled", "vendor_timeout", "expired"].includes(orderStatus(order));
}

export function acceptDeadline(order: VendorOrder): number {
  const explicit = Date.parse(clean(order.vendor_accept_expires_at));
  if (Number.isFinite(explicit)) return explicit;
  const created = Date.parse(clean(order.created_at));
  return Number.isFinite(created) ? created + VENDOR_ACCEPT_WINDOW_MS : 0;
}

export function isPending(order: VendorOrder, now: number): boolean {
  return orderStatus(order) === "vendor_pending" && acceptDeadline(order) > now;
}

export function countdown(order: VendorOrder, now: number): string {
  const seconds = Math.max(0, Math.ceil((acceptDeadline(order) - now) / 1000));
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

export function sortActive(orders: VendorOrder[], now: number): VendorOrder[] {
  return orders.filter(order => !isClosed(order)).sort((a,b) => {
    const ap = isPending(a, now), bp = isPending(b, now);
    if (ap !== bp) return ap ? -1 : 1;
    return ap ? acceptDeadline(a) - acceptDeadline(b) : Date.parse(clean(b.created_at)) - Date.parse(clean(a.created_at));
  });
}

export function customerConfirmed(order: VendorOrder): boolean {
  // Driver acceptance and generic pricing status are not customer approval.
  return Boolean(clean(order.takeout_customer_confirmed_at));
}

export function canMarkReady(order: VendorOrder): boolean {
  return customerConfirmed(order) && ["vendor_accepted", "driver_assigned", "driver_accepted", "cash_collected", "preparing", "rider_arrived_vendor"].includes(orderStatus(order));
}

export function orderBadge(order: VendorOrder): string {
  const status = orderStatus(order);
  if (canMarkReady(order)) return "Prepare now";
  const labels: Record<string, string> = { vendor_pending: "New order", completed: "Completed", cancelled: "Cancelled", vendor_timeout: "Expired", pickup_ready: "Ready", picked_up: "Picked up", delivering: "Delivering" };
  return labels[status] || "Waiting";
}

export function orderStage(order: VendorOrder): { title: string; note: string; tone: string } {
  const status = orderStatus(order);
  if (status === "completed") return { title: "Completed", note: "The delivery is complete. This order is saved in History.", tone: "success" };
  if (status === "vendor_timeout" || status === "expired") return { title: "Acceptance expired", note: clean(order.cancel_reason) || VENDOR_ACCEPT_TIMEOUT_REASON, tone: "danger" };
  if (status === "cancelled") return { title: "Cancelled", note: clean(order.vendor_cancel_reason || order.cancel_reason) || "This order was cancelled. Do not prepare it.", tone: "danger" };
  if (status === "vendor_pending") return { title: "New order", note: "Review the items, then accept or decline.", tone: "urgent" };
  if (status === "picked_up") return { title: "Picked up", note: "The driver has collected the order.", tone: "progress" };
  if (status === "delivering") return { title: "Out for delivery", note: "The driver is delivering to the customer.", tone: "progress" };
  if (status === "pickup_ready") return { title: "Ready for pickup", note: "Keep the order packed. Check the order number with the driver at handoff.", tone: "success" };
  if (customerConfirmed(order)) return { title: "Customer confirmed - prepare now", note: status === "rider_arrived_vendor" ? "The driver is at your store. Mark ready when all items are packed." : "The customer approved the total. Prepare the items, then mark the order ready.", tone: "success" };
  if (order.takeout_fee_proposed_at || order.takeout_fee_proposed_by_driver_id || ["fare_proposed", "driver_fee_proposed", "fee_proposed"].includes(clean(order.takeout_pricing_status))) return { title: "Waiting for customer approval", note: "The delivery fee was proposed. Do not prepare until the customer confirms.", tone: "waiting" };
  if (["driver_accepted", "cash_collected", "rider_arrived_vendor"].includes(status) || clean(order.driver_status) === "driver_accepted") return { title: "Waiting for delivery fee proposal", note: "The driver accepted. Wait for the delivery fee and customer approval before preparing.", tone: "waiting" };
  if (order.driver_id || order.driver_name || status === "driver_assigned") return { title: "Waiting for driver confirmation", note: "A driver was selected. Do not prepare yet.", tone: "waiting" };
  return { title: "Finding a driver", note: "Order accepted. Wait for driver assignment and customer approval before preparing.", tone: "waiting" };
}
