"use client";

import { useEffect, useMemo, useState } from "react";

type DriverResult = any;

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export default function AdminWalletAdjustPage() {
  // ===== JRIDE_ADMIN_WALLET_LOOKUP_STATE_START =====
  const [lookup, setLookup] = useState<any>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  async function runDriverLookup(driver_id: string) {
    setLookupBusy(true); setLookup(null);
    try {
      const headers: Record<string, string> = {};
      // Optional admin key support if your page has an adminKey state
      // @ts-ignore
      if (typeof adminKey !== "undefined" && String(adminKey || "").trim()) {
        headers["x-admin-key"] = String(adminKey || "").trim();
      }

      const res = await fetch(
        `/api/admin/wallet/driver-summary?driver_id=${encodeURIComponent(driver_id)}`,
        { headers }
      );
      const data = await res.json();
      setLookup(data);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }

  async function runVendorLookup(vendor_id: string) {
    setLookupBusy(true); setLookup(null);
    try {
      const headers: Record<string, string> = {};
      // @ts-ignore
      if (typeof adminKey !== "undefined" && String(adminKey || "").trim()) {
        headers["x-admin-key"] = String(adminKey || "").trim();
      }

      const res = await fetch(
        `/api/admin/wallet/vendor-summary?vendor_id=${encodeURIComponent(vendor_id)}`,
        { headers }
      );
      const data = await res.json();
      setLookup(data);
    } catch (e: any) {
      setLookup({ ok: false, error: e?.message || String(e) });
    } finally {
      setLookupBusy(false);
    }
  }
  // ===== JRIDE_ADMIN_WALLET_LOOKUP_STATE_END =====

  const [tab, setTab] = useState<"driver" | "vendor_adjust" | "vendor_settle">("driver");

  // Admin-key is optional (only needed if ADMIN_API_KEY is set on server)
  const [adminKey, setAdminKey] = useState<string>("");

  // Driver adjust
  const [driverId, setDriverId] = useState("");
  const [driverAmount, setDriverAmount] = useState<string>("");
  const [driverReason, setDriverReason] = useState<string>("manual_adjust");
  const [createdBy, setCreatedBy] = useState<string>("admin");
  // Driver dropdown + receipt reference helpers
  const [driverIds, setDriverIds] = useState<string[]>([]);
  const [driverPick, setDriverPick] = useState<string>("");
  const [receiptRef, setReceiptRef] = useState<string>("");
  const [reasonMode, setReasonMode] = useState<string>("manual_topup"); // manual_topup | promo_free_ride | correction

  function shortId(id: string) {
    const s = String(id || "");
    if (s.length <= 10) return s;
    return s.slice(0, 8) + "..." + s.slice(-4);
  }

  function genReceiptRef() {
    // Example: WALLET-20260122-064900-AB12
    const d = new Date();
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const da = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "WALLET-" + y + mo + da + "-" + hh + mm + ss + "-" + rnd;
  }

  function buildReason() {
    const id = driverId.trim();
    const amt = toNum(driverAmount);
    const ref = receiptRef || genReceiptRef();

    let reason = "manual_adjust";
    if (reasonMode === "manual_topup") {
      reason = "topup_manual:" + shortId(id) + ":" + ref + ":" + amt;
    } else if (reasonMode === "promo_free_ride") {
      // Use for launch promo: crediting driver for free rides
      reason = "promo_free_ride_credit:" + shortId(id) + ":" + ref + ":" + amt;
    } else if (reasonMode === "correction") {
      reason = "correction:" + shortId(id) + ":" + ref + ":" + amt;
    }
    return { reason, ref };
  }

  async function loadDriverIds() {
    try {
      const res = await fetch("/api/admin/wallet/drivers");
      const j = await res.json();
      if (j && j.ok && Array.isArray(j.drivers)) setDriverIds(j.drivers);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    loadDriverIds();
  }, []);

  useEffect(() => {
    // Keep driverId in sync with dropdown if used
    if (driverPick && driverPick.trim()) setDriverId(driverPick.trim());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverPick]);


  // Vendor adjust
  const [vendorId, setVendorId] = useState("");
  const [vendorAmount, setVendorAmount] = useState<string>("");
  const [vendorKind, setVendorKind] = useState<string>("adjustment");
  const [vendorNote, setVendorNote] = useState<string>("manual_adjust");

  // Vendor settle
  const [settleVendorId, setSettleVendorId] = useState("");
  const [settleNote, setSettleNote] = useState<string>("Cash payout settlement");

  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);
  const outText = useMemo(() => (out ? JSON.stringify(out, null, 2) : ""), [out]);

  async function postJson(url: string, body: any) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    const text = await res.text();
    let data: any = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }

    if (!res.ok) throw new Error((data && (data.message || data.error)) ? (data.message || data.error) : `HTTP ${res.status}`);
    return data;
  }

  async function runDriverAdjust() {
    setBusy(true); setOut(null);
    try {
      if (!receiptRef || !driverReason || driverReason === "manual_adjust") {
        const nextRef = receiptRef || genReceiptRef();
        const built = buildReason();
        setReceiptRef(nextRef);
        setDriverReason(built.reason);
      }
      const amt = toNum(driverAmount);
      const data = await postJson("/api/admin/wallet/adjust", {
        kind: "driver_adjust",
        driver_id: driverId.trim(),
        amount: amt,
        reason: driverReason,
        created_by: createdBy,
      });
      setOut(data as DriverResult);
    } catch (e: any) {
      setOut({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function runVendorAdjust() {
    setBusy(true); setOut(null);
    try {
      const amt = toNum(vendorAmount);
      const data = await postJson("/api/admin/wallet/adjust", {
        kind: "vendor_adjust",
        vendor_id: vendorId.trim(),
        amount: amt,
        kind2: vendorKind,
        note: vendorNote,
      });
      setOut(data);
    } catch (e: any) {
      setOut({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  async function runVendorSettle() {
    setBusy(true); setOut(null);
    try {
      const data = await postJson("/api/admin/vendor/settle-wallet", {
        vendor_id: settleVendorId.trim(),
        note: settleNote,
      });
      setOut(data);
    } catch (e: any) {
      setOut({ ok: false, error: e?.message || String(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div>
        <div className="text-2xl font-bold">Wallet Adjustments (Admin)</div>
        <div className="text-sm text-slate-600">
          Manual driver credit/debit + vendor wallet adjustments and full settle.
        </div>
      </div>

      <div className="rounded-xl border border-black/10 p-4 space-y-2">
        <div className="text-sm font-semibold">Optional Admin Key</div>
        <input
          value={adminKey}
          onChange={(e) => setAdminKey(e.target.value)}
          placeholder="x-admin-key (only needed if ADMIN_API_KEY is set)"
          className="w-full rounded-lg border border-black/10 px-3 py-2"
        />
        <div className="text-xs text-slate-500">
          If your API is open (no ADMIN_API_KEY set), you can leave this blank.
        </div>
      </div>

      <div className="flex gap-2">
        <button
          className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "driver" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("driver")}
        >
          Driver Adjust
        </button>
        <button
          className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor_adjust" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("vendor_adjust")}
        >
          Vendor Adjust
        </button>
        <button
          className={"rounded-xl px-4 py-2 border border-black/10 " + (tab === "vendor_settle" ? "bg-black text-white" : "bg-white")}
          onClick={() => setTab("vendor_settle")}
        >
          Vendor Settle (Full)
        </button>
      </div>

      {tab === "driver" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Driver wallet credit/debit</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Select Driver (recommended)</div>
    <select
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      value={driverPick}
      onChange={(e) => setDriverPick(e.target.value)}
    >
      <option value="">-- choose driver id --</option>
      {driverIds.map((id) => (
        <option key={id} value={id}>
          {shortId(id)} ({id})
        </option>
      ))}
    </select>
    <div className="text-[11px] text-slate-500">If list is empty, your API key/env may block listing. You can still paste UUID below.</div>
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Driver ID (UUID)</div>
    <input
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      placeholder="driver_id (uuid)"
      value={vendorId}
      onChange={(e) => { setVendorId(e.target.value); setDriverPick(""); }}
    />
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Amount</div>
    <input
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      placeholder="amount (e.g. 250 or -100)"
      value={vendorAmount}
      onChange={(e) => setVendorAmount(e.target.value)}
    />
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Reason Mode</div>
    <select
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      value={reasonMode}
      onChange={(e) => setReasonMode(e.target.value)}
    >
      <option value="manual_topup">Manual Topup</option>
      <option value="promo_free_ride">Promo: Free Ride Credit</option>
      <option value="correction">Correction</option>
    </select>
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Reason (auto or manual)</div>
    <input
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      placeholder="reason"
      value={vendorNote}
      onChange={(e) => setVendorNote(e.target.value)}
    />
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Receipt Reference (read-only)</div>
    <input
      className="w-full rounded-lg border border-black/10 px-3 py-2 bg-slate-50"
      value={receiptRef || "(auto-generated when you click Generate)"}
      readOnly
    />
  </div>

  <div className="space-y-1">
    <div className="text-xs font-semibold text-slate-600">Created By</div>
    <input
      className="w-full rounded-lg border border-black/10 px-3 py-2"
      placeholder="created_by"
      value={createdBy}
      onChange={(e) => setCreatedBy(e.target.value)}
    />
  </div>

  <div className="space-y-1 flex items-end">
    <button
      type="button"
      className="w-full rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5"
      onClick={() => {
        const nextRef = receiptRef || genReceiptRef();
        if (!receiptRef) setReceiptRef(nextRef);
        const built = buildReason();
        setDriverReason(built.reason);
        setReceiptRef(built.ref);
      }}
    >
      Generate Reason + Receipt Ref
    </button>
  </div>
</div>

<button
            disabled={busy}
            onClick={runDriverAdjust}
            className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Working..." : "Apply Driver Adjustment"}
          </button>
          <div className="text-xs text-slate-500">
            Uses <code>admin_adjust_driver_wallet</code> (non-negative safety enforced).
          </div>
        </div>
      )}

            {tab === "vendor_adjust" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor wallet adjustment entry</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Vendor ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="vendor_id (uuid)"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Amount</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="amount (e.g. 250 or -100)"
                value={vendorAmount}
                onChange={(e) => setVendorAmount(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Kind</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="adjustment | earning | payout | etc"
                value={vendorKind}
                onChange={(e) => setVendorKind(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Note</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="manual_adjust"
                value={vendorNote}
                onChange={(e) => setVendorNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => runVendorLookup(vendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5 disabled:opacity-50"
              title="Shows balance + last 20 vendor transactions in the Lookup panel"
            >
              Lookup Vendor
            </button>

            <button
              disabled={busy}
              onClick={runVendorAdjust}
              className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Insert Vendor Adjustment"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Inserts a row into <code>vendor_wallet_transactions</code> (booking_code null). Does not require Xendit/GCash.
          </div>
        </div>
      )}
      {tab === "vendor_settle" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor settle full balance (payout)</div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Vendor ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="vendor_id (uuid)"
                value={settleVendorId}
                onChange={(e) => setSettleVendorId(e.target.value)}
              />
            </div>

            <div className="space-y-1">
              <div className="text-xs font-semibold text-slate-600">Note</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="Cash payout settlement"
                value={settleNote}
                onChange={(e) => setSettleNote(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              disabled={busy}
              onClick={() => runVendorLookup(settleVendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 hover:bg-black/5 disabled:opacity-50"
              title="Shows balance + last 20 vendor transactions in the Lookup panel"
            >
              Lookup Vendor
            </button>

            <button
              disabled={busy}
              onClick={runVendorSettle}
              className="rounded-xl bg-amber-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Settle Vendor Wallet (Full Payout)"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Uses <code>settle_vendor_wallet</code> (inserts negative payout row and resets vendor_wallet.balance).
          </div>
        </div>
      )}
<div className="rounded-xl border border-black/10 p-4 space-y-2">
        <div className="font-semibold">Lookup</div>
        <div className="text-xs text-slate-500">Balance + last 20 transactions.</div>
        <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto">{lookup ? JSON.stringify(lookup, null, 2) : "(no lookup yet)"}</pre>
      </div>
<div className="rounded-xl border border-black/10 p-4">
        <div className="font-semibold mb-2">Response</div>
        <pre className="text-xs whitespace-pre-wrap">{outText || "(no output yet)"}</pre>
      </div>
    </div>
  );
}




