type OrderStatusFields = {
  customer_status?: string | null;
  vendor_status?: string | null;
  status?: string | null;
};

const PAST_STATUSES = new Set(["completed", "cancelled", "vendor_timeout", "expired"]);

function normalize(value: string | null | undefined): string {
  const status = (value || "").trim().toLowerCase();
  return status === "canceled" ? "cancelled" : status;
}

export function historyStatus(order: OrderStatusFields): string {
  const statuses = [order.customer_status, order.vendor_status, order.status].map(normalize);
  // A stale progress field must not keep an explicitly closed order active.
  // Preserve customer/vendor display priority when fields agree on closure.
  return statuses.find(status => PAST_STATUSES.has(status)) || statuses.find(Boolean) || "unknown";
}

export function isActive(order: OrderStatusFields): boolean {
  // Unknown states remain visible in Active; never infer expiry from age alone.
  return !PAST_STATUSES.has(historyStatus(order));
}

export function getDisplayStatus(order: OrderStatusFields): string {
  const status = historyStatus(order);
  if (status === "vendor_timeout" || status === "expired") return "Expired";
  if (status === "cancelled") return "Cancelled";
  if (status === "completed") return "Completed";
  return status.replace(/_/g, " ");
}
