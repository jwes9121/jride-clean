"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase-browser";

const sb = supabaseBrowser;

type PayoutRow = {
  id: number;
  driver_id: string;
  driver_name: string | null;
  amount: number;
  status: string;
  requested_at: string;
  processed_at: string | null;
  payout_method: string | null;
  payout_ref: string | null;

  // these are joined/selected by your view/query (if present)
  wallet_balance?: number | null;
  min_wallet_required?: number | null;
  min_wallet_buffer?: number | null; // optional buffer from rules/table/view
};

function fmtMoney(n: number) {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

function fmtDate(v: string | null | undefined) {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

function shortId(id: string | null | undefined) {
  if (!id) return "";
  if (id.length <= 10) return id;
  return id.slice(0, 4) + "..." + id.slice(-4);
}

function humanizeErrorMessage(msg: string, fallbackTopup?: number) {
  const m = (msg || "").toLowerCase();

  // Most common business failure
  if (m.includes("insufficient wallet") || m.includes("insufficient")) {
    if (typeof fallbackTopup === "number" && fallbackTopup > 0) {
      return `Insufficient wallet. Top up ₱${fmtMoney(fallbackTopup)} to approve.`;
    }
    return "Insufficient wallet to approve this payout.";
  }

  // Generic fallback (keep it short)
  if (msg && msg.length > 140) return msg.slice(0, 140) + "...";
  return msg || "Approval failed.";
}

export default function DriverPayoutsPage() {
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [status, setStatus] = useState<string>("pending");
  const [loading, setLoading] = useState<boolean>(true);

  // simple toast
  const [toast, setToast] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  async function loadData() {
    setLoading(true);

    // NOTE:
    // If you already have a view for admin payouts, replace this query with that view.
    // This query assumes driver_payout_requests has these columns:
    // id, driver_id, amount, status, requested_at, processed_at, payout_method, payout_ref
    // and optionally your select joins wallet_balance/min_wallet_required/min_wallet_buffer via a view or join.
    const q = sb
      .from("driver_payout_requests")
      .select("id,driver_id,amount,status,requested_at,processed_at,payout_method,payout_ref")
      .order("id", { ascending: false })
      .limit(200);

    if (status && status !== "all") q.eq("status", status);

    const { data, error } = await q;

    if (error) {
      setRows([]);
      setToast({ type: "err", text: humanizeErrorMessage(error.message) });
      setLoading(false);
      return;
    }

    // Best-effort: keep UI working even if wallet columns are not in this select.
    setRows((data as any) || []);
    setLoading(false);
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const computed = useMemo(() => {
    return rows.map((r) => {
      const wallet = Number(r.wallet_balance ?? 0);
      const minReq = Number(r.min_wallet_required ?? 0);
      const buffer = Number(r.min_wallet_buffer ?? 0);
      const requiredAfter = minReq + buffer;
      const walletAfter = wallet - Number(r.amount ?? 0);
      const topupNeeded = Math.max(0, requiredAfter - walletAfter);

      const eligible = r.status === "pending" && walletAfter >= requiredAfter;

      return {
        ...r,
        _wallet: wallet,
        _minReq: minReq,
        _buffer: buffer,
        _requiredAfter: requiredAfter,
        _walletAfter: walletAfter,
        _topupNeeded: topupNeeded,
        _eligible: eligible,
      };
    });
  }, [rows]);

  async function handleApprove(row: any) {
    // If not eligible, do not call RPC; show a small message instead.
    if (!row._eligible) {
      setToast({
        type: "err",
        text: `Insufficient wallet. Top up ₱${fmtMoney(row._topupNeeded)} to approve.`,
      });
      return;
    }

    const refRaw = prompt("GCash reference number (required to approve):", "") ?? "";
    const ref = refRaw.trim();
    if (!ref) {
      setToast({ type: "err", text: "GCash reference number is required." });
      return;
    }

    const { error } = await sb.rpc("driver_admin_approve_payout", {
      p_request_id: row.id,
      p_admin_note: null,
      p_payout_method: "gcash",
      p_payout_ref: ref,
      p_receipt_url: null,
    });

    if (error) {
      setToast({ type: "err", text: humanizeErrorMessage(error.message, row._topupNeeded) });
      return;
    }

    setToast({ type: "ok", text: "Approved." });
    await loadData();
  }

  return (
    <main className="p-6 max-w-7xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Driver Payouts</h1>

        <div className="flex items-center gap-3">
          <label className="text-sm">Status:</label>
          <select
            className="border rounded px-2 py-1 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="rejected">rejected</option>
            <option value="all">all</option>
          </select>

          <button
            className="border rounded px-3 py-1 text-sm"
            onClick={() => loadData()}
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
        </div>
      </div>

      {toast && (
        <div
          className={
            "rounded border px-3 py-2 text-sm " +
            (toast.type === "ok" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200")
          }
        >
          <div className="flex items-center justify-between gap-3">
            <span>{toast.text}</span>
            <button className="text-xs underline" onClick={() => setToast(null)}>
              close
            </button>
          </div>
        </div>
      )}

      <div className="overflow-auto border rounded">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50">
            <tr className="text-left">
              <th className="p-2 border-b">id</th>
              <th className="p-2 border-b">driver</th>
              <th className="p-2 border-b">amount</th>
              <th className="p-2 border-b">status</th>
              <th className="p-2 border-b">requested_at</th>
              <th className="p-2 border-b">processed_at</th>
              <th className="p-2 border-b">method</th>
              <th className="p-2 border-b">ref</th>
              <th className="p-2 border-b">actions</th>
            </tr>
          </thead>
          <tbody>
            {computed.length === 0 ? (
              <tr>
                <td className="p-3 text-gray-600" colSpan={9}>
                  No payouts.
                </td>
              </tr>
            ) : (
              computed.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="p-2 border-b">{r.id}</td>
                  <td className="p-2 border-b">
                    <div className="font-medium">{r.driver_name ?? shortId(r.driver_id)}</div>
                    <div className="text-xs text-gray-500">{r.driver_id}</div>
                  </td>
                  <td className="p-2 border-b">₱{fmtMoney(Number(r.amount ?? 0))}</td>
                  <td className="p-2 border-b">{r.status}</td>
                  <td className="p-2 border-b">{fmtDate(r.requested_at)}</td>
                  <td className="p-2 border-b">{fmtDate(r.processed_at)}</td>
                  <td className="p-2 border-b">{r.payout_method ?? ""}</td>
                  <td className="p-2 border-b">{r.payout_ref ?? ""}</td>
                  <td className="p-2 border-b">
                    {r.status !== "pending" ? (
                      <span className="text-gray-500">—</span>
                    ) : r._eligible ? (
                      <button
                        className="px-3 py-1 rounded bg-black text-white"
                        onClick={() => handleApprove(r)}
                      >
                        Approve
                      </button>
                    ) : (
                      <button
                        className="px-3 py-1 rounded bg-red-100 text-red-800 cursor-not-allowed"
                        title={`Insufficient wallet. Top up ₱${fmtMoney(r._topupNeeded)}.`}
                        onClick={() => handleApprove(r)}
                      >
                        Insufficient
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-gray-500">
        Tip: “Insufficient” is a normal business rule — we don’t show raw Postgres errors anymore.
      </div>
    </main>
  );
}
