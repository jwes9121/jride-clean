"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type AnyObj = any;

function toNum(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function shortId(id: string) {
  const s = String(id || "");
  return s.length > 12 ? `${s.slice(0, 6)}...${s.slice(-4)}` : s;
}

function extractUuid(s: string) {
  const m = String(s || "").match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  return m ? m[0] : "";
}

type DriverSuggest = {
  id: string;
  driver_name: string;
  label: string; // "Name (uuid)"
};

export default function AdminWalletAdjustPage() {
  const [tab, setTab] = useState<"driver" | "vendor_adjust" | "vendor_settle">(
    "driver"
  );

  // Optional admin key
  const [adminKey, setAdminKey] = useState<string>("");

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
  const [settleNote, setSettleNote] = useState<string>(
    "Cash payout settlement"
  );

  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<any>(null);

  const outText = useMemo(
    () => (out ? JSON.stringify(out, null, 2) : ""),
    [out]
  );

  async function postJson(url: string, body: AnyObj) {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new Error(
        data && (data.message || data.error)
          ? data.message || data.error
          : `HTTP ${res.status}`
      );
    }
    return data;
  }

  async function runDriverAdjust() {
    setBusy(true);
    setOut(null);
    try {
      const amt = toNum(driverAmount);
      const data = await postJson("/api/admin/wallet/adjust", {
        kind: "driver_adjust",
        driver_id: driverId.trim(),
        amount: amt,
        reason: driverReason,
        created_by: createdBy,
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
    setBusy(true);
    setOut(null);
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
    setBusy(true);
    setOut(null);
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

  // ===== Lookup panel (driver/vendor) =====
  const [lookup, setLookup] = useState<any>(null);
  const [lookupBusy, setLookupBusy] = useState(false);

  async function runDriverLookup(driver_id: string) {
    setLookupBusy(true);
    setLookup(null);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

      const res = await fetch(
        `/api/admin/wallet/driver-summary?driver_id=${encodeURIComponent(
          driver_id
        )}`,
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
    setLookupBusy(true);
    setLookup(null);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

      const res = await fetch(
        `/api/admin/wallet/vendor-summary?vendor_id=${encodeURIComponent(
          vendor_id
        )}`,
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

  // ===== Driver autosuggest (single, stable) =====
  const [driverQuery, setDriverQuery] = useState<string>("");
  const [driverSuggestions, setDriverSuggestions] = useState<DriverSuggest[]>(
    []
  );
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestBusy, setSuggestBusy] = useState(false);
  const suggestTimer = useRef<any>(null);
  const queryInputRef = useRef<HTMLInputElement | null>(null);

  async function fetchDriverSuggestions(q: string) {
    const qq = String(q || "").trim();
    if (qq.length < 2) {
      setDriverSuggestions([]);
      setSuggestOpen(false);
      return;
    }

    setSuggestBusy(true);
    try {
      const headers: Record<string, string> = {};
      if (adminKey.trim()) headers["x-admin-key"] = adminKey.trim();

      const res = await fetch(
        `/api/admin/wallet/driver-summary?q=${encodeURIComponent(qq)}`,
        { headers, cache: "no-store" }
      );
      const data = await res.json().catch(() => null);

      if (data?.ok && Array.isArray(data?.drivers)) {
        setDriverSuggestions(data.drivers);
        setSuggestOpen(true);
      } else {
        setDriverSuggestions([]);
        setSuggestOpen(false);
      }
    } catch {
      setDriverSuggestions([]);
      setSuggestOpen(false);
    } finally {
      setSuggestBusy(false);
    }
  }

  useEffect(() => {
    // If user typed/pasted a UUID, accept immediately
    const uuid = extractUuid(driverQuery);
    if (uuid) {
      setDriverId(uuid);
      setSuggestOpen(false);
      return;
    }

    if (suggestTimer.current) clearTimeout(suggestTimer.current);

    const q = driverQuery.trim();
    if (q.length < 2) {
      setDriverSuggestions([]);
      setSuggestOpen(false);
      return;
    }

    suggestTimer.current = setTimeout(() => {
      fetchDriverSuggestions(q);
    }, 250);

    return () => {
      if (suggestTimer.current) clearTimeout(suggestTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverQuery, adminKey]);

  function pickDriver(d: DriverSuggest) {
    setDriverId(String(d.id));
    setDriverQuery(d.label);
    setSuggestOpen(false);
  }

  function closeSuggestSoon() {
    // Allow click selection before close
    setTimeout(() => setSuggestOpen(false), 120);
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
          className={
            "rounded-xl px-4 py-2 border border-black/10 " +
            (tab === "driver" ? "bg-black text-white" : "bg-white")
          }
          onClick={() => setTab("driver")}
        >
          Driver Adjust
        </button>
        <button
          className={
            "rounded-xl px-4 py-2 border border-black/10 " +
            (tab === "vendor_adjust" ? "bg-black text-white" : "bg-white")
          }
          onClick={() => setTab("vendor_adjust")}
        >
          Vendor Adjust
        </button>
        <button
          className={
            "rounded-xl px-4 py-2 border border-black/10 " +
            (tab === "vendor_settle" ? "bg-black text-white" : "bg-white")
          }
          onClick={() => setTab("vendor_settle")}
        >
          Vendor Settle (Full)
        </button>
      </div>

      {tab === "driver" && (
        <div className="rounded-xl border border-black/10 p-4 space-y-3">
          <div className="font-semibold">Driver wallet credit/debit</div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="space-y-2 relative">
              <div className="text-xs text-slate-600">
                Select Driver (type name or UUID)
              </div>

              <input
                ref={queryInputRef}
                value={driverQuery}
                onChange={(e) => setDriverQuery(e.target.value)}
                onFocus={() => {
                  if (driverSuggestions.length > 0) setSuggestOpen(true);
                }}
                onBlur={closeSuggestSoon}
                placeholder='Type driver name... e.g. "Juan"'
                className="w-full rounded-lg border border-black/10 px-3 py-2"
              />

              {suggestOpen && (
                <div className="absolute z-20 mt-1 w-full rounded-xl border border-black/10 bg-white shadow-sm max-h-64 overflow-auto">
                  <div className="px-3 py-2 text-xs text-slate-500 border-b border-black/5 flex items-center justify-between">
                    <span>
                      {suggestBusy
                        ? "Searching..."
                        : driverSuggestions.length
                        ? "Select a driver"
                        : "No matches"}
                    </span>
                    <button
                      type="button"
                      className="text-xs underline"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setSuggestOpen(false);
                        queryInputRef.current?.focus();
                      }}
                    >
                      Close
                    </button>
                  </div>

                  {driverSuggestions.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="w-full text-left px-3 py-2 hover:bg-black/5"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickDriver(d)}
                    >
                      <div className="text-sm">{d.label}</div>
                      <div className="text-xs text-slate-500">
                        {shortId(d.id)}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              <div className="text-xs text-slate-500">
                Tip: click a suggestion to auto-fill the Driver ID (UUID).
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
                    <option value="promo_free_ride_credit">
                      Promo Free Ride Credit
                    </option>
                    <option value="correction">Correction</option>
                    <option value="payout_adjustment">Payout Adjustment</option>
                  </select>
                </div>

                <div>
                  <div className="text-xs text-slate-600">
                    Receipt Reference (read-only)
                  </div>
                  <input
                    className="w-full rounded-lg border border-black/10 px-3 py-2 bg-slate-50"
                    value={
                      receiptRef || "(auto-generated when you click Generate)"
                    }
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
            Uses <code>admin_adjust_driver_wallet</code> (non-negative safety
            enforced).
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
            Inserts row into <code>vendor_wallet_transactions</code> with
            booking_code null.
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
            Uses <code>settle_vendor_wallet</code> which inserts a negative payout
            row and resets vendor_wallet.balance.
          </div>
        </div>
      )}

      <div className="rounded-xl border border-black/10 p-4 space-y-2">
        <div className="font-semibold">Lookup</div>
        <div className="text-xs text-slate-500">
          Balance + last 20 transactions.
        </div>
        <pre className="text-xs whitespace-pre-wrap max-h-64 overflow-auto">
          {lookup ? JSON.stringify(lookup, null, 2) : "(no lookup yet)"}
        </pre>
      </div>

      <div className="rounded-xl border border-black/10 p-4">
        <div className="font-semibold mb-2">Response</div>
        <pre className="text-xs whitespace-pre-wrap">
          {outText || "(no output yet)"}
        </pre>
      </div>
    </div>
  );
}
