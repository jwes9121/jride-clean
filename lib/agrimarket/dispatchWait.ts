export type DispatchWaitCode =
  | "no_online_vehicle"
  | "no_approved_driver"
  | "no_eligible_driver"
  | "outside_pickup_range"
  | "route_unavailable"
  | "search_unavailable";

const reasons: Record<string, DispatchWaitCode> = {
  NO_PREFERRED_VEHICLE_DRIVER_AVAILABLE: "no_online_vehicle",
  NO_APPROVED_AGRIMARKET_DRIVER_AVAILABLE: "no_approved_driver",
  NO_ELIGIBLE_DRIVER_AVAILABLE: "no_eligible_driver",
  NO_DRIVER_WITHIN_AGRIMARKET_APPROACH_LIMIT: "outside_pickup_range",
  ROAD_DISTANCE_UNAVAILABLE: "route_unavailable",
};

export function dispatchWaitCode(result: { ok: boolean; offered?: boolean; assigned?: boolean; error?: string }): DispatchWaitCode | null {
  if (result.offered || result.assigned) return null;
  if (result.error && reasons[result.error]) return reasons[result.error];
  return result.ok ? null : "search_unavailable";
}

export function customerDispatchWait(input: {
  status: string;
  vehicle: string | null;
  code: string | null;
  checkedAt: string | null;
  checkedVehicle: string | null;
  now: number;
}): { code: DispatchWaitCode; message: string; checked_at: string } | null {
  if (!["ready_for_dispatch", "dispatching"].includes(input.status) ||
      !input.vehicle || input.vehicle !== input.checkedVehicle || !input.checkedAt) return null;
  const age = input.now - Date.parse(input.checkedAt);
  if (!Number.isFinite(age) || age < -5000 || age > 3 * 60 * 1000) return null;
  const vehicle = input.vehicle === "tricycle" ? "tricycle" : input.vehicle === "motorcycle" ? "motorcycle" : "selected vehicle";
  const messages: Record<DispatchWaitCode, string> = {
    no_online_vehicle: `No online ${vehicle} driver is available right now. Driver search retries automatically.`,
    no_approved_driver: `No approved AgriMarket ${vehicle} driver is available right now. Driver search retries automatically.`,
    no_eligible_driver: `No eligible ${vehicle} driver is available right now. Driver search retries automatically.`,
    outside_pickup_range: `No eligible ${vehicle} driver is within the 10 km road pickup limit right now. Driver search retries automatically.`,
    route_unavailable: "JRide could not verify a road route to a driver. The search will retry automatically.",
    search_unavailable: "Driver search is temporarily unavailable. JRide will retry automatically.",
  };
  if (!input.code || !(input.code in messages)) return null;
  const code = input.code as DispatchWaitCode;
  return { code, message: messages[code], checked_at: input.checkedAt };
}
