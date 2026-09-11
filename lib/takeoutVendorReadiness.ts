// Vendor readiness is independent of the driver's travel/cash-collection step.
// These helpers shape API responses only; they never advance a booking.
const status = (value: unknown) => String(value ?? "").trim().toLowerCase();

export function takeoutVendorReadiness(row: any) {
  const states = [row?.status, row?.vendor_status, row?.customer_status, row?.driver_status].map(status);
  const handedOffOrClosed = states.some(value => [
    "picked_up", "pickedup", "picked-up", "order_picked_up", "pickup_done",
    "delivering", "out_for_delivery", "in_delivery", "on_delivery",
    "completed", "cancelled", "canceled", "vendor_timeout",
  ].includes(value));
  const ready = status(row?.vendor_status) === "pickup_ready" &&
    !!String(row?.takeout_customer_confirmed_at ?? "").trim() && !handedOffOrClosed;
  return {
    vendor_pickup_ready: ready,
    vendor_status_label: ready ? "Ready for pickup" : null,
  };
}

// Keep the Android driver's existing step vocabulary. A ready order must not
// send an accepted/arrived driver back to the assignment step.
export function driverStepWhileVendorReady(row: any): string {
  const value = status(row?.driver_status);
  if (["accepted", "driver_accepted", "driver_confirmed", "accepted_by_driver"].includes(value)) return "driver_accepted";
  if (["cash_collected", "customer_cash_collected"].includes(value)) return "cash_collected";
  if (["rider_arrived_vendor", "arrived_vendor", "arrived_at_vendor", "at_vendor", "rider_at_vendor"].includes(value)) return "arrived_vendor";
  if (["picked_up", "pickedup", "picked-up", "order_picked_up", "pickup_done"].includes(value)) return "picked_up";
  if (["delivering", "out_for_delivery", "in_delivery", "on_delivery"].includes(value)) return "delivering";
  if (["completed", "cancelled", "canceled"].includes(value)) return value === "canceled" ? "cancelled" : value;
  return "driver_assigned";
}
