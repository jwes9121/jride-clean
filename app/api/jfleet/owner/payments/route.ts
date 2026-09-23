import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { jfleetFeatureFlagEnabled, requireJfleetOwner } from "@/lib/jfleet/server";
import { PAYMENT_KEY, paymentFields, paymentRequest, paymentScope, samePayment,
  type PaymentReceipt, type PaymentRequest } from "@/lib/jfleet/ownerPayment";
export const dynamic = "force-dynamic";
const headers = {"Cache-Control": "no-store, max-age=0"};
type Owner = Extract<Awaited<ReturnType<typeof requireJfleetOwner>>, {ok: true}>;
type Admin = ReturnType<typeof supabaseAdmin>;
class PaymentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {super(message);}
}
function replyError(e: unknown) {
  const p = e instanceof PaymentError ? e : new PaymentError(503, "JFLEET_PAYMENT_CHECK_FAILED", "Could not verify the saved payment. Keep its request key and retry; do not record it again.");
  return NextResponse.json({ok: false, code: p.code, message: p.message}, {status: p.status, headers});
}
async function owner(req: Request) {
  if (!jfleetFeatureFlagEnabled()) throw new PaymentError(503, "JFLEET_NOT_ENABLED", "JFleet is not enabled yet.");
  const a = await requireJfleetOwner(req);
  if (!a.ok) throw new PaymentError(a.status, a.code, a.message);
  if (a.partner.status !== "active") throw new PaymentError(403, "JFLEET_OWNER_NOT_ACTIVE", "This transport account is not active.");
  return a;
}
function bind(a: Owner, r: {expected_owner_id?: string; expected_partner_id?: string}) {
  if ((r.expected_owner_id !== undefined && r.expected_owner_id !== a.user.id) ||
      (r.expected_partner_id !== undefined && r.expected_partner_id !== a.partner.id)) {
    throw new PaymentError(409, "JFLEET_PAYMENT_ACCOUNT_CHANGED", "The logged-in owner changed. Sign in to the original account to recover this payment.");
  }
}
async function booking(admin: Admin, a: Owner, id: string) {
  const b = await admin.from("jfleet_bookings")
    .select("id,booking_code,status,payment_status,original_quote_amount,reservation_required_amount")
    .eq("id", id).eq("partner_id", a.partner.id).maybeSingle();
  if (b.error) throw b.error;
  if (!b.data) throw new PaymentError(409, "JFLEET_PAYMENT_BOOKING_NOT_FOUND", "This booking is not available to this transport account.");
  return b.data;
}
async function receipt(admin: Admin, a: Owner, bookingId: string, key: string): Promise<PaymentReceipt | null> {
  const q = await admin.from("jfleet_payments")
    .select("id,booking_id,idempotency_key,payment_kind,amount,status,payment_channel,payment_reference,notes,confirmed_at,confirmed_by_owner_user_id")
    .eq("booking_id", bookingId).eq("idempotency_key", key).maybeSingle();
  if (q.error) throw q.error;
  if (!q.data) return null;
  const p = q.data;
  if (p.confirmed_by_owner_user_id !== a.user.id || p.status !== "confirmed" || !p.confirmed_at) {
    throw new PaymentError(409, "JFLEET_PAYMENT_RECORD_REVIEW_REQUIRED", "This key already has a payment record requiring review. Do not record a replacement payment.");
  }
  return {...paymentFields({...p, amount: Number(p.amount)}), payment_id: p.id, booking_id: bookingId,
    idempotency_key: key, owner_user_id: a.user.id, partner_id: a.partner.id, status: "confirmed", confirmed_at: p.confirmed_at};
}
function match(r: PaymentReceipt, requested: PaymentRequest) {
  if (!samePayment(r, requested)) throw new PaymentError(409, "JFLEET_PAYMENT_IDEMPOTENCY_CONFLICT", "That request key already belongs to different payment details. Recover the original request; do not replace its key.");
}
async function summary(admin: Admin, a: Owner, r: PaymentReceipt, replayed: boolean) {
  const b = await booking(admin, a, r.booking_id);
  const q = await admin.from("jfleet_payments").select("amount").eq("booking_id", r.booking_id)
    .eq("status", "confirmed").in("payment_kind", ["reservation", "balance", "full_payment"]);
  if (q.error) throw q.error;
  const paid = (q.data || []).reduce((n, p) => n + Number(p.amount), 0);
  return {ok: true, replayed, idempotency_key: r.idempotency_key, receipt: r,
    booking_id: b.id, booking_code: b.booking_code, booking_status: b.status, payment_status: b.payment_status,
    confirmed_original_payments: Math.round(paid * 100) / 100, original_quote_amount: b.original_quote_amount,
    reservation_required_amount: b.reservation_required_amount, fully_paid: paid >= Number(b.original_quote_amount)};
}
export async function GET(req: Request) {
  try {
    const a = await owner(req), p = new URL(req.url).searchParams;
    let s;
    try {s = paymentScope({owner_user_id: p.get("owner_user_id"), partner_id: p.get("partner_id"), booking_id: p.get("booking_id")});}
    catch {throw new PaymentError(400, "JFLEET_PAYMENT_LOOKUP_INVALID", "Provide the original saved payment context.");}
    const key = p.get("idempotency_key") || "";
    if (!PAYMENT_KEY.test(key)) throw new PaymentError(400, "JFLEET_PAYMENT_KEY_REQUIRED", "Provide the saved payment request key.");
    bind(a, {expected_owner_id: s.owner_user_id, expected_partner_id: s.partner_id});
    const admin = supabaseAdmin({noStore: true});
    await booking(admin, a, s.booking_id);
    const r = await receipt(admin, a, s.booking_id, key);
    // Not found is not permission to abandon a request: a concurrent POST may still commit.
    return NextResponse.json({ok: true, found: !!r, receipt: r}, {status: 200, headers});
  } catch (e) {return replyError(e);}
}
export async function POST(req: Request) {
  try {
    const a = await owner(req);
    let r: PaymentRequest;
    try {
      const raw = await req.text();
      if (raw.length > 8000) throw new Error("Payment request is too large.");
      r = paymentRequest(JSON.parse(raw));
    } catch (e) {throw new PaymentError(400, "JFLEET_PAYMENT_INPUT_INVALID", e instanceof Error ? e.message : "Invalid payment request.");}
    bind(a, r);
    const admin = supabaseAdmin({noStore: true});
    await booking(admin, a, r.booking_id);
    const existing = await receipt(admin, a, r.booking_id, r.idempotency_key);
    if (existing) {
      match(existing, r);
      return NextResponse.json(await summary(admin, a, existing, true), {status: 200, headers});
    }
    const q = await admin.rpc("jfleet_owner_confirm_payment_v1", {
      p_booking_id: r.booking_id, p_owner_user_id: a.user.id, p_payment_kind: r.payment_kind, p_amount: r.amount,
      p_payment_channel: r.payment_channel || null, p_payment_reference: r.payment_reference || null,
      p_idempotency_key: r.idempotency_key, p_notes: r.notes || null, p_now: new Date().toISOString(),
    });
    if (q.error) {
      const conflict = String(q.error.message || "").includes("JFLEET_");
      throw new PaymentError(conflict ? 409 : 503, "JFLEET_PAYMENT_NOT_CONFIRMED",
        "Payment confirmation did not return a verified receipt. Check or retry this same saved request; do not enter it as a new payment.");
    }
    // Read the authoritative ledger even when another tab won the same-key race.
    const saved = await receipt(admin, a, r.booking_id, r.idempotency_key);
    if (!saved) throw new Error("Receipt unavailable after transaction");
    match(saved, r);
    return NextResponse.json(await summary(admin, a, saved, false), {status: 200, headers});
  } catch (e) {return replyError(e);}
}
