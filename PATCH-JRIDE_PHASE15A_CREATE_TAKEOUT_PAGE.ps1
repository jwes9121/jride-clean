# PATCH-JRIDE_PHASE15A_CREATE_TAKEOUT_PAGE.ps1
# Creates a minimal Takeout booking page at app/takeout/page.tsx (one file).
# This page POSTs to /api/vendor-orders to create vendor-backed orders for testing /vendor-orders UI.

$ErrorActionPreference = "Stop"
function Fail($m){ throw $m }
function Ok($m){ Write-Host "[OK]   $m" -ForegroundColor Green }
function Info($m){ Write-Host "[INFO] $m" -ForegroundColor Cyan }

$rel = "app\takeout\page.tsx"
$path = Join-Path (Get-Location).Path $rel

# If already exists, don't overwrite
if (Test-Path $path) {
  Info "Already exists: $path"
  Info "Test link:"
  Info "  Local: http://localhost:3000/takeout"
  Info "  Prod : https://app.jride.net/takeout"
  exit 0
}

# Ensure folder
$dir = Split-Path -Parent $path
New-Item -ItemType Directory -Force -Path $dir | Out-Null

# Write file
$tsx = @'
"use client";

import React, { useMemo, useState } from "react";

type ApiResp = any;

function cls(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

export default function TakeoutPage() {
  const [vendorId, setVendorId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  const canSubmit = useMemo(() => {
    return vendorId.trim().length > 0 && customerName.trim().length > 0 && items.trim().length > 0 && !busy;
  }, [vendorId, customerName, items, busy]);

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

  async function submit() {
    try {
      setBusy(true);
      setResult("");
      setLastJson(null);

      // Flexible payload: we send multiple key variants so backend can pick what it supports.
      // No DB column assumptions here; this is just a request body.
      const payload = {
        // identity
        vendor_id: vendorId.trim(),
        vendorId: vendorId.trim(),

        // takeout info
        service_type: "takeout",
        vendor_status: "preparing",

        customer_name: customerName.trim(),
        customerName: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customerPhone: customerPhone.trim(),

        delivery_address: deliveryAddress.trim(),
        deliveryAddress: deliveryAddress.trim(),

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
          <div className="text-2xl font-bold">Book Takeout (Pilot Skeleton)</div>
          <div className="text-sm text-slate-600">
            This creates a vendor-backed order for testing <code>/vendor-orders</code>.
          </div>
        </div>
        <a
          href="/vendor-orders"
          className="rounded border px-3 py-2 text-sm hover:bg-slate-50"
        >
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
            <div className="mt-1 text-[11px] text-slate-500">
              Use the vendorId your vendor account is using in your data.
            </div>
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

          <div>
            <label className="text-xs font-medium text-slate-700">Delivery address (optional)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={deliveryAddress}
              onChange={(e) => setDeliveryAddress(e.target.value)}
              placeholder="Barangay / landmark"
            />
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
            Link for testing: <code>/takeout</code>
          </span>
        </div>

        {result ? (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">
            {result}
          </div>
        ) : null}

        {lastJson ? (
          <pre className="mt-3 overflow-auto rounded border bg-black p-3 text-xs text-white">
{JSON.stringify(lastJson, null, 2)}
          </pre>
        ) : null}
      </div>

      <div className="mt-4 text-xs text-slate-600">
        If your vendor orders page shows 0 orders after submitting, it usually means the backend
        endpoint does not yet create vendor orders from this payload. In that case, we will adjust
        only the backend route (one file) next.
      </div>
    </div>
  );
}
'@

Set-Content -LiteralPath $path -Value $tsx -Encoding UTF8
Ok "Created: $rel"
Ok "Testing links:"
Ok "  Local: http://localhost:3000/takeout"
Ok "  Prod : https://app.jride.net/takeout"
