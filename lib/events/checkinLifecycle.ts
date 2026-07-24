const CHECKIN_OPEN_STATUSES = new Set([
  "registration_closed",
  "live",
]);

export const EVENT_NOT_CHECKIN_OPEN_RESPONSE = {
  success: false,
  reason: "event_not_checkin_open",
  message: "Check-in is not open for this event.",
} as const;

export function isCheckinOpen(status: unknown): boolean {
  return CHECKIN_OPEN_STATUSES.has(
    String(status || "").trim()
  );
}
