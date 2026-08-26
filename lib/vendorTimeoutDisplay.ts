export const CURRENT_VENDOR_ACCEPT_WINDOW_MINUTES = 5;
const MAX_PLAUSIBLE_VENDOR_TIMEOUT_MINUTES = 30;

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function timestamp(value: unknown): number {
  const result = new Date(String(value || "")).getTime();
  return Number.isFinite(result) ? result : 0;
}

export function vendorTimeoutWindowMinutes(row: Record<string, any>): number {
  const reason = clean(row?.vendor_cancel_reason || row?.cancel_reason);
  const match = reason.match(/within\s+(\d+)\s+minutes?/i);
  const parsed = match ? Number(match[1]) : CURRENT_VENDOR_ACCEPT_WINDOW_MINUTES;
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 60) {
    return CURRENT_VENDOR_ACCEPT_WINDOW_MINUTES;
  }
  return Math.round(parsed);
}

export type VendorTimeoutDisplay = {
  displayed_at: string | null;
  exact_event_at: string | null;
  expected_deadline_at: string | null;
  date_is_exact: boolean;
  time_label: "Timed out at" | "Expected response deadline";
  timestamp_note: string;
  timeout_window_minutes: number;
};

export function vendorTimeoutDisplay(row: Record<string, any>): VendorTimeoutDisplay {
  const createdMs = timestamp(row?.created_at);
  const minutes = vendorTimeoutWindowMinutes(row);
  const expectedMs = createdMs ? createdMs + minutes * 60 * 1000 : 0;
  const rawExactMs = timestamp(row?.vendor_timeout_at);
  const plausibleExact = Boolean(
    createdMs &&
      rawExactMs >= createdMs &&
      rawExactMs <= createdMs + MAX_PLAUSIBLE_VENDOR_TIMEOUT_MINUTES * 60 * 1000
  );

  const exactEventAt = plausibleExact ? new Date(rawExactMs).toISOString() : null;
  const expectedDeadlineAt = expectedMs ? new Date(expectedMs).toISOString() : null;

  if (exactEventAt) {
    return {
      displayed_at: exactEventAt,
      exact_event_at: exactEventAt,
      expected_deadline_at: expectedDeadlineAt,
      date_is_exact: true,
      time_label: "Timed out at",
      timestamp_note: "Exact timeout event time",
      timeout_window_minutes: minutes,
    };
  }

  return {
    displayed_at: expectedDeadlineAt,
    exact_event_at: null,
    expected_deadline_at: expectedDeadlineAt,
    date_is_exact: false,
    time_label: "Expected response deadline",
    timestamp_note:
      "Historical exact timeout time was not captured. This deadline is derived from the order placement time and the stored vendor response window.",
    timeout_window_minutes: minutes,
  };
}
