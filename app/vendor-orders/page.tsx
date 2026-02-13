"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import OfflineIndicator from "@/components/OfflineIndicator";

type VendorOrderStatus = "preparing" | "driver_arrived" | "picked_up" | "completed";

type VendorOrderItem = {
  name: string;
  quantity: number;
  price: number;
};

type VendorOrder = {
  id: string;
  created_at: string;
  vendor_id: string;
  vendor_name?: string | null;
  pickup_address?: string | null;
  dropoff_address?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  status: VendorOrderStatus;
  total_amount?: number | null;
  items?: VendorOrderItem[] | null;
  notes?: string | null;
};

type MenuItem = {
  id: string;
  vendor_id: string;
  name: string;
  price: number;
  available: boolean;
  sold_out: boolean;
  updated_at?: string | null;
};

function normText(s: any) {
  try {
    if (typeof s !== "string") return String(s ?? "");
    return s
      .replace(/\u2013|\u2014/g, "-")
      .replace(/\u2022/g, "-")
      .replace(/\u20B1/g, "PHP")
      .replace(/\u2019|\u2018/g, "'")
      .replace(/\u201C|\u201D/g, '"');
  } catch {
    return String(s ?? "");
  }
}

function money(n: any) {
  const x = Number(n || 0);
  if (!isFinite(x)) return "PHP 0.00";
  return `PHP ${x.toFixed(2)}`;
}

function formatItemLine(it: any) {
  const name = normText(it?.name || "");
  const qty = Number(it?.quantity || 0) || 0;
  const price = Number(it?.price || 0) || 0;
  return `${qty}x ${name} - PHP ${price.toFixed(2)}`;
}

function isSameLocalDay(iso: string | null | undefined) {
  if (!iso) return false;
  const d = new Date(iso);
  if (!isFinite(d.getTime())) return false;
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function VendorOrdersInner() {
  const searchParams = useSearchParams();
  const vendorIdFromQuery = String(searchParams?.get("vendor_id") || "").trim();

  const [vendorId, setVendorId] = useState<string>("");

  // Testing modal (must click OK)
  const [showTakeoutTestingNotice, setShowTakeoutTestingNotice] = useState(false);
  const openTakeoutTestingNotice = (e: any) => {
    try { e?.preventDefault?.(); e?.stopPropagation?.(); } catch {}
    setShowTakeoutTestingNotice(true);
  };

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const fromQuery = String(vendorIdFromQuery || "").trim();
      const stored = String(window.localStorage.getItem("JRIDE_VENDOR_ID") || "").trim();
      const resolved = (fromQuery || stored).trim();

      if (fromQuery) {
        window.localStorage.setItem("JRIDE_VENDOR_ID", fromQuery);
        try {
          const clean = window.location.pathname;
          window.history.replaceState({}, "", clean);
        } catch {}
      }

      if (resolved) setVendorId(resolved);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");

  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState<boolean>(false);
  const [menuErr, setMenuErr] = useState<string>("");
  const [menuBusy, setMenuBusy] = useState<string | null>(null);

  const vendorActionBlocked = true;
  const vendorActionBlockMessage =
    "Testing Phase Notice: Takeout is under pilot testing. Orders placed at this time will not be processed. Please wait for the official launch announcement.";

  async function loadOrders() {
    if (!vendorId) return;
    setLoading(true);
    setErr("");
    try {
      const res = await fetch(`/api/vendor/orders?vendor_id=${encodeURIComponent(vendorId)}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Orders fetch failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const rows = Array.isArray(j.orders) ? (j.orders as VendorOrder[]) : [];
      setOrders(rows);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to load orders"));
    } finally {
      setLoading(false);
    }
  }

  async function loadMenu() {
    if (!vendorId) return;
    setMenuLoading(true);
    setMenuErr("");
    try {
      const res = await fetch(`/api/vendor/menu?vendor_id=${encodeURIComponent(vendorId)}`, { cache: "no-store" });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Menu fetch failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      const items = Array.isArray(j.items) ? (j.items as MenuItem[]) : [];
      setMenuItems(items);
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Failed to load menu"));
    } finally {
      setMenuLoading(false);
    }
  }

  useEffect(() => {
    loadOrders();
    loadMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendorId]);

  function statusChip(status: VendorOrderStatus) {
    const s = String(status || "").toLowerCase();
    const base = "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold border";
    if (s === "completed") return `${base} bg-emerald-50 border-emerald-200 text-emerald-800`;
    if (s === "picked_up") return `${base} bg-indigo-50 border-indigo-200 text-indigo-800`;
    if (s === "driver_arrived") return `${base} bg-amber-50 border-amber-200 text-amber-800`;
    return `${base} bg-slate-50 border-slate-200 text-slate-800`;
  }

  function vendorCanTransitionUI(o: VendorOrder, to: VendorOrderStatus) {
    const from = String(o?.status || "").toLowerCase();
    if (to === "picked_up") return from === "driver_arrived";
    if (to === "completed") return from === "picked_up";
    return false;
  }

  async function handleStatusUpdate(order: VendorOrder, to: VendorOrderStatus) {
    if (!order?.id) return;

    if (vendorActionBlocked) {
      alert(vendorActionBlockMessage);
      return;
    }

    try {
      const res = await fetch(`/api/vendor/orders/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ order_id: order.id, status: to }),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Update failed (HTTP ${res.status})`;
        throw new Error(msg);
      }
      await loadOrders();
    } catch (e: any) {
      alert(String(e?.message || e || "Update failed"));
    }
  }

  async function menuAction(id: string, action: "update_price" | "toggle_available" | "toggle_soldout") {
    if (!id) return;

    if (vendorActionBlocked) {
      alert(vendorActionBlockMessage);
      return;
    }

    setMenuBusy(id);
    setMenuErr("");
    try {
      let payload: any = { vendor_id: vendorId, item_id: id, action };

      if (action === "update_price") {
        const current = menuItems.find((x) => x.id === id);
        const cur = current?.price ?? 0;
        const next = window.prompt("New price (PHP)", String(cur));
        if (next == null) return;
        const p = Number(next);
        if (!isFinite(p) || p < 0) throw new Error("Invalid price");
        payload.price = p;
      }

      const res = await fetch(`/api/vendor/menu/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg = j?.message || j?.error || `Menu update failed (HTTP ${res.status})`;
        throw new Error(msg);
      }

      const items = Array.isArray(j.items) ? (j.items as MenuItem[]) : [];
      setMenuItems(items);
    } catch (e: any) {
      setMenuErr(String(e?.message || e || "Menu action failed"));
      try { await loadMenu(); } catch {}
    } finally {
      setMenuBusy(null);
    }
  }

  const todays = useMemo(() => orders.filter((o) => isSameLocalDay(o.created_at)), [orders]);
  const past = useMemo(() => orders.filter((o) => !isSameLocalDay(o.created_at)), [orders]);

  const SAMPLE_MENU = useMemo(
    () => [
      { label: "Dinakdakan", price: "PHP 120", img: "/vendor-samples/dinakdakan.jpg" },
      { label: "Hamburger", price: "PHP 85", img: "/vendor-samples/hamburger.jpg" },
      { label: "Milk Tea", price: "PHP 65", img: "/vendor-samples/milktea.jpg" },
      { label: "Native Chicken Soup", price: "PHP 180", img: "/vendor-samples/native-chicken-soup.jpg" },
      { label: "Pinapaitan", price: "PHP 150", img: "/vendor-samples/pinapaitan.jpg" },
    ],
    []
  );

  function VendorPlanCompare() {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-emerald-900">Takeout is in testing</div>
              <div className="mt-0.5 text-[11px] text-emerald-900/80">
                For interested food stall owners/vendors: message us on Facebook or visit{" "}
                <span className="font-semibold">jride.net</span>.
              </div>
            </div>

            {/* MOBILE VISIBLE CTA */}
            <button
              type="button"
              onClick={openTakeoutTestingNotice}
              className="inline-flex rounded-full border border-emerald-200 bg-emerald-100 px-3 py-1 text-[11px] font-semibold text-emerald-900 hover:bg-emerald-200"
            >
              Learn more
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      <VendorPlanCompare />
      <OfflineIndicator />

      {/* MODAL (OK closes) */}
      {showTakeoutTestingNotice && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-sm font-semibold text-slate-900">Testing Phase Notice</div>

            <div className="mt-2 text-sm text-slate-700 space-y-2">
              <p>
                The Takeout feature is still under pilot testing. Orders placed at this time will not be processed.
              </p>
              <p>Please wait for the official launch announcement.</p>
              <p className="pt-1">
                Food stall owners and vendors interested in joining may contact us via Facebook or visit{" "}
                <span className="font-semibold">jride.net</span>.
              </p>
            </div>

            <div className="mt-4 flex justify-end">
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => setShowTakeoutTestingNotice(false)}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">JRide Vendor</h1>
            <p className="text-xs text-slate-500">Orders + Menu (pilot mode)</p>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              onClick={openTakeoutTestingNotice}
              className="hidden sm:inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-800 hover:bg-emerald-100"
            >
              Compare Plans
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <div className="rounded-xl border bg-white p-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-xs font-semibold text-slate-700">Vendor ID</div>
              <div className="mt-0.5 text-[11px] text-slate-500">
                Saved to your device. (Query vendor_id is auto-removed from URL.)
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                className="w-72 max-w-full rounded-lg border px-3 py-2 text-sm"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                placeholder="Paste your vendor_id"
              />
              <button
                type="button"
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                onClick={() => {
                  try {
                    window.localStorage.setItem("JRIDE_VENDOR_ID", vendorId.trim());
                    alert("Saved");
                    loadOrders();
                    loadMenu();
                  } catch {
                    alert("Failed to save");
                  }
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Orders</div>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
              onClick={loadOrders}
            >
              Refresh
            </button>
          </div>

          {loading ? (
            <div className="mt-3 text-sm text-slate-500">Loading...</div>
          ) : err ? (
            <div className="mt-3 text-sm text-red-600">{err}</div>
          ) : (
            <>
              <div className="mt-3 grid gap-3">
                {todays.length === 0 ? (
                  <div className="text-sm text-slate-500">No orders today.</div>
                ) : (
                  todays.map((o) => {
                    const items = Array.isArray(o.items) ? o.items : [];
                    const total = Number(o.total_amount || 0) || 0;

                    return (
                      <div key={o.id} className="rounded-xl border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs text-slate-500">Order</div>
                            <div className="text-sm font-semibold text-slate-900">{o.id}</div>
                            <div className="mt-1 flex items-center gap-2">
                              <span className={statusChip(o.status)}>{String(o.status).replace("_", " ")}</span>
                              <span className="text-[11px] text-slate-500">{new Date(o.created_at).toLocaleString()}</span>
                            </div>
                          </div>

                          <div className="text-right">
                            <div className="text-xs text-slate-500">Total</div>
                            <div className="text-sm font-semibold text-slate-900">{money(total)}</div>
                          </div>
                        </div>

                        <div className="mt-3 grid gap-2 text-sm">
                          <div className="rounded-lg bg-slate-50 p-2">
                            <div className="text-xs font-semibold text-slate-700">Items</div>
                            <div className="mt-1 space-y-1 text-[12px] text-slate-700">
                              {items.length === 0 ? (
                                <div className="text-slate-500">No items</div>
                              ) : (
                                items.map((it, idx) => (
                                  <div key={idx} className="font-mono">
                                    {formatItemLine(it)}
                                  </div>
                                ))
                              )}
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-lg bg-slate-50 p-2">
                              <div className="text-xs font-semibold text-slate-700">Pickup</div>
                              <div className="mt-0.5 text-[12px] text-slate-700">{normText(o.pickup_address || "-")}</div>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-2">
                              <div className="text-xs font-semibold text-slate-700">Dropoff</div>
                              <div className="mt-0.5 text-[12px] text-slate-700">{normText(o.dropoff_address || "-")}</div>
                            </div>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="rounded-lg bg-slate-50 p-2">
                              <div className="text-xs font-semibold text-slate-700">Customer</div>
                              <div className="mt-0.5 text-[12px] text-slate-700">{normText(o.customer_name || "-")}</div>
                              <div className="mt-0.5 text-[12px] text-slate-700">{normText(o.customer_phone || "-")}</div>
                            </div>
                            <div className="rounded-lg bg-slate-50 p-2">
                              <div className="text-xs font-semibold text-slate-700">Notes</div>
                              <div className="mt-0.5 text-[12px] text-slate-700">{normText(o.notes || "-")}</div>
                            </div>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-2">
                            <button
                              type="button"
                              className="rounded-lg border px-3 py-2 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-50"
                              disabled={vendorActionBlocked || !vendorCanTransitionUI(o, "picked_up")}
                              onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o, "picked_up") ? null : handleStatusUpdate(o, "picked_up"))}
                            >
                              Mark Picked Up
                            </button>
                            <button
                              type="button"
                              className="rounded-lg border px-3 py-2 text-[12px] font-semibold hover:bg-slate-50 disabled:opacity-50"
                              disabled={vendorActionBlocked || !vendorCanTransitionUI(o, "completed")}
                              onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o, "completed") ? null : handleStatusUpdate(o, "completed"))}
                            >
                              Mark Completed
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {past.length > 0 && (
                <details className="mt-4">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    Past orders ({past.length})
                  </summary>
                  <div className="mt-3 grid gap-3">
                    {past.map((o) => (
                      <div key={o.id} className="rounded-xl border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-sm font-semibold text-slate-900">{o.id}</div>
                          <span className={statusChip(o.status)}>{String(o.status).replace("_", " ")}</span>
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{new Date(o.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </>
          )}
        </div>

        <div className="mt-4 rounded-xl border bg-white p-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-900">Menu</div>
            <button
              type="button"
              className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50"
              onClick={loadMenu}
            >
              Refresh
            </button>
          </div>

          {menuLoading ? (
            <div className="mt-3 text-sm text-slate-500">Loading menu...</div>
          ) : menuErr ? (
            <div className="mt-3 text-sm text-red-600">{menuErr}</div>
          ) : (
            <div className="mt-3 space-y-2">
              {menuItems.length === 0 ? (
                <div className="text-sm text-slate-500">No menu items yet.</div>
              ) : (
                menuItems.map((m) => {
                  const id = m.id;
                  const busy = menuBusy === id;

                  return (
                    <div key={id} className="rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-slate-900">{normText(m.name)}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {money(m.price)} · {m.available ? "Available" : "Hidden"} · {m.sold_out ? "Sold out" : "In stock"}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={busy || vendorActionBlocked}
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => (vendorActionBlocked ? null : menuAction(id, "update_price"))}
                          >
                            Edit Price
                          </button>
                          <button
                            type="button"
                            disabled={busy || vendorActionBlocked}
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => (vendorActionBlocked ? null : menuAction(id, "toggle_available"))}
                          >
                            Toggle Visible
                          </button>
                          <button
                            type="button"
                            disabled={busy || vendorActionBlocked}
                            className="rounded-lg border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50 disabled:opacity-50"
                            onClick={() => (vendorActionBlocked ? null : menuAction(id, "toggle_soldout"))}
                          >
                            Toggle Sold Out
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        <div className="mt-4 mx-auto max-w-5xl">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-[12px] font-semibold text-emerald-900">Premium photo menu (sample)</div>
            <div className="mt-1 text-[11px] text-emerald-900/80">Tap photo to zoom - Swipe to browse</div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {SAMPLE_MENU.map((m) => (
                <div key={m.label} className="overflow-hidden rounded-xl border bg-white">
                  <img src={m.img} alt={m.label} className="h-28 w-full object-cover" loading="lazy" />
                  <div className="p-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[12px] font-semibold text-slate-900">{m.label}</div>
                      <div className="text-[12px] font-semibold text-slate-900">{m.price}</div>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">Photo menu + swipeable gallery</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="text-[11px] text-emerald-900/80">Photos are auto-resized to save data and avoid large uploads.</div>

            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-emerald-900 underline">See sample</summary>
              <div className="mt-2 text-[11px] text-emerald-800/80">
                Premium feels like a real food app: zoom into the store and swipe the photo menu.
              </div>
            </details>

            <div className="mt-3">
              <button
                type="button"
                onClick={openTakeoutTestingNotice}
                className="w-full rounded-lg bg-emerald-700 px-3 py-2 text-[12px] font-semibold text-white hover:bg-emerald-600"
              >
                Upgrade to Premium
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default function VendorOrdersPage() {
  return (
    <Suspense fallback={<div className="p-4 text-xs text-slate-500">Loading vendor...</div>}>
      <VendorOrdersInner />
    </Suspense>
  );
}