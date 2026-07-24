// Shared lifecycle gate for scanner-side operations (gate check-in and
// checkpoint passage scanning). This is intentionally separate from the
// event lifecycle TRANSITION matrix owned by
// public.event_lifecycle_allowed_transitions() in the database - that
// matrix governs which status changes an organizer may make; this governs
// which statuses currently permit scanning activity, a different question.
//
// A single shared constant (rather than a per-route copy) is imported by
// both app/api/events/[eventSlug]/check-in/route.ts and
// app/api/events/[eventSlug]/checkpoint-scan/route.ts so the allowed set
// cannot drift between the two routes.
//
// Decision (EVT-020 Phase 3A Step 1 evidence + organizer decision):
//   draft                blocked
//   published            blocked
//   registration_open    blocked
//   registration_closed  allowed
//   live                 allowed
//   completed            blocked
//   archived             blocked

export const CHECKIN_OPEN_STATUSES = [
  "registration_closed",
  "live",
] as const;

export type CheckinOpenStatus = (typeof CHECKIN_OPEN_STATUSES)[number];

export function isCheckinOpen(status: string | null | undefined) {
  return CHECKIN_OPEN_STATUSES.includes(status as CheckinOpenStatus);
}

export const EVENT_NOT_CHECKIN_OPEN_RESPONSE = {
  success: false,
  reason: "event_not_checkin_open",
  message: "Check-in is not open for this event.",
} as const;

// Separate response for non-check-in operational writes (e.g. distribution
// household registration) that reuse the same isCheckinOpen predicate but
// are not literally "check-in" - keeps the check-in response contract
// (EVT-020 Phase 3A) unchanged for its existing callers while giving other
// operational gates their own, accurately-worded response.
export const EVENT_NOT_OPERATIONAL_RESPONSE = {
  success: false,
  reason: "event_not_operational",
  message: "This operation is not open for this event.",
} as const;
