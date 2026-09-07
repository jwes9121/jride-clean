const HIDDEN_DRIVER_STATUSES = new Set([
  "deactivated", "inactive", "terminated", "deleted", "removed", "removed_from_pilot", "pending",
]);

export function isRemovedDriver(driver: { driver_status?: unknown; roster_status?: unknown } | null | undefined) {
  return [driver?.driver_status, driver?.roster_status].some(status =>
    HIDDEN_DRIVER_STATUSES.has(String(status ?? "").trim().toLowerCase())
  );
}
