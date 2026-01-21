"use client";

import { useEffect, useMemo, useState } from "react";

type AnyObj = any;

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function shortId(id: string) {
  const s = String(id || "");
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

type DriverOption = {
  id: string;
  name?: string;
  town?: string;
  label: string;
};

function extractUuid(s: string) {
  const m = String(s || "").match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : "";
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

  // Driver options for dropdown/search
  const [drivers, setDrivers] = useState<DriverOption[]>([]);
  const [driverSearch, setDriverSearch] = useState<string>("");

  async function loadDrivers(q?: string) {
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

      const url = q ? `/api/admin/wallet/drivers?q=${encodeURIComponent(q)}` : `/api/admin/wallet/drivers`;
      const res = await fetch(url, { headers });
      const data = await res.json();
      if (data?.ok && Array.isArray(data?.drivers)) {
        setDrivers(data.drivers);
      } else {
        // keep old list if endpoint fails
        // console.warn("drivers endpoint failed", data);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    // Initial load once page is opened (driver tab)
    loadDrivers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Driver adjust
  const [driverId, setDriverId] = useState("");
  const [driverAmount, setDriverAmount] = useState<string>("");
  const [driverReason, setDriverReason] = useState<string>("manual_adjust");
  const [createdBy, setCreatedBy] = useState<string>("admin");

  // Auto reason + receipt reference
  const [reasonMode, setReasonMode] = useState<string>("manual_topup");
  const [receiptRef, setReceiptRef] = useState<string>("");

  function generateReasonAndReceipt() {
    const id = driverId.trim();
    const ts = new Date();
    const stamp =
      ts.getFullYear().toString() +
      String(ts.getMonth() + 1).padStart(2, "0") +
      String(ts.getDate()).padStart(2, "0") +
      "-" +
      String(ts.getHours()).padStart(2, "0") +
      String(ts.getMinutes()).padStart(2, "0") +
      String(ts.getSeconds()).padStart(2, "0");

    const amt = driverAmount.trim() ? toNum(driverAmount) : 0;
    const amtTag = Number.isFinite(amt) ? `${amt}` : "0";

    const r = `admin:${reasonMode}:${stamp}:${shortId(id)}:${amtTag}`;
    const rec = `JRIDE-${stamp}-${shortId(id)}-${Math.abs(amt)}`;

    setDriverReason(r);
    setReceiptRef(rec);
  }

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

  async function postJson(url: string, body: AnyObj) {
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
        // keep receipt for audit trails if you later store it server-side
        receipt_ref: receiptRef || null,
        reason_mode: reasonMode || null,
      });
      setOut(data);
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

  // When user types/selects something in driverSearch:
  // - If it contains UUID, we extract it
  // - Otherwise, we try to match label prefix
  useEffect(() => {
    const uuid = extractUuid(driverSearch);
    if (uuid) {
      setDriverId(uuid);
      return;
    }

    const t = driverSearch.trim().toLowerCase();
    if (!t) return;

    const hit = drivers.find((d) => String(d.label).toLowerCase() === t);
    if (hit?.id) setDriverId(hit.id);
  }, [driverSearch, drivers]);

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
        <div className="text-xs text-slate-500 flex items-center gap-2">
          <span>If your API is open (no ADMIN_API_KEY set), you can leave this blank.</span>
          <button
            type="button"
            className="text-xs underline text-slate-600 hover:text-slate-900"
            onClick={() => loadDrivers()}
          >
            Refresh driver list
          </button>
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

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2">
              <div className="text-xs text-slate-600">Select Driver (type to search)</div>
              <input
                value={driverSearch}
                onChange={(e) => {
                  setDriverSearch(e.target.value);
                  // lightweight typeahead: refresh list when typing (optional)
                  const t = e.target.value.trim();
                  if (t.length >= 2) loadDrivers(t);
                }}
                list="jride-driver-list"
                placeholder='Type name or townâ€¦ e.g. "Juan" or "Lagawe"'
                className="w-full rounded-lg border border-black/10 px-3 py-2"
              />
              <datalist id="jride-driver-list">
                {drivers.map((d) => (
                  <option key={d.id} value={d.label} />
                ))}
              </datalist>

              <div className="text-xs text-slate-500">
                Tip: pick an entry from suggestions â€” the UUID will auto-fill on the right.
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs text-slate-600">Driver ID (UUID)</div>
              <input
                className="w-full rounded-lg border border-black/10 px-3 py-2"
                placeholder="driver_id (uuid)"
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-600">Reason Mode</div>
                  <select
                    value={reasonMode}
                    onChange={(e) => setReasonMode(e.target.value)}
                    className="w-full rounded-lg border border-black/10 px-3 py-2"
                  >
                    <option value="manual_topup">Manual Topup</option>
                    <option value="promo_free_ride_credit">Promo Free Ride Credit</option>
                    <option value="correction">Correction</option>
                    <option value="payout_adjustment">Payout Adjustment</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-slate-600">Receipt Reference (read-only)</div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2 bg-slate-50"
                    value={receiptRef || "(auto-generated when you click Generate)"}
                    readOnly
                  />
                </div>
              </div>

              <button
                type="button"
                onClick={generateReasonAndReceipt}
                className="w-full rounded-lg border border-black/10 px-3 py-2 hover:bg-black/5"
              >
                Generate Reason + Receipt Ref
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="amount (e.g. 250 or -100)"
              value={driverAmount}
              onChange={(e) => setDriverAmount(e.target.value)}
            />
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="created_by"
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
            />
            <input
              className="md:col-span-2 rounded-lg border border-black/10 px-3 py-2"
              placeholder="reason (auto-gen recommended)"
              value={driverReason}
              onChange={(e) => setDriverReason(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={runDriverAdjust}
              className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Apply Driver Adjustment"}
            </button>

            <button
              type="button"
              disabled={lookupBusy || !driverId.trim()}
              onClick={() => runDriverLookup(driverId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
            >
              {lookupBusy ? "Looking up..." : "Lookup Driver Wallet"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Uses <code>admin_adjust_driver_wallet</code> (non-negative safety enforced).
          </div>
        </div>
      )}

      {tab === "vendor_adjust" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor wallet adjustment entry</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="vendor_id (uuid)"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
            />
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="amount (e.g. 500 or -200)"
              value={vendorAmount}
              onChange={(e) => setVendorAmount(e.target.value)}
            />
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="kind (e.g. adjustment)"
              value={vendorKind}
              onChange={(e) => setVendorKind(e.target.value)}
            />
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="note"
              value={vendorNote}
              onChange={(e) => setVendorNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={runVendorAdjust}
              className="rounded-xl bg-emerald-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Insert Vendor Adjustment"}
            </button>

            <button
              type="button"
              disabled={lookupBusy || !vendorId.trim()}
              onClick={() => runVendorLookup(vendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
            >
              {lookupBusy ? "Looking up..." : "Lookup Vendor Wallet"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Inserts row into <code>vendor_wallet_transactions</code> with booking_code null.
          </div>
        </div>
      )}

      {tab === "vendor_settle" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Vendor settle full balance (payout)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="vendor_id (uuid)"
              value={settleVendorId}
              onChange={(e) => setSettleVendorId(e.target.value)}
            />
            <input
              className="rounded-lg border border-black/10 px-3 py-2"
              placeholder="note"
              value={settleNote}
              onChange={(e) => setSettleNote(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              disabled={busy}
              onClick={runVendorSettle}
              className="rounded-xl bg-amber-600 text-white px-4 py-2 disabled:opacity-50"
            >
              {busy ? "Working..." : "Settle Vendor Wallet (Full Payout)"}
            </button>

            <button
              type="button"
              disabled={lookupBusy || !settleVendorId.trim()}
              onClick={() => runVendorLookup(settleVendorId.trim())}
              className="rounded-xl border border-black/10 px-4 py-2 disabled:opacity-50"
            >
              {lookupBusy ? "Looking up..." : "Lookup Vendor Wallet"}
            </button>
          </div>

          <div className="text-xs text-slate-500">
            Uses <code>settle_vendor_wallet</code> which inserts a negative payout row and resets vendor_wallet.balance.
          </div>
        </div>
      )}

      <div className="rounded-xl border border-black/10 p-4 space-y-2">
        <div className="font-semibold">Lookup</div>
        <div className="text-xs text-slate-500">Balance + last 20 transactions.</div>
        <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto">
          {lookup ? JSON.stringify(lookup, null, 2) : "(no lookup yet)"}
        </pre>
      </div>

      <div className="rounded-xl border border-black/10 p-4">
        <div className="font-semibold mb-2">Response</div>
        <pre className="text-xs whitespace-pre-wrap">{outText || "(no output yet)"}</pre>
      </div>
    </div>
  );
}
