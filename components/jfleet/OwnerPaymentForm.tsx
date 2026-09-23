"use client";
import {useCallback, useEffect, useRef, useState} from "react";
import {paymentFields, paymentScopeKey, type PaymentKind, type PaymentScope} from "@/lib/jfleet/ownerPayment";
import {confirmPaymentSlot, nextPaymentSlot, preparePaymentSlot, readPaymentSlot, type PaymentSlot} from "@/lib/jfleet/ownerPaymentStore";
import {philippinesTime} from "@/lib/jfleet/routeReview";
type Props = {scope: PaymentScope; canRecord: boolean; onSaved: () => Promise<void>};
const blank = {payment_kind: "reservation" as PaymentKind, amount: "", payment_channel: "", payment_reference: "", notes: ""};
export default function OwnerPaymentForm({scope, canRecord, onSaved}: Props) {
  const [slot, setSlot] = useState<PaymentSlot | null>(null), [draft, setDraft] = useState(blank);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const guard = useRef(false);
  const key = [scope.owner_user_id, scope.partner_id, scope.booking_id].join(":");
  const refresh = useCallback(async () => {
    try {paymentScopeKey(scope); setSlot(await readPaymentSlot(scope));}
    catch (e) {setError(e instanceof Error ? e.message : "Could not recover saved payment."); setSlot(null);}
  }, [key]); // Scope is made entirely from these three immutable IDs.
  useEffect(() => {
    void refresh();
    const focus = () => {if (!guard.current) void refresh();};
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [refresh]);
  async function run(checkOnly = false) {
    if (!slot || guard.current) return;
    guard.current = true; setBusy(true); setError(""); setNotice("");
    try {
      let current = await readPaymentSlot(scope);
      if (current.generation !== slot.generation) {setSlot(current); throw new Error("Another tab changed this form. Review the recovered state.");}
      if (current.phase === "draft") {
        if (checkOnly || !canRecord) throw new Error("This booking is not open for a new original-quotation payment.");
        current = await preparePaymentSlot(scope, slot.generation, paymentFields({...draft, amount: Number(draft.amount)}));
      }
      setSlot(current);
      if (current.phase === "confirmed") {setNotice("This saved payment is already confirmed. It was not submitted again."); return;}
      const req = current.request;
      if (!req) throw new Error("Saved request is missing. No payment was sent.");
      const query = new URLSearchParams({...scope, idempotency_key: req.idempotency_key});
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      let response: Response, body: any;
      try {
        response = await fetch("/api/jfleet/owner/payments" + (checkOnly ? "?" + query : ""), {
          method: checkOnly ? "GET" : "POST", credentials: "include", cache: "no-store", signal: controller.signal,
          ...(checkOnly ? {} : {headers: {"Content-Type": "application/json"}, body: JSON.stringify(req)}),
        });
        body = await response.json();
      } finally {clearTimeout(timer);}
      if (!response.ok || body?.ok !== true) throw new Error(body?.message || "The payment result is unknown. Retry the saved request, not a new entry.");
      if (checkOnly && body.found === false) {setNotice("No receipt is visible yet. Keep this request and retry it; an earlier request may still be processing."); return;}
      const confirmed = await confirmPaymentSlot(scope, current.generation, req, body.receipt);
      setSlot(confirmed); setNotice("Payment recorded once. The receipt is saved; do not enter the same payment again.");
      try {await onSaved();} catch {setNotice("Payment recorded. Refresh the booking totals separately; do not resubmit as a new payment.");}
    } catch (e) {
      setError(e instanceof Error && e.name !== "AbortError" ? e.message : "Response timed out. The result is unknown; retry this saved request.");
      await refresh();
    } finally {guard.current = false; setBusy(false);}
  }
  async function another() {
    if (!slot || guard.current || !canRecord) return;
    if (!window.confirm("Record a DIFFERENT payment received? Do not use this for a retry of the payment shown above.")) return;
    guard.current = true; setBusy(true); setError(""); setNotice("");
    try {setSlot(await nextPaymentSlot(scope, slot.generation)); setDraft({...blank});}
    catch (e) {setError(e instanceof Error ? e.message : "Could not open a new payment form."); await refresh();}
    finally {guard.current = false; setBusy(false);}
  }
  const locked = busy || !slot || slot.phase !== "draft" || !canRecord;
  const shown = slot?.request ? {...slot.request, amount: String(slot.request.amount)} : draft;
  return <div className="rounded-xl bg-slate-50 p-3 min-w-0" data-testid={"payment-form-" + scope.booking_id}>
    <h4 className="font-bold">Confirm payment received</h4>
    <p className="mt-1 text-xs text-slate-600">Original quotation only. Save one request before sending; recover it after a timeout or reload.</p>
    {error && <p role="alert" className="mt-2 text-sm text-red-800 break-words">{error}</p>}
    {notice && <p role="status" className="mt-2 text-sm text-emerald-900">{notice}</p>}
    {!slot ? <button type="button" className="mt-3 border rounded-lg p-2" onClick={()=>void refresh()}>Recover payment form</button> : <>
      {slot.request && <p className="mt-3 text-xs break-all">Saved request: <strong>{slot.request.idempotency_key}</strong></p>}
      {slot.phase === "pending" && <p className="mt-2 rounded-lg bg-amber-100 p-2 text-sm">Result not yet verified. These payment details are locked. Do not re-enter this payment on another device or clear browser data.</p>}
      {slot.phase === "confirmed" && slot.receipt && <p className="mt-2 rounded-lg bg-emerald-100 p-2 text-sm break-words">Confirmed receipt: {slot.receipt.payment_id}<br/>{philippinesTime(slot.receipt.confirmed_at)}</p>}
      <fieldset disabled={locked} className="mt-3 grid gap-2 disabled:opacity-75">
        <label className="text-sm">Payment type<select className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={shown.payment_kind} onChange={e=>setDraft({...draft,payment_kind:e.target.value as PaymentKind})}>
          <option value="reservation">Reservation</option><option value="balance">Balance</option><option value="full_payment">Full payment</option>
        </select></label>
        <label className="text-sm">Amount received (PHP)<input className="mt-1 w-full rounded-lg border bg-white px-3 py-2" type="number" min="0.01" step="0.01" value={shown.amount} onChange={e=>setDraft({...draft,amount:e.target.value})}/></label>
        <label className="text-sm">Payment channel<input className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={shown.payment_channel} maxLength={80} onChange={e=>setDraft({...draft,payment_channel:e.target.value})}/></label>
        <label className="text-sm">Payment reference<input className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={shown.payment_reference} maxLength={180} onChange={e=>setDraft({...draft,payment_reference:e.target.value})}/></label>
        <label className="text-sm">Payment notes<input className="mt-1 w-full rounded-lg border bg-white px-3 py-2" value={shown.notes} maxLength={1000} onChange={e=>setDraft({...draft,notes:e.target.value})}/></label>
      </fieldset>
      <div className="mt-3 flex flex-wrap gap-2">
        {slot.phase === "draft" && canRecord && <button type="button" disabled={busy||!draft.amount} onClick={()=>void run()} className="rounded-lg bg-emerald-800 px-4 py-2 font-bold text-white disabled:opacity-50">{busy ? "Saving..." : "Confirm Payment"}</button>}
        {slot.phase === "pending" && <><button type="button" disabled={busy} onClick={()=>void run()} className="rounded-lg bg-amber-900 px-4 py-2 font-bold text-white disabled:opacity-50">Retry saved payment</button>
          <button type="button" disabled={busy} onClick={()=>void run(true)} className="rounded-lg border px-4 py-2 disabled:opacity-50">Check saved payment</button></>}
        {slot.phase === "confirmed" && canRecord && <button type="button" disabled={busy} onClick={()=>void another()} className="rounded-lg border px-4 py-2 disabled:opacity-50">Record another payment</button>}
      </div>
      {!canRecord && slot.phase === "draft" && <p className="mt-2 text-sm">No new original-quotation payment is available for this booking.</p>}
    </>}
    <p className="mt-3 text-xs text-slate-500">Recovery is saved in this browser for this owner and booking. Other devices do not share its browser storage.</p>
  </div>;
}
