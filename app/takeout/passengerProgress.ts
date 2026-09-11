type ProgressOrder = {
  vendor_status?: unknown;
  customer_status?: unknown;
  driver_status?: unknown;
  status?: unknown;
};

function normalize(value: unknown): string {
  const status = String(value ?? "").trim().toLowerCase();
  const aliases: Record<string, string> = {
    canceled: "cancelled",
    accepted: "driver_accepted",
    accepted_by_driver: "driver_accepted",
    driver_confirmed: "driver_accepted",
    arrived_vendor: "rider_arrived_vendor",
    arrived_at_vendor: "rider_arrived_vendor",
    at_vendor: "rider_arrived_vendor",
    rider_at_vendor: "rider_arrived_vendor",
    pickedup: "picked_up",
    "picked-up": "picked_up",
    order_picked_up: "picked_up",
    pickup_done: "picked_up",
    out_for_delivery: "delivering",
    in_delivery: "delivering",
    on_delivery: "delivering",
    customer_cash_collected: "cash_collected",
  };
  return aliases[status] || status;
}

// Vendor readiness is not a driver movement milestone. Use the saved driver
// stage so a refresh or newly opened tracker retains the actual arrival step.
export function passengerProgress(order: ProgressOrder | null, fallback: string) {
  const vendor = normalize(order?.vendor_status);
  const driver = normalize(order?.driver_status);
  const states = [order?.customer_status, order?.vendor_status, order?.status, order?.driver_status].map(normalize);
  const terminal = states.find(status => ["completed", "cancelled", "vendor_timeout", "expired"].includes(status));
  if (terminal) return { progressStatus: terminal, vendorReady: false };
  if (vendor !== "pickup_ready") return { progressStatus: fallback, vendorReady: false };

  // A stale vendor-ready value must not hide later driver movement.
  const movement = ["delivering", "picked_up", "rider_arrived_vendor"].find(status => states.includes(status));
  const driverStage = ["driver_assigned", "driver_accepted", "driver_fee_proposed", "customer_confirmed", "arrived_customer_cash", "cash_collected", "vendor_bound"].includes(driver) ? driver : "";
  const progressStatus = movement || driverStage || fallback;
  return {
    progressStatus,
    vendorReady: !["picked_up", "delivering"].includes(progressStatus),
  };
}
