import { hasValidPin } from "./coordinates";

export const PICKUP_ACCESS_COLUMNS =
  "pickup_motorcycle_accessible,pickup_tricycle_accessible,pickup_roadside_handoff_required,pickup_driver_directions";

export function pickupAccessError(producer: any, vehicle: string): string | null {
  if (!producer || producer.status !== "active" || producer.accepting_orders !== true) {
    return "AGRIMARKET_PRODUCER_UNAVAILABLE";
  }
  if (!hasValidPin(producer.pickup_lat, producer.pickup_lng)) return "AGRIMARKET_PRODUCER_PIN_REQUIRED";
  if (
    typeof producer.pickup_motorcycle_accessible !== "boolean" ||
    typeof producer.pickup_tricycle_accessible !== "boolean" ||
    typeof producer.pickup_roadside_handoff_required !== "boolean" ||
    !String(producer.pickup_driver_directions || "").trim()
  ) return "AGRIMARKET_PICKUP_ACCESS_UNVERIFIED";

  // Accessibility describes the verified handoff pin, including roadside handoff.
  // A roadside flag alone never makes an inaccessible pin safe for a vehicle.
  const accessible = vehicle === "tricycle"
    ? producer.pickup_tricycle_accessible
    : vehicle === "motorcycle" && producer.pickup_motorcycle_accessible;
  return accessible ? null : "AGRIMARKET_PICKUP_VEHICLE_INACCESSIBLE";
}
