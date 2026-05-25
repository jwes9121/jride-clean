"use client";

import { useMemo, useState } from "react";

type AnyObj = Record<string, any>;

function toNum(x: string) {
  const n = Number((x || "").toString().trim());
  return Number.isFinite(n) ? n : 0;
}

export default function WalletAdjustAdminPage() {
  const [adminKey, setAdminKey] = useState("");
  const [tab, setTab] = useState<"driver" | "vendor" | "vendor_settle">("driver");

  // driver section
  const [driverQuery, setDriverQuery] = useState("");
  const [driverSuggestions, setDriverSuggestions] = useState<any[]>([]);
  const [driverId, setDriverId] = useState("");
  const [reasonMode, setReasonMode] = useState("manual_topup");
  const [receiptRef, setReceiptRef] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("manual_adjust");
  const [createdBy, setCreatedBy] = useState("admin");
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookup, setLookup] = useState<AnyObj | null>(null);
  const [resp, setResp] = useState<AnyObj | null>(null);

  // audit panel
  const [auditBusy, setAuditBusy] = useState(false);
  const [auditRows, setAuditRows] = useState<AnyObj | null>(null);

  const headers = useMemo(() => {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
    return h;
  }, [adminKey]);

  function genReceipt() {
    const d = new Date();
    const yy = d.getFullYear().toString();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const rand = Math.random().toString(16).slice(2, 6);
    const r = `JRIDE-WALLET-${yy}${mm}${dd}-${hh}${mi}${ss}-${rand}`;
    setReceiptRef(r);
    if (!externalRef.trim()) setExternalRef(r);
    if (reasonMode === "manual_cashout") {
      setReason("Driver Load Wallet Cashout (Manual Payout)");
    } else if (reasonMode === "manual_topup") {
      setReason("Manual Topup (Admin Credit)");
    } else if (reasonMode === "promo_free_ride_credit") {
      setReason("Promo Free Ride Credit");
    }
  }

  async function suggestDrivers(q: string) {
    setDriverQuery(q);
    if (q.trim().length < 2) {
      setDriverSuggestions([]);
      return;
    }
    try {
      const res = await fetch("/api/wallet/transactions?q=" + encodeURIComponent(q.trim()), { headers: adminKey.trim() ? { "x-admin-key": adminKey.trim() } : {}, cache: "no-store" });
      const json = await res.json();
      setDriverSuggestions(json.drivers || []);
    } catch {
      setDriverSuggestions([]);
    }
  }

  async function lookupWallet(id: string) {
    setLookupBusy(true);
    setLookup(null);
    try {
      const h: Record<string, string> = {};
      if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
      const res = await fetch("/api/wallet/transactions?driver_id=" + encodeURIComponent(id), { headers: h, cache: "no-store" });
      const json = await res.json();
      setLookup(json);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }

  async function loadAudit(id: string) {
    setAuditBusy(true);
    setAuditRows(null);
    try {
      const h: Record<string, string> = {};
      if (adminKey.trim()) h["x-admin-key"] = adminKey.trim();
      const res = await fetch("/api/wallet/audit?driver_id=" + encodeURIComponent(id), { headers: h, cache: "no-store" });
      const json = await res.json();
      setAuditRows(json);
    } catch (e: any) {
      setAuditRows({ ok: false, error: e?.message || String(e) });
    } finally {
      setAuditBusy(false);
    }
  }

  async function applyDriverAdjust() {
    setBusy(true);
    setResp(null);

    const id = driverId.trim();
    const rawAmt = toNum(amount);

    try {
      const payload: AnyObj = {
        kind: "driver_adjust",
        driver_id: id,
        amount: rawAmt,
        reason_mode: reasonMode,
        reason: reason.trim() || "manual_adjust",
        created_by: createdBy.trim() || "admin",
        method: "gcash",
        external_ref: externalRef.trim() || receiptRef.trim() || null,
        request_id: null,
      };

      const res = await fetch("/api/wallet/adjust", {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      setResp(json);
    } catch (e: any) {
      setResp({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6">
      <div className="text-2xl font-semibold">Wallet Adjustments (Admin)</div>
      <div className="text-sm opacity-70 mt-1">Manual driver credit/debit + vendor wallet adjustments and full settle.</div>

      <div className="mt-6 rounded-xl border border-black/10 p-4">
        <div className="text-sm font-semibold">Optional Admin Key</div>
        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2"
          placeholder="x-admin-key (only needed if ADMIN_API_KEY is set)"
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
        />
        <div className="mt-2 text-xs opacity-60">
          If your API is open (no ADMIN_API_KEY set), you can leave this blank.
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <button onClick={() => setTab("driver")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "driver" ? "bg-black text-white" : "bg-white")}>Driver Adjust</button>
        <button onClick={() => setTab("vendor")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor" ? "bg-black text-white" : "bg-white")}>Vendor Adjust</button>
        <button onClick={() => setTab("vendor_settle")} className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor_settle" ? "bg-black text-white" : "bg-white")}>Vendor Settle (Full)</button>
      </div>

      {tab === "driver" && (
        <div className="mt-4 rounded-xl border border-black/10 p-4">
          <div className="text-lg font-semibold">Driver wallet credit/debit</div>

          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <div className="text-xs opacity-70 mb-1">Select Driver (type name or UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder='Type driver name... e.g "Juan"'
                value={driverQuery}
                onChange={(e) => suggestDrivers(e.target.value)}
              />
              <div className="mt-2 text-xs opacity-60">Tip: click a suggestion to auto-fill the Driver ID (UUID).</div>

              {driverSuggestions.length > 0 && (
                <div className="mt-2 rounded-lg border border-black/10 overflow-hidden">
                  {driverSuggestions.map((d, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setDriverId(d.id);
                        setDriverQuery(d.label || d.driver_name || d.id);
                        setDriverSuggestions([]);
                      }}
                      className="w-full text-left px-3 py-2 hover:bg-black/5 text-sm"
                    >
                      {d.label || d.driver_name || d.id}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs opacity-70 mb-1">Driver ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="driver_id (uuid)"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              />

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div className="text-xs opacity-70 mb-1">Reason Mode</div>
                  <select
                    value={reasonMode}
                    onChange={(e) => setReasonMode(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                  >
                    <option value="manual_topup">Manual Topup (Admin Credit)</option>
                    <option value="manual_cashout">Manual Cashout (GCash payout - deduct load wallet)</option>
                    <option value="promo_free_ride_credit">Promo Free Ride Credit</option>
                    <option value="correction">Correction</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs opacity-70 mb-1">Receipt Reference (read-only)</div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2 bg-black/5"
                    value={receiptRef}
                    readOnly
                    placeholder="(auto-generated when you click Generate)"
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={genReceipt}
                className="mt-3 w-full rounded-xl border border-black/10 px-4 py-2"
              >
                Generate Reason + Receipt Ref
              </button>

              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                    placeholder="amount (e.g. 250 or -100)"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                  />
                </div>
                <div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                    placeholder="admin"
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                  />
                </div>
              </div>

              <input
                className="mt-3 w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="manual_adjust"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />

              <div className="mt-3 flex gap-2">
                <button
                  disabled={busy || !driverId.trim()}
                  onClick={applyDriverAdjust}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
                >
                  {busy ? "Applying..." : "Apply Driver Adjustment"}
                </button>

                <button
                  disabled={lookupBusy || !driverId.trim()}
                  onClick={() => lookupWallet(driverId.trim())}
                  className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
                >
                  {lookupBusy ? "Looking up..." : "Lookup Driver Wallet"}
                </button>

                <button
                  disabled={auditBusy || !driverId.trim()}
                  onClick={() => loadAudit(driverId.trim())}
                  className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
                >
                  {auditBusy ? "Loading audit..." : "Load Wallet Audit"}
                </button>
              </div>

              <div className="mt-2 text-xs opacity-60">
                Uses audited functions where available. Cashout uses admin_driver_cashout_load_wallet (non-negative safety enforced by DB).
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-black/10 p-4">
            <div className="text-lg font-semibold">Lookup</div>
            <div className="text-xs opacity-60 mt-1">Balance + last 20 transactions.</div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {lookup ? JSON.stringify(lookup, null, 2) : "(no lookup yet)"}
            </pre>
          </div>

          <div className="mt-4 rounded-xl border border-black/10 p-4 bg-slate-50">
            <div className="font-semibold">Wallet Admin Audit (confirmation / accountability)</div>
            <div className="mt-1 text-xs opacity-60">
              Shows receipt_ref, before/after balance, status, and error_message for topups/cashouts.
            </div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {auditRows ? JSON.stringify(auditRows, null, 2) : "(no audit loaded yet)"}
            </pre>
          </div>

          <div className="mt-6 rounded-xl border border-black/10 p-4">
            <div className="text-lg font-semibold">Response</div>
            <pre className="mt-3 text-xs whitespace-pre-wrap max-h-64 overflow-auto rounded-lg border border-black/10 bg-white p-3">
              {resp ? JSON.stringify(resp, null, 2) : "(no output yet)"}
            </pre>
          </div>
        </div>
      )}

      {(tab === "vendor" || tab === "vendor_settle") && (
        <div className="mt-4 rounded-xl border border-black/10 p-4">
          <div className="text-lg font-semibold">Vendor</div>
          <div className="text-sm opacity-70 mt-1">
            Vendor Adjust / Vendor Settle UI is unchanged in this V3.1 rewrite. We can wire it next if you want.
          </div>
        </div>
      )}
    </div>
  );
}