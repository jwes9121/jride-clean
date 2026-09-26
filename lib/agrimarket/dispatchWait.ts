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

type DispatchWaitInput = {
  status: string;
  vehicle: string | null;
  code: string | null;
  checkedAt: string | null;
  checkedVehicle: string | null;
  now: number;
  readyAt?: string | null;
  assignedDriverId?: string | null;
};

export type DispatchAttention = {
  level: "duty_alert" | "review_required";
  waiting_minutes: number;
  since: string;
};

function currentWaitCode(input: DispatchWaitInput): DispatchWaitCode | null {
  const code = eligibleWaitCode(input);
  if (!code || !input.checkedAt) return null;
  const age = input.now - Date.parse(input.checkedAt);
  return Number.isFinite(age) && age >= -5000 && age <= 3 * 60 * 1000 ? code : null;
}

function eligibleWaitCode(input: DispatchWaitInput): DispatchWaitCode | null {
  if (!["ready_for_dispatch", "dispatching"].includes(input.status) ||
      input.assignedDriverId || !input.vehicle || input.vehicle !== input.checkedVehicle || !input.checkedAt) return null;
  const checkedMs = Date.parse(input.checkedAt);
  if (!Number.isFinite(checkedMs) || checkedMs > input.now + 5000) return null;
  if (!input.code || !Object.prototype.hasOwnProperty.call(waitMessages, input.code)) return null;
  return input.code as DispatchWaitCode;
}

const waitMessages: Record<DispatchWaitCode, (vehicle: string) => string> = {
  no_online_vehicle: (vehicle) => `No online ${vehicle} driver is available right now. Driver search retries automatically.`,
  no_approved_driver: (vehicle) => `No approved AgriMarket ${vehicle} driver is available right now. Driver search retries automatically.`,
  no_eligible_driver: (vehicle) => `No eligible ${vehicle} driver is available right now. Driver search retries automatically.`,
  outside_pickup_range: (vehicle) => `No eligible ${vehicle} driver is within the 10 km road pickup limit right now. Driver search retries automatically.`,
  route_unavailable: () => "JRide could not verify a road route to a driver. The search will retry automatically.",
  search_unavailable: () => "Driver search is temporarily unavailable. JRide will retry automatically.",
};

export function dispatchAttention(input: DispatchWaitInput): DispatchAttention | null {
  if (!eligibleWaitCode(input) || !input.readyAt) return null;
  const readyAtMs = Date.parse(input.readyAt);
  const waitingMs = input.now - readyAtMs;
  if (!Number.isFinite(waitingMs) || waitingMs < 15 * 60 * 1000) return null;
  return {
    level: waitingMs >= 30 * 60 * 1000 ? "review_required" : "duty_alert",
    waiting_minutes: Math.floor(waitingMs / 60_000),
    since: input.readyAt,
  };
}

export function customerDispatchWait(input: DispatchWaitInput): { code: DispatchWaitCode; message: string; checked_at: string } | null {
  const code = currentWaitCode(input);
  const attention = dispatchAttention(input);
  if (!input.checkedAt || (!code && !attention)) return null;
  const vehicle = input.vehicle === "tricycle" ? "tricycle" : input.vehicle === "motorcycle" ? "motorcycle" : "selected vehicle";
  const guidance = attention?.level === "review_required"
    ? " JRide staff review is needed to arrange delivery. Please contact JRide with your order code."
    : attention ? " This delay needs JRide staff attention. Please contact JRide with your order code." : "";
  return {
    code: code || "search_unavailable",
    message: (code ? waitMessages[code](vehicle) : "No recent driver search result is available.") + guidance,
    checked_at: input.checkedAt,
  };
}
