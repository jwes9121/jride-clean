"use client";
import { useRef, useState } from "react";
import { farmerSessionHeaders } from "@/lib/agrimarket/farmerSessionClient";
import { RESERVATION_CANCEL_REASONS } from "@/lib/agrimarket/reservationCancellation";
type Item = { product_id: string; product_name: string; quantity: number; selling_unit: string };
type Reservation = { order_code: string; updated_at?: string | null; status: string; items: Item[] };
export default function CancelReservation({ order, accountCode, busy: externalBusy, onBusy, onComplete }: {
  order: Reservation; accountCode: string; busy: boolean;
  onBusy: (busy: boolean) => void; onComplete: (message: string) => Promise<void>;
}) {
  const [review, setReview] = useState<Reservation | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const flight = useRef(false);
  const changed = Boolean(review && (review.updated_at !== order.updated_at || review.status !== order.status));
  async function cancel() {
    if (flight.current || externalBusy || !review || changed || !confirmed || !reason || !selected.length || !review.updated_at || (reason === "other" && note.trim().length < 5)) return;
    flight.current = true; setBusy(true); onBusy(true); setError("");
    try {
      const response = await fetch("/api/agrimarket/producer/orders/cancel-reservation", {
        method: "POST", headers: farmerSessionHeaders(accountCode, true), signal: AbortSignal.timeout(15000),
        body: JSON.stringify({ order_code: review.order_code, expected_updated_at: review.updated_at,
          reason_code: reason, reason_note: note, affected_product_ids: selected, confirm_cancel_all: true }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok !== true) throw new Error(body?.message || "Cancellation not confirmed. Refresh to check the order before retrying.");
      setReview(null);
      await onComplete(body.message);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Cancellation not confirmed. Refresh to check its status."); }
    finally { flight.current = false; setBusy(false); onBusy(false); }
  }
  if (!review) return <div className="mt-4 border-t pt-4">
    <p className="text-sm text-slate-700">Cannot supply a reserved cut? For an accepted reservation with partial supply, use Propose lower quantity and wait for customer approval. Do not substitute a different cut without approval.</p>
    <button type="button" disabled={externalBusy || !order.updated_at} onClick={() => { setReview({ ...order, items: [...order.items] }); setReason(""); setSelected([]); setNote(""); setConfirmed(false); setError(""); }} className="mt-2 rounded-xl border border-red-300 px-4 py-3 font-semibold text-red-800 disabled:opacity-50">Cancel entire reservation</button>
  </div>;
  return <section className="mt-4 space-y-3 rounded-xl border border-red-300 bg-red-50 p-4" aria-label="Cancel entire reservation">
    <h3 className="font-bold">Cancel reservation {review.order_code}?</h3>
    <p className="text-sm">This cancels ALL items in this reservation, not just the selected cuts. Other customers' reservations are unchanged. The original item and price records remain in order history.</p>
    {changed && <p role="alert" className="font-semibold">This reservation changed. Go back and review its latest details before cancelling.</p>}
    {error && <p role="alert" className="font-semibold text-red-900">{error}</p>}
    <fieldset disabled={busy || externalBusy || changed} className="space-y-3">
      <label className="block text-sm font-semibold">Reason<select value={reason} onChange={e => { setReason(e.target.value); setConfirmed(false); }} className="mt-1 w-full rounded-lg border bg-white p-3"><option value="">Choose the specific reason</option>{RESERVATION_CANCEL_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}</select></label>
      <fieldset className="space-y-2"><legend className="text-sm font-semibold">Which reserved cuts are unavailable?</legend>
        {review.items.map(item => <label key={item.product_id} className="flex items-start gap-2 text-sm"><input type="checkbox" checked={selected.includes(item.product_id)} onChange={e => { setSelected(ids => e.target.checked ? [...ids,item.product_id] : ids.filter(id => id !== item.product_id)); setConfirmed(false); }} /><span>{item.product_name} - {item.quantity} {item.selling_unit}</span></label>)}
      </fieldset>
      <label className="block text-sm font-semibold">Explanation {reason === "other" ? "(required)" : "(optional)"}<textarea value={note} maxLength={500} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-lg border bg-white p-3" /></label>
      <p className="text-sm">The customer will see the cancellation reason. Selected unavailable cuts will be paused for new orders. Recheck their actual stock before reopening them.</p>
      <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} /><span>I confirm cancellation of the entire reservation and pausing the selected cuts.</span></label>
    </fieldset>
    <div className="flex flex-wrap gap-3">
      <button type="button" disabled={busy} onClick={() => setReview(null)} className="rounded-lg border bg-white px-4 py-3 font-semibold">Go back</button>
      <button type="button" onClick={() => void cancel()} disabled={busy || externalBusy || changed || !confirmed || !reason || !selected.length || (reason === "other" && note.trim().length < 5)} className="rounded-lg bg-red-800 px-4 py-3 font-semibold text-white disabled:bg-slate-400">{busy ? "Cancelling..." : "Confirm cancellation of ALL items"}</button>
    </div>
  </section>;
}
