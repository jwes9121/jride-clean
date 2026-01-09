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
  is_primary: boolean;
  updated_at?: string | null;
};

type MenuItem = {
  id: string;
  name: string;
  description?: string | null;
  price: number;
  sort_order?: number | null;
  is_available: boolean | null;
  sold_out_today: boolean | null;
  last_updated_at?: string | null;
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

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  const v = Number(n || 0);
  return "PHP " + v.toFixed(2);
}

export default function TakeoutPage() {
  const [vendorId, setVendorId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Phase 2B.0 - DB-backed addresses (pilot via device_key)
  const [deviceKey, setDeviceKey] = useState("");
  const [addrMode, setAddrMode] = useState<"saved" | "new">("saved");
  const [saved, setSaved] = useState<AddressRow[]>([]);
  const [addrBusy, setAddrBusy] = useState(false);
  const [addrErr, setAddrErr] = useState<string | null>(null);

  const [newAddr, setNewAddr] = useState("");
  const [saveAddr, setSaveAddr] = useState(true);
  const [setPrimary, setSetPrimary] = useState(true);

  // Phase 2B - menu consumption
  const [menuBusy, setMenuBusy] = useState(false);
  const [menuErr, setMenuErr] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [qty, setQty] = useState<Record<string, number>>({});

  const [note, setNote] = useState("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");
  const [lastJson, setLastJson] = useState<ApiResp | null>(null);

  const primary = useMemo(() => saved.find((a) => a.is_primary) || saved[0] || null, [saved]);

  const resolvedDeliveryAddress = useMemo(() => {
    if (addrMode === "saved") return (primary?.address_text || "").trim();
    return (newAddr || "").trim();
  }, [addrMode, primary, newAddr]);

  const menuSelectable = useMemo(() => {
    return (menu || []).map((m) => {
      const available = (m.is_available !== false) && (m.sold_out_today !== true);
      return { ...m, _available: available };
    });
  }, [menu]);

  const selectedLines = useMemo(() => {
    const lines: Array<{ id: string; name: string; price: number; qty: number; line_total: number }> = [];
    for (const m of menuSelectable) {
      const q = Math.max(0, Math.floor(toNum(qty[m.id])));
      if (q > 0) {
        lines.push({ id: m.id, name: m.name, price: toNum(m.price), qty: q, line_total: q * toNum(m.price) });
      }
    }
    return lines;
  }, [menuSelectable, qty]);

  const itemsSubtotal = useMemo(() => selectedLines.reduce((a, r) => a + toNum(r.line_total), 0), [selectedLines]);

  // Human readable for vendor UI, and JSON snapshot for future lock
  const itemsText = useMemo(() => {
    if (!selectedLines.length) return "";
    return selectedLines.map((r) => `${r.qty}x ${r.name} @ ${money(r.price)} = ${money(r.line_total)}`).join("\n");
  }, [selectedLines]);

  const itemsJson = useMemo(() => {
    return selectedLines.map((r) => ({ menu_item_id: r.id, name: r.name, unit_price: r.price, qty: r.qty, line_total: r.line_total }));
  }, [selectedLines]);

  const canSubmit = useMemo(() => {
    const hasVendor = vendorId.trim().length > 0;
    const hasName = customerName.trim().length > 0;
    const hasAddr = resolvedDeliveryAddress.length > 0;
    const hasItems = selectedLines.length > 0;
    return hasVendor && hasName && hasAddr && hasItems && !busy;
  }, [vendorId, customerName, resolvedDeliveryAddress, selectedLines.length, busy]);

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

  async function refreshMenu(vId?: string) {
    const vid = String(vId || vendorId || "").trim();
    if (!vid) {
      setMenu([]);
      setQty({});
      return;
    }
    setMenuBusy(true);
    setMenuErr(null);
    try {
      const j = await getJson("/api/takeout/menu?vendor_id=" + encodeURIComponent(vid));
      const items = Array.isArray(j?.items) ? j.items : [];
      const mapped: MenuItem[] = items
        .filter(Boolean)
        .map((r: any) => ({
          id: String(r.id ?? r.menu_item_id ?? ""),
          name: String(r.name ?? ""),
          description: (r.description ?? null) as any,
          price: toNum(r.price),
          sort_order: (r.sort_order ?? 0) as any,
          is_available: (typeof r.is_available === "boolean" ? r.is_available : null),
          sold_out_today: (typeof r.sold_out_today === "boolean" ? r.sold_out_today : null),
          last_updated_at: (r.last_updated_at ?? null) as any,
        }))
        .filter((r: MenuItem) => r.id && r.name);

      setMenu(mapped);
      // Keep existing qty but drop unknown
      setQty((prev) => {
        const next: Record<string, number> = {};
        for (const m of mapped) {
          if (prev[m.id]) next[m.id] = prev[m.id];
        }
        return next;
      });
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Failed to load menu"));
      setMenu([]);
      setQty({});
    } finally {
      setMenuBusy(false);
    }
  }

  useEffect(() => {
    const dk = getOrCreateDeviceKey();
    setDeviceKey(dk);
    refreshAddresses(dk).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto refresh menu when vendorId changes (debounced-ish)
  useEffect(() => {
    const t = setTimeout(() => {
      refreshMenu().catch(() => undefined);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

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

  function setItemQty(id: string, nextQty: number) {
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(99, Math.floor(toNum(nextQty)))) }));
  }

  async function submit() {
    try {
      setBusy(true);
      setResult("");
      setLastJson(null);

      const addressText = resolvedDeliveryAddress;

      // Persist address to DB if requested (ONLY in "new" mode)
      if (addrMode === "new" && saveAddr) {
        await saveAddressToDb(addressText, !!setPrimary);
        if (setPrimary) setAddrMode("saved");
      }      // PHASE 2D: build structured items[] for snapshot lock (menu edits must NOT affect history)
      const menuById: Record<string, any> = {};
      try {
        for (const m of (Array.isArray(menu) ? menu : [])) {
          const id = String((m as any)?.menu_item_id || (m as any)?.id || "").trim();
          if (id) menuById[id] = m;
        }
      } catch {}

      const itemsSnapshot = (Array.isArray(selectedLines) ? selectedLines : [])
        .map((l: any) => {
          const mid = String(l?.menu_item_id || l?.menuItemId || l?.id || l?.item_id || "").trim();
          const mm = mid ? menuById[mid] : null;

          const name = String(l?.name || mm?.name || "").trim();
          const price = Number(mm?.price ?? l?.price ?? l?.unit_price ?? 0);
          const qtyRaw = l?.quantity ?? l?.qty ?? l?.count ?? 1;
          const qty = Math.max(1, parseInt(String(qtyRaw), 10) || 1);

          if (!name) return null;

          return {
            menu_item_id: mid || null,
            name,
            price: Number.isFinite(price) ? price : 0,
            quantity: qty,
          };
        })
        .filter(Boolean);


      // Snapshot payload (menu) Ã¢â‚¬â€ Phase 2D will lock this into bookings later
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

        // Human readable (helps vendor UI today)
        items_text: itemsText,
        items: itemsSnapshot,
        // JSON snapshot for future order-lock (harmless if ignored)
        items_json: itemsJson,
        itemsJson: itemsJson,

        // Client-only estimate (NO wallet math)
        estimated_items_subtotal: itemsSubtotal,

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
          <div className="text-2xl font-bold">Takeout (Passenger) - Phase 2B</div>
          <div className="text-sm text-slate-600">
            Passenger sees today menu, selects items, then submits a pilot order to <code>/vendor-orders</code>.
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
            <div className="mt-1 text-[11px] text-slate-500">
              Menu loads automatically after you paste vendor_id.
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Passenger name (required)</label>
            <input
              className="mt-1 w-full rounded border px-3 py-2 text-sm"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Juan Dela Cruz"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-slate-700">Passenger phone (optional)</label>
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

                    <div className="mt-2 text-[11px] text-slate-600">(Pilot mode: tied to this device key)</div>
                  </>
                ) : (
                  <div className="text-sm text-slate-700">
                    No saved address yet. Choose "Enter a new addressÃ¢â‚¬Â.
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
                  Tip: "Set as primaryÃ¢â‚¬Â makes it the default next time.
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

          {/* PHASE2B_MENU_CONSUMPTION */}
          <div className="md:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-slate-700">Menu (today)</div>
                <div className="text-[11px] text-slate-500">Only available items can be selected.</div>
              </div>
              <button
                type="button"
                onClick={() => refreshMenu().catch(() => undefined)}
                className="rounded border px-2 py-1 text-xs hover:bg-slate-50"
                disabled={menuBusy || !vendorId.trim()}
              >
                {menuBusy ? "Loading..." : "Refresh menu"}
              </button>
            </div>

            {menuErr ? (
              <div className="mt-2 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{menuErr}</div>
            ) : null}

            {!vendorId.trim() ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                Paste a <b>vendor_id</b> to load today's menu.
              </div>
            ) : menuBusy ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">Loading menu...</div>
            ) : menuSelectable.length === 0 ? (
              <div className="mt-2 rounded border bg-slate-50 p-3 text-sm text-slate-700">
                No menu items available today.
              </div>
            ) : (
              <div className="mt-2 space-y-2">
                {menuSelectable.map((m) => {
                  const q = Math.max(0, Math.floor(toNum(qty[m.id])));
                  const disabled = !m._available;
                  return (
                    <div
                      key={m.id}
                      className={cls(
                        "flex items-start justify-between gap-3 rounded border p-3",
                        disabled ? "bg-slate-50 opacity-70" : "bg-white"
                      )}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="font-medium">{m.name}</div>
                          {m.sold_out_today ? (
                            <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] text-red-700">Sold out</span>
                          ) : null}
                          {m.is_available === false ? (
                            <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">Unavailable</span>
                          ) : null}
                        </div>
                        {m.description ? (
                          <div className="mt-1 text-xs text-slate-600">{m.description}</div>
                        ) : null}
                        <div className="mt-2 text-sm font-semibold">{money(toNum(m.price))}</div>
                      </div>

                      <div className="shrink-0 flex items-center gap-2">
                        <button
                          type="button"
                          className="h-8 w-8 rounded border text-sm hover:bg-black/5 disabled:opacity-50"
                          disabled={disabled || q <= 0}
                          onClick={() => setItemQty(m.id, q - 1)}
                        >
                          -
                        </button>
                        <input
                          className="h-8 w-14 rounded border px-2 text-center text-sm"
                          value={String(q)}
                          onChange={(e) => setItemQty(m.id, Number(e.target.value))}
                          disabled={disabled}
                          inputMode="numeric"
                        />
                        <button
                          type="button"
                          className="h-8 w-8 rounded border text-sm hover:bg-black/5 disabled:opacity-50"
                          disabled={disabled}
                          onClick={() => setItemQty(m.id, q + 1)}
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="mt-3 rounded border bg-slate-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <div className="font-medium">Estimated items subtotal</div>
                <div className="font-semibold">{money(itemsSubtotal)}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-600">
                This is an estimate for items only. Delivery fees/wallet math are unchanged.
              </div>
            </div>

            {itemsText ? (
              <details className="mt-3 rounded border bg-white p-3">
                <summary className="cursor-pointer text-sm font-medium">Menu snapshot (what will be sent)</summary>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-slate-800">{itemsText}</pre>
              </details>
            ) : null}
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