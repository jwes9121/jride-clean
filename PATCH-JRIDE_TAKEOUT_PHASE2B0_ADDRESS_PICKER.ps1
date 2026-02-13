# PATCH-JRIDE_TAKEOUT_PHASE2B0_ADDRESS_PICKER.ps1
# Phase 2B.0: Passenger address choice (use saved primary vs new) + save/primary (localStorage)
# Writes UTF-8 no BOM. Makes a backup.

$ErrorActionPreference = "Stop"

function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK] $m" -ForegroundColor Green }

$root = Get-Location
$ts = Get-Date -Format "yyyyMMdd_HHmmss"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$target = Join-Path $root "app\takeout\page.tsx"
if (!(Test-Path $target)) { Fail "Missing file: $target" }

Copy-Item -Force $target "$target.bak.$ts"
Ok "Backup: $target.bak.$ts"

$code = @'
"use client";

import React, { useEffect, useMemo, useState } from "react";

type ApiResp = any;

function cls(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

type SavedAddress = {
  id: string; // local id
  label?: string | null;
  address: string;
  is_primary?: boolean;
  updated_at?: string | null;
};

const LS_ADDRS = "JRIDE_PAX_ADDRS_V1";

function safeJsonParse<T>(v: string | null, fallback: T): T {
  try {
    if (!v) return fallback;
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}

function loadSavedAddresses(): SavedAddress[] {
  if (typeof window === "undefined") return [];
  const arr = safeJsonParse<SavedAddress[]>(window.localStorage.getItem(LS_ADDRS), []);
  return Array.isArray(arr) ? arr.filter(Boolean) : [];
}

function saveSavedAddresses(addrs: SavedAddress[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_ADDRS, JSON.stringify(addrs || []));
}

function getPrimary(addrs: SavedAddress[]): SavedAddress | null {
  if (!addrs?.length) return null;
  const p = addrs.find((a) => a?.is_primary);
  return p || addrs[0] || null;
}

export default function TakeoutPage() {
  const [vendorId, setVendorId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Phase 2B.0 - address choice
  const [savedAddrs, setSavedAddrs] = useState<SavedAddress[]>([]);
  const [addrMode, setAddrMode] = useState<"saved" | "new">("saved");
  const [newAddr, setNewAddr] = useState("");
  const [saveAddr, setSaveAddr] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);

  // Keep for backwards compatibility (we still send delivery_address variants)
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  useEffect(() => {
    const arr = loadSavedAddresses();
    setSavedAddrs(arr);
    // If no saved, default to "new"
    if (!arr.length) setAddrMode("new");
  }, []);

  const primaryAddr = useMemo(() => getPrimary(savedAddrs), [savedAddrs]);

  const resolvedDeliveryAddress = useMemo(() => {
    if (addrMode === "saved") return (primaryAddr?.address || "").trim();
    return (newAddr || "").trim();
  }, [addrMode, primaryAddr, newAddr]);

  const canSubmit = useMemo(() => {
    const hasVendor = vendorId.trim().length > 0;
    const hasName = customerName.trim().length > 0;
    const hasItems = items.trim().length > 0;
    const hasAddr = resolvedDeliveryAddress.length > 0; // require address for takeout
    return hasVendor && hasName && hasItems && hasAddr && !busy;
  }, [vendorId, customerName, items, resolvedDeliveryAddress, busy]);

  async function postJson(url: string, body: any) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || (j && j.ok === false)) {
      const msg = j?.message || j?.error || ("HTTP " + res.status);
      throw new Error(msg);
    }
    return j;
  }

  function upsertLocalAddress(addressText: string, makePrimary: boolean) {
    const addr = String(addressText || "").trim();
    if (!addr) return;

    const nowIso = new Date().toISOString();
    let next = [...(savedAddrs || [])];

    // De-dupe by exact text
    const existingIdx = next.findIndex((a) => String(a?.address || "").trim().toLowerCase() === addr.toLowerCase());
    if (existingIdx >= 0) {
      next[existingIdx] = {
        ...next[existingIdx],
        address: addr,
        updated_at: nowIso,
      };
      if (makePrimary) {
        next = next.map((a, i) => ({ ...a, is_primary: i === existingIdx }));
      }
    } else {
      const id = "addr_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
      const row: SavedAddress = {
        id,
        label: null,
        address: addr,
        is_primary: makePrimary || next.length === 0,
        updated_at: nowIso,
      };
      if (makePrimary) {
        next = next.map((a) => ({ ...a, is_primary: false }));
      }
      next.unshift(row);
      // Ensure exactly one primary
      if (!next.some((a) => a.is_primary)) next[0].is_primary = true;
    }

    setSavedAddrs(next);
    saveSavedAddresses(next);
  }

  async function submit() {
    try {
      setBusy(true);
      setResult("");
      setLastJson(null);

      const addressText = resolvedDeliveryAddress;

      // Persist locally if requested (ONLY in "new" mode)
      if (addrMode === "new" && saveAddr) {
        upsertLocalAddress(addressText, !!setPrimary);
      }

      // Flexible payload:
      // - For current bookings schema: use to_label (delivery) and optionally dropoff coords later.
      // - Keep legacy delivery_address keys for forwards compatibility.
      const payload = {
        vendor_id: vendorId.trim(),
        vendorId: vendorId.trim(),

        service_type: "takeout",
        vendor_status: "preparing",

        customer_name: customerName.trim(),
        customerName: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customerPhone: customerPhone.trim(),

        // Best match to current bookings schema:
        to_label: addressText,
        toLabel: addressText,

        // Backwards / future-safe keys:
        delivery_address: addressText,
        deliveryAddress: addressText,

        items: items.trim(),
        note: note.trim(),
      };

      const j = await postJson("/api/vendor-orders", payload);
      setLastJson(j);

      const maybeId =
        j?.order_id || j?.orderId || j?.booking_id || j?.bookingId || j?.id || "";

      setResult(
        "Created takeout order successfully." +
          (maybeId ? " ID: " + String(maybeId) : "")
      );

      // If new mode, keep new address filled (helps repeated tests)
    } catch (e: any) {
      setResult("Create takeout order failed: " + (e?.message || "Unknown error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">Book Takeout (Pilot)</div>
          <div className="text-sm text-slate-600">
            Creates a vendor-backed order for testing <code>/vendor-orders</code>.
          </div>
        </div>
        <a href="/vendor-orders" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
          Go to Vendor Orders
        </a>
      </div>

      <div className="mt-4 rounded-lg border bg-white p-4">
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-slate-700">Vendor ID (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              placeholder="Paste vendor_id here"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Customer name (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Juan Dela Cruz"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Customer phone (optional)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              placeholder="09xx..."
            />
          </div>

          {/* PHASE2B0_ADDRESS_PICKER */}
          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-700">Delivery address (required)</label>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="addrMode"
                  checked={addrMode === "saved"}
                  onChange={() => setAddrMode("saved")}
                  disabled={savedAddrs.length === 0}
                />
                <span>Use saved address</span>
              </label>

              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="addrMode"
                  checked={addrMode === "new"}
                  onChange={() => setAddrMode("new")}
                />
                <span>Enter a new address</span>
              </label>
            </div>

            {addrMode === "saved" ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm">
                {primaryAddr ? (
                  <>
                    <div className="text-xs font-semibold text-slate-700">
                      Primary address on this device
                    </div>
                    <div className="mt-1 text-sm text-slate-900">{primaryAddr.address}</div>
                    <div className="mt-2 text-[11px] text-slate-600">
                      (Pilot mode: saved on this device only)
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-700">
                    No saved address yet. Choose “Enter a new address”.
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-2">
                <textarea
                  className="w-full rounded border px-3 py-2 text-sm"
                  rows={2}
                  value={newAddr}
                  onChange={(e) => setNewAddr(e.target.value)}
                  placeholder="Complete address (Barangay / landmark / municipality)"
                />

                <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
                  <label className="inline-flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={saveAddr}
                      onChange={(e) => {
                        const v = !!e.target.checked;
                        setSaveAddr(v);
                        if (!v) setSetPrimary(false);
                      }}
                    />
                    <span>Save this address</span>
                  </label>

                  <label className={cls("inline-flex items-center gap-2", !saveAddr && "opacity-50")}>
                    <input
                      type="checkbox"
                      checked={setPrimary}
                      onChange={(e) => setSetPrimary(!!e.target.checked)}
                      disabled={!saveAddr}
                    />
                    <span>Set as primary</span>
                  </label>
                </div>

                <div className="mt-2 text-[11px] text-slate-600">
                  Tip: “Set as primary” makes it the default next time.
                </div>
              </div>
            )}

            {resolvedDeliveryAddress ? (
              <div className="mt-2 text-[11px] text-slate-600">
                Using: <span className="font-semibold">{resolvedDeliveryAddress}</span>
              </div>
            ) : null}
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-700">Items (required)</label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={4}
              value={items}
              onChange={(e) => setItems(e.target.value)}
              placeholder="Example: 2x Chicken meal, 1x Coke..."
            />
          </div>

          <div className="md:col-span-2">
            <label className="text-xs font-medium text-slate-700">Note (optional)</label>
            <textarea
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Any special instructions..."
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            className={cls(
              "rounded px-4 py-2 text-sm font-medium text-white",
              canSubmit ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-400"
            )}
          >
            {busy ? "Submitting..." : "Submit takeout order"}
          </button>

          <a href="/vendor-orders" className="rounded border px-3 py-2 text-sm hover:bg-slate-50">
            View vendor orders
          </a>

          <span className="text-xs text-slate-600">
            Test link: <code>/takeout</code>
          </span>
        </div>

        {result ? (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">{result}</div>
        ) : null}

        {lastJson ? (
          <pre className="mt-3 overflow-auto rounded border bg-black p-3 text-xs text-white">
{JSON.stringify(lastJson, null, 2)}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
'@

[System.IO.File]::WriteAllText($target, $code, $utf8NoBom)
Ok "Wrote: $target"

Ok "Phase 2B.0 address picker applied (localStorage)."
Write-Host ""
Write-Host "Next: npm run build, then test /takeout -> choose saved/new address -> submit." -ForegroundColor Cyan
