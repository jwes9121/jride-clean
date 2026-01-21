"use client";

import { useMemo, useState } from "react";

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
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="driver_id (uuid)"
              value={driverId} onChange={(e) => setDriverId(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="amount (e.g. 250 or -100)"
              value={driverAmount} onChange={(e) => setDriverAmount(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="reason"
              value={driverReason} onChange={(e) => setDriverReason(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="created_by"
              value={createdBy} onChange={(e) => setCreatedBy(e.target.value)} />
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
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="vendor_id (uuid)"
              value={vendorId} onChange={(e) => setVendorId(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="amount (e.g. 500 or -200)"
              value={vendorAmount} onChange={(e) => setVendorAmount(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="kind (e.g. adjustment)"
              value={vendorKind} onChange={(e) => setVendorKind(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="note"
              value={vendorNote} onChange={(e) => setVendorNote(e.target.value)} />
          </div>
          <button
            disabled={busy}
            onClick={runVendorAdjust}
            className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Working..." : "Insert Vendor Adjustment"}
          </button>
          <div className="text-xs text-slate-500">
            Inserts row into <code>vendor_wallet_transactions</code> with booking_code null.
          </div>
        </div>
      )}

      {tab === "vendor_settle" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor settle full balance (payout)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="vendor_id (uuid)"
              value={settleVendorId} onChange={(e) => setSettleVendorId(e.target.value)} />
            <input className="rounded-lg border border-black/10 px-3 py-2" placeholder="note"
              value={settleNote} onChange={(e) => setSettleNote(e.target.value)} />
          </div>
          <button
            disabled={busy}
            onClick={runVendorSettle}
            className="rounded-xl bg-amber-600 text-white px-4 py-2 disabled:opacity-50"
          >
            {busy ? "Working..." : "Settle Vendor Wallet (Full Payout)"}
          </button>
          <div className="text-xs text-slate-500">
            Uses <code>settle_vendor_wallet</code> which inserts a negative payout row and resets vendor_wallet.balance.
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


