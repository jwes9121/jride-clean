// Public browsing and ordering are deliberately separate permissions.
export type StoreStatus = "open" | "closed" | "unavailable";
export const CLOSED_STORE_BLOCKER = "AGRIMARKET_STORE_CLOSED";
export const UNAVAILABLE_STORE_BLOCKER = "AGRIMARKET_STORE_UNAVAILABLE";
export const CLOSED_CATALOG_VERSION = "1";
export type StoreAvailability = {
  store_status: StoreStatus;
  store_status_label: string;
  store_status_message: string;
};
export type AvailabilityProduct = Partial<StoreAvailability> & {
  can_order_now?: boolean;
  order_blocker?: string | null;
};
export function storeAvailability(producer: { accepting_orders?: unknown; store_open?: unknown }): StoreAvailability {
  const store_status: StoreStatus = producer.accepting_orders !== true ? "unavailable"
    : producer.store_open !== true ? "closed" : "open";
  return {
    store_status,
    store_status_label: store_status === "open" ? "Accepting orders" : store_status === "closed" ? "Closed for now" : "Temporarily unavailable",
    store_status_message: store_status === "open" ? "This store is accepting orders."
      : "Not accepting orders right now. You can still view this store's products.",
  };
}
export function listingAvailability(producer: { accepting_orders?: unknown; store_open?: unknown }, reservationOpen: boolean) {
  const availability = storeAvailability(producer);
  const order_blocker = availability.store_status === "unavailable" ? UNAVAILABLE_STORE_BLOCKER
    : availability.store_status === "closed" ? CLOSED_STORE_BLOCKER
    : !reservationOpen ? "AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED" : null;
  return { ...availability, can_order_now: order_blocker === null, order_blocker };
}
export function isStoreUnavailable(product: AvailabilityProduct): boolean {
  return product.store_status === "closed" || product.store_status === "unavailable"
    || product.order_blocker === CLOSED_STORE_BLOCKER || product.order_blocker === UNAVAILABLE_STORE_BLOCKER;
}
export function productOrderBlocker(product: AvailabilityProduct): string | null {
  if (product.store_status === "closed" || product.order_blocker === CLOSED_STORE_BLOCKER) {
    return "Closed for now. This store is not accepting orders right now.";
  }
  if (product.store_status === "unavailable" || product.order_blocker === UNAVAILABLE_STORE_BLOCKER) {
    return "Temporarily unavailable. This store is not accepting orders right now.";
  }
  if (product.order_blocker === "AGRIMARKET_HARVEST_ORDER_CUTOFF_PASSED") return "Reservations for this schedule are closed.";
  return product.can_order_now === true ? null : "This item is currently unavailable to order.";
}
export function orderingButtonLabel(product: AvailabilityProduct): string | null {
  if (product.store_status === "closed" || product.order_blocker === CLOSED_STORE_BLOCKER) return "Store closed";
  if (product.store_status === "unavailable" || product.order_blocker === UNAVAILABLE_STORE_BLOCKER) return "Unavailable";
  return null;
}
