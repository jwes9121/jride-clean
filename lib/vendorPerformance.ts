export type VendorDecision = "accepted" | "timeout" | "rejected";

export type VendorMetricBooking = Record<string, any> & {
  id?: string | null;
  vendor_id?: string | null;
  created_by_user_id?: string | null;
  booking_code?: string | null;
  passenger_name?: string | null;
  service_type?: string | null;
  status?: string | null;
  vendor_status?: string | null;
  customer_status?: string | null;
  driver_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  assigned_driver_id?: string | null;
  driver_id?: string | null;
  takeout_fee_proposed_at?: string | null;
  takeout_customer_confirmed_at?: string | null;
  vendor_responded_at?: string | null;
  vendor_accepted_at?: string | null;
  vendor_rejected_at?: string | null;
  vendor_timeout_at?: string | null;
  cancel_reason?: string | null;
  vendor_cancel_reason?: string | null;
};

const ACCEPTED_VENDOR_STATUSES = new Set([
  "vendor_accepted",
  "accepted",
  "preparing",
  "preparing_order",
  "driver_assigned",
  "driver_accepted",
  "pickup_ready",
  "ready",
  "rider_arrived_vendor",
  "arrived_vendor",
  "picked_up",
  "delivering",
  "completed",
]);

const VENDOR_REJECTION_REASONS = [
  "item sold out",
  "vendor too busy",
  "store closing soon",
  "cannot prepare on time",
  "wrong or unavailable menu item",
  "cannot fulfill order",
];

export function metricText(value: unknown): string {
  return String(value ?? "").trim();
}

export function metricStatus(value: unknown): string {
  return metricText(value).toLowerCase().replace(/\s+/g, "_");
}

export function metricTime(value: unknown): number | null {
  const raw = metricText(value);
  if (!raw) return null;
  const ms = new Date(raw).getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isTakeoutCompleted(row: VendorMetricBooking): boolean {
  const values = [row.status, row.vendor_status, row.customer_status, row.driver_status].map(metricStatus);
  return values.includes("completed") || metricTime(row.completed_at) !== null;
}

export function vendorCancellationReason(row: VendorMetricBooking): string {
  return metricText(row.vendor_cancel_reason || row.cancel_reason);
}

export function hasVendorAcceptanceEvidence(row: VendorMetricBooking): boolean {
  const vendorStatus = metricStatus(row.vendor_status);
  return (
    ACCEPTED_VENDOR_STATUSES.has(vendorStatus) ||
    metricTime(row.vendor_accepted_at) !== null ||
    metricText(row.assigned_driver_id).length > 0 ||
    metricText(row.driver_id).length > 0 ||
    metricTime(row.takeout_fee_proposed_at) !== null ||
    metricTime(row.takeout_customer_confirmed_at) !== null ||
    isTakeoutCompleted(row)
  );
}

export function isVendorTimeout(row: VendorMetricBooking): boolean {
  const statuses = [row.vendor_status, row.customer_status].map(metricStatus);
  const reason = vendorCancellationReason(row).toLowerCase();
  return (
    statuses.includes("vendor_timeout") ||
    metricTime(row.vendor_timeout_at) !== null ||
    reason.includes("vendor did not respond within")
  );
}

export function classifyVendorDecision(row: VendorMetricBooking): VendorDecision | null {
  if (metricStatus(row.service_type) !== "takeout") return null;

  if (isVendorTimeout(row)) return "timeout";
  if (hasVendorAcceptanceEvidence(row)) return "accepted";

  const vendorStatus = metricStatus(row.vendor_status);
  const reason = vendorCancellationReason(row).toLowerCase();
  const rejectedStatus = ["cancelled", "canceled", "rejected", "vendor_rejected"].includes(vendorStatus);
  const explicitVendorReason = VENDOR_REJECTION_REASONS.some((item) => reason.includes(item));

  if (metricTime(row.vendor_rejected_at) !== null || (rejectedStatus && (explicitVendorReason || reason.length > 0))) {
    return "rejected";
  }

  return null;
}

export function vendorResponseAt(row: VendorMetricBooking): string | null {
  const decision = classifyVendorDecision(row);
  if (!decision) return null;

  if (decision === "accepted") {
    return metricText(row.vendor_accepted_at || row.vendor_responded_at) || null;
  }
  if (decision === "timeout") {
    return metricText(row.vendor_timeout_at || row.vendor_responded_at) || null;
  }
  return metricText(row.vendor_rejected_at || row.vendor_responded_at) || null;
}

export function vendorResponseSeconds(row: VendorMetricBooking): number | null {
  const createdMs = metricTime(row.created_at);
  const responseMs = metricTime(vendorResponseAt(row));
  if (createdMs === null || responseMs === null || responseMs < createdMs) return null;
  return Math.round((responseMs - createdMs) / 1000);
}

export function manilaDateKey(value: unknown): string {
  const ms = metricTime(value);
  if (ms === null) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

export function manilaMonthKey(value: unknown): string {
  const key = manilaDateKey(value);
  return key ? key.slice(0, 7) : "";
}

export function currentManilaDateKey(now = new Date()): string {
  return manilaDateKey(now.toISOString());
}

export function currentManilaMonthKey(now = new Date()): string {
  return currentManilaDateKey(now).slice(0, 7);
}

export function currentManilaMondayKey(now = new Date()): string {
  const parts = currentManilaDateKey(now).split("-").map(Number);
  const noonUtc = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 4, 0, 0));
  const day = noonUtc.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  noonUtc.setUTCDate(noonUtc.getUTCDate() + offset);
  return noonUtc.toISOString().slice(0, 10);
}

export type VendorMetricPeriod = "today" | "week" | "month" | "all";

export function isInVendorMetricPeriod(
  value: unknown,
  period: VendorMetricPeriod,
  now = new Date()
): boolean {
  if (period === "all") return true;
  const dateKey = manilaDateKey(value);
  if (!dateKey) return false;
  if (period === "today") return dateKey === currentManilaDateKey(now);
  if (period === "month") return dateKey.startsWith(currentManilaMonthKey(now));
  return dateKey >= currentManilaMondayKey(now) && dateKey <= currentManilaDateKey(now);
}

export function elapsedMetricUnits(startValue: unknown, now = new Date()) {
  const startMs = metricTime(startValue) ?? now.getTime();
  const elapsedMs = Math.max(0, now.getTime() - startMs);
  const days = Math.max(1, Math.ceil(elapsedMs / (24 * 60 * 60 * 1000)));
  const weeks = Math.max(1, Math.ceil(days / 7));

  const startMonth = manilaMonthKey(new Date(startMs).toISOString());
  const nowMonth = currentManilaMonthKey(now);
  let months = 1;
  if (startMonth && nowMonth) {
    const [sy, sm] = startMonth.split("-").map(Number);
    const [ny, nm] = nowMonth.split("-").map(Number);
    months = Math.max(1, (ny - sy) * 12 + (nm - sm) + 1);
  }

  return { days, weeks, months };
}

export function roundMetric(value: number, digits = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = Math.pow(10, digits);
  return Math.round(value * factor) / factor;
}
