export type ScheduledHarvestAttention = "due_soon" | "in_window" | "overdue" | null;

type ScheduledReservation = {
  fulfillment_mode?: string | null;
  status?: string | null;
  harvest_expected_start_at?: string | null;
  harvest_expected_end_at?: string | null;
  pending_harvest_proposal?: unknown;
};

// Display signal only. Readiness, dispatch, cancellation and payments retain
// their existing server and database gates.
export function scheduledHarvestAttention(order: ScheduledReservation, nowMs: number): ScheduledHarvestAttention {
  if (order.fulfillment_mode !== "scheduled_harvest" || order.status !== "awaiting_harvest" || order.pending_harvest_proposal) return null;
  if (!Number.isFinite(nowMs)) return null;
  const start = Date.parse(String(order.harvest_expected_start_at || ""));
  // Older scheduled listings may have no finish. Match the native reminder
  // worker's one-hour estimated window without changing the saved order.
  const end = order.harvest_expected_end_at
    ? Date.parse(order.harvest_expected_end_at)
    : start + 60 * 60 * 1000;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  if (nowMs >= end) return "overdue";
  if (nowMs >= start) return "in_window";
  return start - nowMs <= 30 * 60 * 1000 ? "due_soon" : null;
}
