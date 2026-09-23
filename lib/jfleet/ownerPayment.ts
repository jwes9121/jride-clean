// Shared contract for original-quotation payments, not side-trip add-ons.
export type PaymentKind = "reservation" | "balance" | "full_payment";
export type PaymentScope = { owner_user_id: string; partner_id: string; booking_id: string };
export type PaymentFields = {
  payment_kind: PaymentKind; amount: number;
  payment_channel: string; payment_reference: string; notes: string;
};
export type PaymentRequest = PaymentFields & { booking_id: string; idempotency_key: string;
  expected_owner_id?: string; expected_partner_id?: string };
export type PaymentReceipt = PaymentFields & PaymentScope & {
  payment_id: string; idempotency_key: string; status: "confirmed"; confirmed_at: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PAYMENT_KEY = /^[A-Za-z0-9_-]{8,120}$/;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid payment request.");
  return value as Record<string, unknown>;
}
export function paymentScope(value: unknown): PaymentScope {
  const v = record(value);
  for (const key of ["owner_user_id", "partner_id", "booking_id"]) {
    if (typeof v[key] !== "string" || !UUID.test(v[key] as string)) throw new Error("Payment account context is unavailable. Reload the owner portal.");
  }
  return {owner_user_id: v.owner_user_id as string, partner_id: v.partner_id as string, booking_id: v.booking_id as string};
}
function text(value: unknown, max: number): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || value.length > max) throw new Error("Payment details are invalid or too long.");
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
}
export function paymentFields(value: unknown): PaymentFields {
  const v = record(value), amount = v.amount;
  if (!["reservation", "balance", "full_payment"].includes(String(v.payment_kind))) throw new Error("Choose a valid payment type.");
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0.01 || amount > 100000000 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 0.00001) throw new Error("Enter a positive amount with at most two decimal places.");
  return {payment_kind: v.payment_kind as PaymentKind, amount: Math.round(amount * 100) / 100,
    payment_channel: text(v.payment_channel, 80), payment_reference: text(v.payment_reference, 180), notes: text(v.notes, 1000)};
}
export function paymentRequest(value: unknown): PaymentRequest {
  const v = record(value);
  if (typeof v.booking_id !== "string" || !UUID.test(v.booking_id)) throw new Error("Choose a valid booking.");
  if (typeof v.idempotency_key !== "string" || !PAYMENT_KEY.test(v.idempotency_key)) throw new Error("A saved payment request key is required. Reload the owner portal; do not resubmit the old form.");
  for (const k of ["expected_owner_id", "expected_partner_id"]) {
    if (v[k] !== undefined && (typeof v[k] !== "string" || !UUID.test(v[k] as string))) throw new Error("Payment account context is invalid.");
  }
  return {...paymentFields(v), booking_id: v.booking_id, idempotency_key: v.idempotency_key,
    ...(v.expected_owner_id === undefined ? {} : {expected_owner_id: v.expected_owner_id as string}),
    ...(v.expected_partner_id === undefined ? {} : {expected_partner_id: v.expected_partner_id as string})};
}
export function paymentScopeKey(value: PaymentScope): string {
  const s = paymentScope(value); return [s.owner_user_id, s.partner_id, s.booking_id].join(":");
}
export function samePayment(a: PaymentFields, b: PaymentFields): boolean {
  return a.payment_kind === b.payment_kind && a.amount === b.amount && a.payment_channel === b.payment_channel &&
    a.payment_reference === b.payment_reference && a.notes === b.notes;
}
export function checkedReceipt(value: unknown, scope: PaymentScope, req: PaymentRequest): PaymentReceipt {
  const v = record(value), s = paymentScope(v), f = paymentFields(v);
  if (paymentScopeKey(s) !== paymentScopeKey(scope) || v.idempotency_key !== req.idempotency_key ||
      !samePayment(f, req) || v.status !== "confirmed" || typeof v.payment_id !== "string" || !UUID.test(v.payment_id) ||
      typeof v.confirmed_at !== "string" || !Number.isFinite(Date.parse(v.confirmed_at))) {
    throw new Error("The server receipt does not match the saved payment. Keep this request and contact JRide.");
  }
  return {...s, ...f, payment_id: v.payment_id, idempotency_key: req.idempotency_key, status: "confirmed", confirmed_at: v.confirmed_at};
}
