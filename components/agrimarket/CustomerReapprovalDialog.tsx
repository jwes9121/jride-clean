"use client";

import { useEffect, useRef } from "react";
import ReapprovalCountdown, { useReapprovalSeconds } from "./ReapprovalCountdown";

type Proposal = {
  approved_total: number; revised_total: number; increase_amount: number;
  approved_vehicle_type: string; revised_vehicle_type: string; vehicle_escalated: boolean;
  expires_at?: string | null;
  charge_breakdown?: { products: number; delivery: number; heavy_load_fee: number; special_handling_fee: number; driver_approach_fee: number; driver_approach_fee_locked: boolean } | null;
};
const money = (n: number) => `PHP ${Number(n || 0).toFixed(2)}`;
const vehicle = (s: string) => s === "kolong_kolong" ? "Kolong-Kolong" : s === "tricycle" ? "Tricycle" : "Motorcycle";

export default function CustomerReapprovalDialog({ proposal, serverNow, busy, error, onRespond, onExpire }: {
  proposal: Proposal; serverNow?: string | null; busy: boolean; error: string;
  onRespond: (response: "accept" | "reject") => void; onExpire: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const expired = useRef(false);
  const seconds = useReapprovalSeconds(proposal.expires_at, serverNow);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { expired.current = false; }, [proposal.expires_at]);
  useEffect(() => {
    if (seconds === 0 && !expired.current) { expired.current = true; onExpire(); }
  }, [seconds, onExpire]);
  const fees = proposal.charge_breakdown;
  return <dialog ref={dialog} aria-labelledby="revision-heading" onCancel={event => event.preventDefault()}
    className="w-[calc(100%_-_1.5rem)] max-w-lg rounded-2xl border-2 border-amber-400 p-0 text-slate-900 shadow-xl backdrop:bg-slate-950/50">
    <div className="flex max-h-[85dvh] flex-col">
      <div className="border-b bg-amber-50 p-4" role="alert">
        <h2 id="revision-heading" className="text-xl font-bold">Approve revised order</h2>
        <p className="mt-1 text-sm">The farmer confirmed different delivery charges or vehicle requirements.</p>
        <ReapprovalCountdown expiresAt={proposal.expires_at} serverNow={serverNow} />
      </div>
      <div className="overflow-y-auto p-4 text-sm">
        <p>Previously approved: <strong>{money(proposal.approved_total)}</strong></p>
        <p className="mt-1 text-lg">Revised total: <strong>{money(proposal.revised_total)}</strong></p>
        <p>Increase: <strong>{money(proposal.increase_amount)}</strong></p>
        {proposal.vehicle_escalated ? <p className="mt-2">Vehicle: <strong>{vehicle(proposal.approved_vehicle_type)} to {vehicle(proposal.revised_vehicle_type)}</strong></p> : null}
        {fees ? <dl className="mt-3 space-y-1 rounded-xl bg-slate-50 p-3">
          {[["Products", fees.products], ["Delivery", fees.delivery], ["Heavy load", fees.heavy_load_fee], ["Special handling", fees.special_handling_fee]].map(([label, amount]) => <div key={label} className="flex justify-between gap-3"><dt>{label}</dt><dd>{money(Number(amount))}</dd></div>)}
          <div className="flex justify-between gap-3"><dt>Driver approach</dt><dd>{fees.driver_approach_fee_locked ? money(fees.driver_approach_fee) : "Pending driver assignment"}</dd></div>
        </dl> : null}
        <p className="mt-3">If you do not respond within five minutes, this order will be cancelled and the reserved stock released.</p>
        {error ? <p role="alert" className="mt-2 text-red-700">{error}</p> : null}
      </div>
      <div className="flex shrink-0 flex-wrap gap-2 border-t bg-white p-4">
        <button type="button" disabled={busy || seconds == null || seconds === 0} onClick={() => onRespond("accept")} className="flex-1 rounded-xl bg-emerald-700 px-3 py-3 font-bold text-white disabled:opacity-50">Accept revised charges</button>
        <button type="button" disabled={busy || seconds === 0} onClick={() => onRespond("reject")} className="rounded-xl border border-red-700 px-3 py-3 font-bold text-red-700 disabled:opacity-50">Cancel order</button>
      </div>
    </div>
  </dialog>;
}
