export type ShiftDuty = "primary" | "evening";
export type ShiftSelection = { day: string; duty: ShiftDuty };
export const SHIFT_ACTIONS = ["start", "admin_takeover", "request_cover", "accept_cover", "ack_trip", "flag_issue", "ack_issue", "contact_driver", "contact_vendor", "escalate", "resolve_issue", "handover"] as const;
export type ShiftAction = typeof SHIFT_ACTIONS[number];
export const ACTION_LABELS: Record<ShiftAction, string> = {
  start: "Acknowledge shift", admin_takeover: "Admin: take over", request_cover: "Request temporary coverage",
  accept_cover: "Accept coverage now", ack_trip: "Acknowledge monitoring / handover", flag_issue: "Raise issue",
  ack_issue: "Acknowledge issue", contact_driver: "Log driver contact", contact_vendor: "Log vendor contact",
  escalate: "Log escalation to Admin", resolve_issue: "Resolve issue (not trip)", handover: "Record handover",
};
export function validSelection(day: unknown, duty: unknown): day is string {
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day) || (duty !== "primary" && duty !== "evening")) return false;
  const value = new Date(day + "T00:00:00Z");
  return Number.isFinite(value.getTime()) && value.toISOString().slice(0, 10) === day && day >= "2026-09-08";
}
export function shiftWindow(day: string, duty: ShiftDuty) {
  if (!validSelection(day, duty)) throw new Error("Choose a valid shift.");
  return {
    start: Date.parse(`${day}T${duty === "primary" ? "10" : "15"}:00:00+08:00`),
    end: Date.parse(`${day}T${duty === "primary" ? "15" : "19"}:00:00+08:00`),
  };
}
export function currentShift(now = new Date()): ShiftSelection {
  const ph = new Date(now.getTime() + 8 * 3600000);
  if (ph.getUTCHours() < 10) {
    ph.setUTCDate(ph.getUTCDate() - 1);
    return { day: ph.toISOString().slice(0, 10), duty: "evening" };
  }
  return { day: ph.toISOString().slice(0, 10), duty: ph.getUTCHours() < 15 ? "primary" : "evening" };
}
export function inShift(timestamp: string, day: string, duty: ShiftDuty) {
  const { start, end } = shiftWindow(day, duty);
  const value = Date.parse(timestamp);
  return Number.isFinite(value) && value >= start && value < end;
}
export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || !Number.isFinite(Number(seconds))) return "Not recorded";
  const minutes = Math.floor(Math.max(0, Number(seconds)) / 60);
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}
export function phTime(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not recorded";
  return new Date(value).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
}
export function averageOnline(seconds: number, elapsed: number) {
  return elapsed > 0 ? (Math.max(0, Number(seconds)) / elapsed).toFixed(1) : "--";
}
export type BookingFact = {
  id: string; booking_code: string; service_type: string; service: string; town: string | null;
  status: string | null; driver_id: string | null; driver_name: string; booked_at: string;
  driver_status: string | null; vendor_status: string | null; cancel_reason: string | null;
  last_status_at: string | null; is_new: boolean; completed_in_shift_at: string | null; cancelled_in_shift_at: string | null;
  carry_in: boolean | null; carry_out: boolean | null; waiting_for_driver: boolean | null; deleted_in_shift: boolean;
};
export type TripCase = {
  booking_id: string; issue_open: boolean; raised_at: string | null; issue_ack_at: string | null;
  resolved_at: string | null; issue_note: string | null; handover_pending: boolean; handover_note: string | null;
  last_reviewed_at: string | null; last_monitor_id: string | null; last_day: string | null; last_duty: ShiftDuty | null;
};
export type WatchTrip = {
  id: string; booking_code: string; service_type: string; town: string | null; status: string | null;
  driver_status: string | null; vendor_status: string | null; driver_id: string | null; driver_name: string;
  booked_at: string; last_status_at: string | null; needs_ack: boolean; case: TripCase | null;
};
export type ShiftActivity = {
  id: number; action: ShiftAction; actor_id: string; actor_email: string; booking_id: string | null;
  recorded_at: string; note: string; target: string | null;
  details: { monitor_before?: string | null; monitor_after?: string | null; outside_shift?: boolean; evidence?: string };
};
export type DriverPresence = {
  driver_id: string; name: string; town: string; raw_seconds: number; net_seconds: number; excluded_seconds: number;
  session_starts: number; first_seen_at: string; last_seen_at: string; recorded_before_start: boolean;
};
export type Presence = {
  drivers: DriverPresence[]; towns: { town: string; unique_drivers: number; raw_seconds: number; net_seconds: number;
    excluded_seconds: number; average_online: number; no_recorded_presence_seconds: number }[];
  unique_drivers: number; net_unique_drivers: number; drivers_starting_sessions: number; session_starts: number;
  raw_seconds: number; net_seconds: number; excluded_seconds: number; elapsed_seconds: number; basis: string; calculated_at: string;
};
export type ShiftReport = {
  day: string; duty: ShiftDuty; actor_id: string; admin: boolean; server_time: string;
  window: { start: string; end: string; as_of: string; phase: "NOT STARTED" | "LIVE" | "ENDED"; tracking_since: string; full_history: boolean };
  run: { version: number; scheduled_owner: string | null; current_saved_owner: string | null; monitor_id: string | null; acknowledged_at: string | null;
    first_ack_id: string | null; cover_to: string | null; cover_reason: string | null; snapshot_at: string | null; assignment_basis: string };
  metrics: { new_bookings: number; completed_trips: number; known_cancelled: number; cancelled_trips: number | null;
    carry_in: number | null; carry_out: number | null; waiting_for_driver: number | null; deleted_records: number;
    offer_expiries: number; bookings: BookingFact[]; basis: string };
  presence: Presence | null; watch: WatchTrip[]; live_watch: boolean; actions: ShiftActivity[];
  task_actions: { id: number; action: string; actor: string; note: string; recorded_at: string }[];
  employees: { id: string; name: string; email: string; area: string }[]; teams: Record<string, string>;
};
export type MetricKey = "all" | "new" | "completed" | "cancelled" | "carry_in" | "carry_out" | "waiting";
export function matchesMetric(row: BookingFact, key: MetricKey) {
  switch (key) {
    case "new": return row.is_new;
    case "completed": return row.completed_in_shift_at !== null;
    case "cancelled": return row.cancelled_in_shift_at !== null;
    case "carry_in": return row.carry_in === true;
    case "carry_out": return row.carry_out === true;
    case "waiting": return row.waiting_for_driver === true;
    default: return true;
  }
}
