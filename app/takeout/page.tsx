"use client";

import React, { useEffect, useMemo, useState } from "react";

type ApiResp = any;

function cls(...s: Array<string | false | null | undefined>) {
  return s.filter(Boolean).join(" ");
}

type AddressRow = {
  id: string;
  label?: string | null;
  address_text: string;
  landmark?: string | null;
  notes?: string | null;
  is_primary: boolean;
  updated_at?: string | null;
};

const LS_DEVICE_KEY = "JRIDE_PAX_DEVICE_KEY";

function getOrCreateDeviceKey(): string {
  if (typeof window === "undefined") return "";
  const existing = String(window.localStorage.getItem(LS_DEVICE_KEY) || "").trim();
  if (existing) return existing;

  const key = "dev_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
  window.localStorage.setItem(LS_DEVICE_KEY, key);
  return key;
}

async function getJson(url: string) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j && j.ok === false)) {
    throw new Error(j?.message || j?.error || ("HTTP " + res.status));
  }
  return j;
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j && j.ok === false)) {
    throw new Error(j?.message || j?.error || ("HTTP " + res.status));
  }
  return j;
}

export default function TakeoutPage() {
  const [vendorId, setVendorId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Phase 2B.0 - DB-backed address choice (pilot via device_key)
  const [deviceKey, setDeviceKey] = useState("");
  const [addrMode, setAddrMode] = useState<"saved" | "new">("saved");
  const [saved, setSaved] = useState<AddressRow[]>([]);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrErr, setAddrErr] = useState<string | null>(null);

  const [newAddr, setNewAddr] = useState("");
  const [saveAddr, setSaveAddr] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);

  // Pilot payload fields
  const [items, setItems] = useState("");
  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  const primary = useMemo(() => saved.find((a) => a.is_primary) || saved[0] || null, [saved]);

  const resolvedDeliveryAddress = useMemo(() => {
    if (addrMode === "saved") return (primary?.address_text || "").trim();
    return (newAddr || "").trim();
  }, [addrMode, primary, newAddr]);

  const canSubmit = useMemo(() => {
    const hasVendor = vendorId.trim().length > 0;
    const hasName = customerName.trim().length > 0;
    const hasItems = items.trim().length > 0;
    const hasAddr = resolvedDeliveryAddress.length > 0;
    return hasVendor && hasName && hasItems && hasAddr && !busy;
  }, [vendorId, customerName, items, resolvedDeliveryAddress, busy]);

  async function refreshAddresses(k?: string) {
    const dk = String(k || deviceKey || "").trim();
    if (!dk) return;
    setAddrBusy(true);
    setAddrErr(null);
    try {
      const j = await getJson("/api/passenger-addresses?device_key=" + encodeURIComponent(dk));
      const rows = Array.isArray(j?.addresses) ? (j.addresses as AddressRow[]) : [];
      setSaved(rows);
      if (!rows.length) setAddrMode("new");
    } catch (e: any) {
      setAddrErr(String(e?.message || e || "Failed to load addresses"));
      setSaved([]);
      setAddrMode("new");
    } finally {
      setAddrBusy(false);
    }
  }

  useEffect(() => {
    const dk = getOrCreateDeviceKey();
    setDeviceKey(dk);
    refreshAddresses(dk).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveAddressToDb(addressText: string, makePrimary: boolean) {
    const addr = String(addressText || "").trim();
    if (!addr) throw new Error("Address required");

    await postJson("/api/passenger-addresses", {
      device_key: deviceKey,
      address_text: addr,
      is_primary: makePrimary,
    });

    await refreshAddresses(deviceKey);
  }

  async function makePrimaryExisting(id: string) {
    const row = saved.find((a) => a.id === id);
    if (!row) return;
    await saveAddressToDb(row.address_text, true);
  }

  async function submit() {
    try {
      setBusy(true);
      setResult("");
      setLastJson(null);

      const addressText = resolvedDeliveryAddress;

      // Persist to DB if requested (ONLY in "new" mode)
      if (addrMode === "new" && saveAddr) {
        await saveAddressToDb(addressText, !!setPrimary);
        if (setPrimary) setAddrMode("saved");
      }

      // For your current bookings schema, best safe place is to_label (delivery address).
      // Also include future-safe keys.
      const payload = {
        vendor_id: vendorId.trim(),
        vendorId: vendorId.trim(),
        service_type: "takeout",
        vendor_status: "preparing",

        customer_name: customerName.trim(),
        customerName: customerName.trim(),
        customer_phone: customerPhone.trim(),
        customerPhone: customerPhone.trim(),

        to_label: addressText,
        toLabel: addressText,
        delivery_address: addressText,
        deliveryAddress: addressText,

        items: items.trim(),
        note: note.trim(),
      };

      const j = await postJson("/api/vendor-orders", payload);
      setLastJson(j);

      const maybeId =
        j?.order_id || j?.orderId || j?.booking_id || j?.bookingId || j?.id || "";

      setResult("Created takeout order successfully." + (maybeId ? " ID: " + String(maybeId) : ""));
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

          {/* PHASE2B0_ADDRESS_PICKER_DB */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-medium text-slate-700">Delivery address (required)</label>
              <button
                type="button"
                onClick={() => refreshAddresses().catch(() => undefined)}
                className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                disabled={addrBusy}
              >
                {addrBusy ? "Refreshing..." : "Refresh saved"}
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  name="addrMode"
                  checked={addrMode === "saved"}
                  onChange={() => setAddrMode("saved")}
                  disabled={saved.length === 0}
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

            {addrErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">
                {addrErr}
              </div>
            ) : null}

            {addrMode === "saved" ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm">
                {primary ? (
                  <>
                    <div className="text-xs font-semibold text-slate-700">Primary address</div>
                    <div className="mt-1 text-sm text-slate-900">{primary.address_text}</div>

                    {saved.length > 1 ? (
                      <div className="mt-3">
                        <div className="text-[11px] font-medium text-slate-600">Other saved addresses</div>
                        <div className="mt-2 space-y-2">
                          {saved.filter((a) => a.id !== primary.id).slice(0, 5).map((a) => (
                            <div key={a.id} className="flex items-start justify-between gap-2 rounded border bg-white p-2">
                              <div className="text-xs text-slate-800">{a.address_text}</div>
                              <button
                                type="button"
                                onClick={() => makePrimaryExisting(a.id).catch(() => undefined)}
                                className="shrink-0 rounded border px-2 py-1 text-[11px] hover:bg-black/5"
                              >
                                Make primary
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-2 text-[11px] text-slate-600">
                      (Pilot mode: tied to this device key)
                    </div>
                  </>
                ) : (
                  <div className="text-sm text-slate-700">
                    No saved address yet. Choose â€œEnter a new addressâ€.
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
                  Tip: â€œSet as primaryâ€ makes it the default next time.
                </div>
              </div>
            )}

            {resolvedDeliveryAddress ? (
              <div className="mt-2 text-[11px] text-slate-600">
                Using: <span className="font-semibold">{resolvedDeliveryAddress}</span>
              </div>
            ) : null}

            <div className="mt-2 text-[11px] text-slate-500">
              Device key: <code>{deviceKey || "..."}</code>
            </div>
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