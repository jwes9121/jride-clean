"use client";

import React, { useMemo, useState } from "react";

export type AdminPayoutRow = {
  id: string;
  driver_id: string;
  amount: number | null;
  status: string | null;
  requested_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  admin_note: string | null;

  driver_name: string | null;
  wallet_balance: number | null;
  min_wallet_required: number | null;
  wallet_is_locked: boolean | null;
};

type Props = {
  rows: AdminPayoutRow[];
  onRefresh: () => Promise<void> | void;
};

function fmtPeso(n: any): string {
  const v = typeof n === "number" ? n : parseFloat(String(n ?? "0"));
  if (!Number.isFinite(v)) return "₱0";
  return `₱${Math.round(v).toLocaleString("en-PH")}`;
}

function fmtTime(s?: string | null) {
  if (!s) return "--";
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function normStatus(s?: string | null) {
  return String(s ?? "").trim().toLowerCase();
}

function pillClass(status: string) {
  if (status === "paid") return "bg-emerald-100 text-emerald-700";
  if (status === "rejected") return "bg-rose-100 text-rose-700";
  if (status === "cancelled") return "bg-slate-200 text-slate-700";
  return "bg-amber-100 text-amber-800";
}

export default function AdminPayoutPanel({ rows, onRefresh }: Props) {
  const [tab, setTab] = useState<"pending" | "paid" | "rejected" | "all">("pending");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [noteById, setNoteById] = useState<Record<string, string>>({});

  const grouped = useMemo(() => {
    const pending: AdminPayoutRow[] = [];
    const paid: AdminPayoutRow[] = [];
    const rejected: AdminPayoutRow[] = [];
    const all: AdminPayoutRow[] = [];

    for (const r of rows || []) {
      const st = normStatus(r.status);
      all.push(r);
      if (st === "paid") paid.push(r);
      else if (st === "rejected") rejected.push(r);
      else pending.push(r);
    }

    const sortDesc = (a: AdminPayoutRow, b: AdminPayoutRow) => {
      const ta = a.requested_at ? new Date(a.requested_at).getTime() : 0;
      const tb = b.requested_at ? new Date(b.requested_at).getTime() : 0;
      return tb - ta;
    };

    pending.sort(sortDesc);
    paid.sort(sortDesc);
    rejected.sort(sortDesc);
    all.sort(sortDesc);

    return { pending, paid, rejected, all };
  }, [rows]);

  const visible = tab === "pending"
    ? grouped.pending
    : tab === "paid"
    ? grouped.paid
    : tab === "rejected"
    ? grouped.rejected
    : grouped.all;

  async function approve(id: string) {
    setBusyId(id);
    try {
      const note = (noteById[id] ?? "").trim() || "manual approve";
      const res = await fetch("/api/admin/payouts/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, reviewedBy: "admin", note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Approve failed (${res.status}): ${json?.message ?? json?.error ?? "Unknown error"}`);
        return;
      }
      await onRefresh?.();
      alert("Approved / Marked PAID.");
    } finally {
      setBusyId(null);
    }
  }

  async function reject(id: string) {
    setBusyId(id);
    try {
      const note = (noteById[id] ?? "").trim() || "manual reject";
      const res = await fetch("/api/admin/payouts/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId: id, reviewedBy: "admin", note }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        alert(`Reject failed (${res.status}): ${json?.message ?? json?.error ?? "Unknown error"}`);
        return;
      }
      await onRefresh?.();
      alert("Rejected.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="rounded border bg-white">
      <div className="flex items-center justify-between border-b bg-slate-50 px-3 py-2">
        <div className="text-xs font-semibold">Payout Requests (Admin)</div>
        <button
          className="rounded bg-slate-800 px-3 py-2 text-[11px] font-semibold text-white hover:bg-slate-900"
          onClick={() => onRefresh?.()}
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-2 px-3 py-2 text-[11px]">
        <button className={`rounded px-2 py-1 font-semibold ${tab==="pending" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`} onClick={() => setTab("pending")}>
          Pending ({grouped.pending.length})
        </button>
        <button className={`rounded px-2 py-1 font-semibold ${tab==="paid" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`} onClick={() => setTab("paid")}>
          Paid ({grouped.paid.length})
        </button>
        <button className={`rounded px-2 py-1 font-semibold ${tab==="rejected" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`} onClick={() => setTab("rejected")}>
          Rejected ({grouped.rejected.length})
        </button>
        <button className={`rounded px-2 py-1 font-semibold ${tab==="all" ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`} onClick={() => setTab("all")}>
          All ({grouped.all.length})
        </button>
      </div>

      {/* FORCE VISIBLE AREA + SCROLL */}
      <div className="max-h-[320px] overflow-auto border-t">
        <table className="w-full text-xs border-collapse">
          <thead className="sticky top-0 bg-white z-10">
            <tr>
              <th className="border px-2 py-2 text-left">Driver</th>
              <th className="border px-2 py-2 text-left">Status</th>
              <th className="border px-2 py-2 text-right">Amount</th>
              <th className="border px-2 py-2 text-left">Requested</th>
              <th className="border px-2 py-2 text-left">Reviewed</th>
              <th className="border px-2 py-2 text-left">Wallet</th>
              <th className="border px-2 py-2 text-left">Note</th>
              <th className="border px-2 py-2 text-left">Actions</th>
            </tr>
          </thead>

          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td className="border px-2 py-3 text-slate-500" colSpan={8}>
                  No rows in this tab.
                </td>
              </tr>
            ) : (
              visible.map((r) => {
                const st = normStatus(r.status);
                const busy = busyId === r.id;
                const note = noteById[r.id] ?? "";

                return (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="border px-2 py-2">
                      <div className="font-semibold">{r.driver_name ?? "Unknown driver"}</div>
                      <div className="text-[10px] text-slate-500 font-mono">{r.driver_id}</div>
                    </td>

                    <td className="border px-2 py-2">
                      <span className={`inline-block rounded px-2 py-1 text-[10px] font-bold ${pillClass(st)}`}>
                        {st || "pending"}
                      </span>
                      {r.wallet_is_locked ? (
                        <div className="mt-1 text-[10px] font-semibold text-rose-700">Wallet Locked</div>
                      ) : null}
                    </td>

                    <td className="border px-2 py-2 text-right font-semibold">
                      {fmtPeso(r.amount ?? 0)}
                    </td>

                    <td className="border px-2 py-2 text-[11px]">{fmtTime(r.requested_at)}</td>

                    <td className="border px-2 py-2 text-[11px]">
                      <div>{fmtTime(r.reviewed_at)}</div>
                      <div className="text-[10px] text-slate-500">{r.reviewed_by ?? "--"}</div>
                    </td>

                    <td className="border px-2 py-2 text-[11px]">
                      <div>Bal: <span className="font-semibold">{fmtPeso(r.wallet_balance ?? 0)}</span></div>
                      <div className="text-[10px] text-slate-500">Min: {fmtPeso(r.min_wallet_required ?? 0)}</div>
                    </td>

                    <td className="border px-2 py-2">
                      <input
                        className="w-full rounded border px-2 py-1 text-[11px]"
                        placeholder="admin note"
                        value={note}
                        onChange={(e) => setNoteById((m) => ({ ...m, [r.id]: e.target.value }))}
                      />
                      {r.admin_note ? (
                        <div className="mt-1 text-[10px] text-slate-500">DB: {r.admin_note}</div>
                      ) : null}
                    </td>

                    <td className="border px-2 py-2">
                      {st === "paid" ? (
                        <span className="text-[11px] text-slate-500">Paid</span>
                      ) : (
                        <div className="flex gap-2">
                          <button
                            disabled={busy}
                            className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                            onClick={() => approve(r.id)}
                          >
                            {busy ? "..." : "Approve"}
                          </button>
                          <button
                            disabled={busy}
                            className="rounded bg-rose-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-rose-700 disabled:opacity-60"
                            onClick={() => reject(r.id)}
                          >
                            {busy ? "..." : "Reject"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}