const cancellable = new Set(["awaiting_producer", "awaiting_harvest", "producer_accepted", "preparing", "awaiting_customer_reapproval", "ready_for_dispatch", "dispatching", "driver_assigned"]);

export function agrimarketAdminActions(order: any, activeOfferId: string | null) {
  const recovery = Boolean(order.picked_up_at || order.delivering_at || order.delivered_at ||
    order.customer_cash_collected_at || Number(order.customer_cash_collected_amount) > 0 ||
    order.producer_paid_at || Number(order.producer_paid_amount) > 0 ||
    order.final_cash_collected_at || Number(order.final_cash_collected_amount) > 0 || order.pickup_issue?.status === "open");
  return {
    can_cancel: cancellable.has(order.status) && !recovery,
    can_reassign: !recovery && ["preparing", "ready_for_dispatch", "dispatching", "driver_assigned"].includes(order.status) && Boolean(order.assigned_driver_id || activeOfferId),
    recovery_required: recovery,
    active_offer_id: activeOfferId,
  };
}
