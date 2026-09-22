export const RESERVATION_CANCEL_REASONS = [
  { code: "sold_outside_jride", label: "Reserved cut sold outside JRide" },
  { code: "insufficient_quantity", label: "Not enough of the reserved cut available" },
  { code: "cut_unavailable", label: "Reserved cut unavailable after butchering" },
  { code: "quality_issue", label: "Reserved cut did not meet quality requirements" },
  { code: "other", label: "Other - explain the reason" },
] as const;
export function reservationCancelReason(code: unknown): string | null {
  return RESERVATION_CANCEL_REASONS.find(reason => reason.code === code)?.label || null;
}
