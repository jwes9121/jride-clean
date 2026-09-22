export function agrimarketExpiryNotice(order: { status: string; cancel_reason?: string | null; fulfillment_mode?: string }) {
  if (order.status === "producer_timeout") return {
    title: "Order expired - cancelled",
    message: "The farmer did not respond within five minutes, so your order was cancelled.",
  };
  if (order.status === "cancelled" && order.cancel_reason === "customer_reapproval_timeout") return {
    title: "Approval time expired - order cancelled",
    message: "The revised charges were not approved within five minutes, so your order was cancelled.",
  };
  if (order.status === "cancelled" && order.fulfillment_mode === "scheduled_harvest") return {
    title: "Reservation cancelled",
    message: order.cancel_reason?.replace(/_/g, " ").trim() || "This reservation was cancelled. Return to AgriMarket to choose available products.",
  };
  return null;
}
