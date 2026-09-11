export type FareOrder = {
  id?: string | null; booking_code?: string | null; code?: string | null;
  status?: string | null; customer_status?: string | null; vendor_status?: string | null;
  takeout_pricing_status?: string | null; takeout_customer_confirmed_at?: string | null;
  takeout_fee_proposed_at?: string | null; takeout_fee_expires_at?: string | null;
  takeout_fee_proposed_by_driver_id?: string | null;
  takeout_total_payable?: number | string | null;
};

export const REMINDER_MS = 30_000;
export const PROPOSAL_MS = 300_000;
const text = (v: unknown) => String(v ?? "").trim();

export function fareProposal(order: FareOrder | null, now = Date.now()) {
  if (!order) return null;
  const states = [order.status, order.customer_status, order.vendor_status].map(v => text(v).toLowerCase());
  if (states.some(v => ["completed", "cancelled", "canceled", "vendor_timeout"].includes(v))) return null;
  if (text(order.takeout_pricing_status).toLowerCase() !== "driver_fee_proposed" || order.takeout_customer_confirmed_at) return null;
  const expiry = Date.parse(text(order.takeout_fee_expires_at));
  const proposed = Date.parse(text(order.takeout_fee_proposed_at));
  const deadline = Number.isFinite(proposed) ? Math.min(expiry, proposed + PROPOSAL_MS) : expiry;
  const total = Number(order.takeout_total_payable);
  const id = text(order.id || order.booking_code || order.code);
  if (!id || !Number.isFinite(deadline) || deadline <= now || !Number.isFinite(total) || total <= 0) return null;
  const key = [id, order.takeout_fee_proposed_at, order.takeout_fee_expires_at, total, order.takeout_fee_proposed_by_driver_id].join("|");
  return { key, deadline, total };
}

// Confirmation returns a sparse booking row. Keep the full bill and driver profile.
export function mergeConfirmedOrder<T extends FareOrder>(current: T | null, patch: T): T {
  if (!current) return patch;
  const same = current.id && patch.id ? current.id === patch.id
    : text(current.booking_code || current.code) !== "" && text(current.booking_code || current.code) === text(patch.booking_code || patch.code);
  return same ? { ...current, ...patch } : current;
}

export function expectedFare(order: FareOrder) {
  return { expires_at: order.takeout_fee_expires_at, proposed_at: order.takeout_fee_proposed_at,
    total: Number(order.takeout_total_payable), driver_id: order.takeout_fee_proposed_by_driver_id };
}

// A delayed timer produces one reminder, never a burst of missed alerts.
// The deadline always comes from the server, never from when this screen opens.
export function startFareReminders(deadline: number, play: () => void, expired: () => void, clock = {
  now: () => Date.now(),
  set: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clear: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
}) {
  let stopped = false;
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const check = () => {
    if (stopped) return;
    if (timer !== undefined) clock.clear(timer);
    const now = clock.now();
    if (now >= deadline || !Number.isFinite(deadline)) { stopped = true; expired(); return; }
    if (now - last >= REMINDER_MS) { last = now; play(); }
    timer = clock.set(check, Math.min(REMINDER_MS - (now - last), deadline - now));
  };
  check();
  return { check, stop: () => { stopped = true; if (timer !== undefined) clock.clear(timer); } };
}
