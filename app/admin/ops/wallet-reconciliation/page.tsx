"use client";

import React, { useMemo, useState } from "react";

function n(x: any) { const v = Number(x); return Number.isFinite(v) ? v : 0; }

export default function WalletReconciliationPage() {
  const [adminKey, setAdminKey] = useState("");
  const [limit, setLimit] = useState(120);
  const [threshold, setThreshold] = useState(0.01);
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);

  async function run() {
    setBusy(true);
    setOut(null);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();
      const res = await fetch(`/api/admin/ops/wallet-reconciliation?limit=${limit}&threshold=${threshold}`, { headers });
      const data = await res.json();
      setOut(data);
    } catch (e: any) {
      setOut({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  const driverRows = useMemo(() => (out?.driver_drift || []) as any[], [out]);
  const vendorRows = useMemo(() => (out?.vendor_drift || []) as any[], [out]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xl font-bold">Wallet Reconciliation</div>
          <div className="text-sm text-slate-500">Detects drift between wallet balances and transaction sums (read-only).</div>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
            placeholder="Admin key (optional)"
            className="rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <input
            value={limit}
            onChange={(e) => setLimit(n(e.target.value))}
            type="number"
            min={10}
            max={500}
            className="w-24 rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <input
            value={threshold}
            onChange={(e) => setThreshold(n(e.target.value))}
            type="number"
            step="0.01"
            min={0}
            className="w-28 rounded-xl border border-black/10 px-3 py-2 text-sm"
          />
          <button
            onClick={run}
            disabled={busy}
            className="rounded-xl bg-black text-white px-4 py-2 text-sm disabled:opacity-50"
          >
            {busy ? "Checking..." : "Run Check"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-black/10 p-4">
          <div className="font-semibold mb-2">Drivers drift</div>
          {driverRows.length === 0 ? (
            <div className="text-sm text-slate-500">(none)</div>
          ) : (
            <div className="space-y-2">
              {driverRows.map((r, i) => (
                <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                  <div className="font-semibold">{r.full_name || r.driver_id}</div>
                  <div className="text-xs text-slate-500">{r.driver_id}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-slate-500">wallet</div><div className="font-mono">{n(r.wallet_balance).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">tx sum</div><div className="font-mono">{n(r.tx_sum).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">drift</div><div className="font-mono">{n(r.drift).toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-black/10 p-4">
          <div className="font-semibold mb-2">Vendors drift</div>
          {vendorRows.length === 0 ? (
            <div className="text-sm text-slate-500">(none)</div>
          ) : (
            <div className="space-y-2">
              {vendorRows.map((r, i) => (
                <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                  <div className="font-semibold">{r.vendor_id}</div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div><div className="text-xs text-slate-500">wallet</div><div className="font-mono">{n(r.wallet_balance).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">tx sum</div><div className="font-mono">{n(r.tx_sum).toFixed(2)}</div></div>
                    <div><div className="text-xs text-slate-500">drift</div><div className="font-mono">{n(r.drift).toFixed(2)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-black/10 p-4">
        <div className="font-semibold mb-2">Raw output</div>
        <pre className="text-xs whitespace-pre-wrap max-h-80 overflow-auto">{out ? JSON.stringify(out, null, 2) : "(no output yet)"}</pre>
      </div>
    </div>
  );
}
