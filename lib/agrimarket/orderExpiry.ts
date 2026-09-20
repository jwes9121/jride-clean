export function agrimarketExpiryNotice(order: { status: string; cancel_reason?: string | null }) {
  if (order.status === "producer_timeout") return {
    title: "Order expired - cancelled",
    message: "The farmer did not respond within five minutes, so your order was cancelled.",
  };
  if (order.status === "cancelled" && order.cancel_reason === "customer_reapproval_timeout") return {
    title: "Approval time expired - order cancelled",
    message: "The revised charges were not approved within five minutes, so your order was cancelled.",
  };
  return null;
}
