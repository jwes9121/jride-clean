"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type Vendor = {
  id?: string | null;
  email?: string | null;
  display_name?: string | null;
  created_at?: string | null;
};

type MenuItem = {
  id?: string | null;
  menu_item_id?: string | null;
  vendor_id?: string | null;
  name?: string | null;
  description?: string | null;
  price?: number | string | null;
  sort_order?: number | string | null;
  is_available?: boolean | null;
  is_available_today?: boolean | null;
  available_today?: boolean | null;
  sold_out_today?: boolean | null;
  is_sold_out_today?: boolean | null;
  last_updated_at?: string | null;
};

type TakeoutItem = {
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
};

type TakeoutOrder = {
  id?: string | null;
  order_id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  vendor_id?: string | null;
  vendor_status?: string | null;
  customer_status?: string | null;
  status?: string | null;
  service_type?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  customer_name?: string | null;
  passenger_name?: string | null;
  customer_phone?: string | null;
  to_label?: string | null;
  dropoff_label?: string | null;
  items?: TakeoutItem[] | null;
  items_subtotal?: number | string | null;
  total_bill?: number | string | null;
};

type AddItemForm = {
  name: string;
  description: string;
  price: string;
  sort_order: string;
};

const LS_VENDOR_ID = "JRIDE_VENDOR_PORTAL_VENDOR_ID";
const REFRESH_MS = 10000;
const STATUS_OPTIONS = ["preparing", "pickup_ready", "completed", "cancelled"];

function text(value: any): string {
  return String(value ?? "").trim();
}

function num(value: any): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function money(value: any): string {
  return "PHP " + num(value).toFixed(2);
}

function menuItemId(item: MenuItem): string {
  return text(item.menu_item_id || item.id);
}

function itemAvailable(item: MenuItem): boolean {
  const raw = item.is_available ?? item.is_available_today ?? item.available_today;
  return typeof raw === "boolean" ? raw : true;
}

function itemSoldOut(item: MenuItem): boolean {
  const raw = item.sold_out_today ?? item.is_sold_out_today;
  return typeof raw === "boolean" ? raw : false;
}

function itemOrderable(item: MenuItem): boolean {
  return itemAvailable(item) && !itemSoldOut(item);
}

function orderId(order: TakeoutOrder): string {
  return text(order.id || order.order_id || order.booking_id);
}

function orderCode(order: TakeoutOrder): string {
  return text(order.booking_code) || orderId(order).slice(0, 8) || "-";
}

function orderStatus(order: TakeoutOrder): string {
  const s = text(order.vendor_status || order.customer_status || order.status || "requested").toLowerCase();
  if (s === "ready" || s === "prepared" || s === "ready_for_pickup") return "pickup_ready";
  if (s === "preparing_order") return "preparing";
  return s || "requested";
}

function displayStatus(status: any): string {
  const s = text(status).toLowerCase();
  return s ? s.replace(/_/g, " ") : "-";
}

function statusClass(status: string): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "cancelled" || status === "canceled") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "pickup_ready") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "preparing") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function orderSubtotal(order: TakeoutOrder): number {
  const explicit = num(order.items_subtotal ?? order.total_bill);
  if (explicit > 0) return explicit;
  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item) => sum + num(item.price) * Math.max(1, num(item.quantity) || 1), 0);
}

function activeOrder(order: TakeoutOrder): boolean {
  const s = orderStatus(order);
  return !["completed", "cancelled", "canceled"].includes(s);
}

function itemButtonClass(active: boolean): string {
  return [
    "rounded-lg border px-3 py-2 text-xs font-semibold",
    active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ].join(" ");
}

export default function VendorPortalPage() {
  const [vendorId, setVendorId] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);
  const [form, setForm] = useState<AddItemForm>({ name: "", description: "", price: "", sort_order: "0" });

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem(LS_VENDOR_ID) : "";
    if (saved) setVendorId(saved);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && vendorId) localStorage.setItem(LS_VENDOR_ID, vendorId);
  }, [vendorId]);

  const selectedVendor = useMemo(() => {
    return vendors.find((v) => text(v.id) === text(vendorId)) || null;
  }, [vendors, vendorId]);

  const loadVendors = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/vendors", { cache: "no-store" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Failed to load vendors.");
      const list = Array.isArray(body?.vendors) ? body.vendors : [];
      setVendors(list);
      if (!vendorId && list.length > 0) setVendorId(text(list[0]?.id));
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to load vendors."));
    }
  }, [vendorId]);

  const loadMenu = useCallback(async () => {
    const id = text(vendorId);
    if (!id) {
      setMenuItems([]);
      return;
    }
    const res = await fetch(`/api/takeout/menu?vendor_id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Failed to load menu.");
    setMenuItems(Array.isArray(body?.items) ? body.items : []);
  }, [vendorId]);

  const loadOrders = useCallback(async () => {
    const id = text(vendorId);
    if (!id) {
      setOrders([]);
      return;
    }
    const res = await fetch(`/api/takeout/vendor/orders?vendor_id=${encodeURIComponent(id)}`, { cache: "no-store" });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Failed to load orders.");
    setOrders(Array.isArray(body?.orders) ? body.orders : []);
  }, [vendorId]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      await Promise.all([loadVendors(), loadMenu(), loadOrders()]);
      setMessage("Vendor portal refreshed.");
    } catch (e: any) {
      setError(String(e?.message || e || "Refresh failed."));
    } finally {
      setLoading(false);
    }
  }, [loadVendors, loadMenu, loadOrders]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadOrders().catch(() => {});
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [loadOrders]);

  async function addMenuItem() {
    const id = text(vendorId);
    const name = text(form.name);
    const price = num(form.price);
    if (!id) return setError("Select a vendor first.");
    if (!name) return setError("Menu item name is required.");
    if (price <= 0) return setError("Price must be greater than zero.");

    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/vendor-menu-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          vendor_id: id,
          name,
          description: text(form.description) || null,
          price,
          sort_order: num(form.sort_order),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Failed to add menu item.");
      setForm({ name: "", description: "", price: "", sort_order: "0" });
      await loadMenu();
      setMessage("Menu item added.");
    } catch (e: any) {
      setError(String(e?.message || e || "Failed to add menu item."));
    } finally {
      setSaving(false);
    }
  }

  async function menuAction(item: MenuItem, action: string, price?: string) {
    const id = text(vendorId);
    const menu_item_id = menuItemId(item);
    if (!id || !menu_item_id) return setError("Missing vendor or menu item id.");

    setUpdatingId(menu_item_id + action);
    setError("");
    try {
      const payload: any = { vendor_id: id, menu_item_id, action };
      if (action === "update_price") payload.price = num(price);
      const res = await fetch("/api/vendor-menu", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Menu update failed.");
      setMenuItems(Array.isArray(body?.items) ? body.items : []);
      setMessage("Menu updated.");
    } catch (e: any) {
      setError(String(e?.message || e || "Menu update failed."));
    } finally {
      setUpdatingId(null);
    }
  }

  async function updateOrderStatus(order: TakeoutOrder, nextStatus: string) {
    const id = orderId(order);
    const vendor_id = text(order.vendor_id || vendorId);
    if (!id || !vendor_id) return setError("Missing order or vendor id.");

    setUpdatingId(id + nextStatus);
    setError("");
    try {
      const res = await fetch("/api/takeout/vendor/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: id, vendor_id, vendor_status: nextStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) throw new Error(body?.message || body?.error || "Order update failed.");
      await loadOrders();
      setMessage("Order status updated.");
    } catch (e: any) {
      setError(String(e?.message || e || "Order update failed."));
    } finally {
      setUpdatingId(null);
    }
  }

  const visibleOrders = useMemo(() => {
    return orders
      .filter((order) => (showCompleted ? true : activeOrder(order)))
      .sort((a, b) => new Date(b.created_at || b.updated_at || 0).getTime() - new Date(a.created_at || a.updated_at || 0).getTime());
  }, [orders, showCompleted]);

  const stats = useMemo(() => {
    const active = orders.filter(activeOrder).length;
    const completed = orders.filter((o) => orderStatus(o) === "completed").length;
    const gross = visibleOrders.reduce((sum, order) => sum + orderSubtotal(order), 0);
    const menuAvailable = menuItems.filter(itemOrderable).length;
    const soldOut = menuItems.filter(itemSoldOut).length;
    return { active, completed, gross, menuAvailable, soldOut };
  }, [orders, visibleOrders, menuItems]);

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-xs font-bold uppercase tracking-wide text-emerald-700">JRide Takeout</div>
              <h1 className="text-2xl font-bold">Vendor Portal</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Manage vendor menu, daily availability, order queue, and earnings readiness. This page uses takeout vendor APIs only and does not call ride dispatch, fare proposal, or trip lifecycle routes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href="/vendor-orders" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Classic vendor orders</a>
              <a href="/takeout" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Customer takeout page</a>
              <button type="button" onClick={refreshAll} disabled={loading} className="rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr]">
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Vendor ID</span>
              <input value={vendorId} onChange={(e) => setVendorId(e.target.value)} placeholder="Paste vendor UUID" className="w-full rounded-lg border px-3 py-2" />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block font-medium">Known vendors</span>
              <select value={vendorId} onChange={(e) => setVendorId(e.target.value)} className="w-full rounded-lg border px-3 py-2">
                <option value="">Select vendor</option>
                {vendors.map((vendor) => {
                  const id = text(vendor.id);
                  return <option key={id} value={id}>{text(vendor.display_name) || text(vendor.email) || id}</option>;
                })}
              </select>
            </label>
          </div>

          {selectedVendor ? (
            <div className="mt-2 text-xs text-slate-500">Selected: {text(selectedVendor.display_name) || "Vendor"} {selectedVendor.email ? `- ${selectedVendor.email}` : ""}</div>
          ) : null}

          {message ? <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}

          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Active orders</div><div className="text-2xl font-bold">{stats.active}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Completed</div><div className="text-2xl font-bold">{stats.completed}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Shown gross</div><div className="text-lg font-bold">{money(stats.gross)}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Orderable items</div><div className="text-2xl font-bold">{stats.menuAvailable}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Sold out today</div><div className="text-2xl font-bold">{stats.soldOut}</div></div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Menu Manager</h2>
                <p className="text-sm text-slate-600">Add items, edit prices, mark unavailable, or mark sold out for today.</p>
              </div>
              <button type="button" onClick={() => void loadMenu().catch((e: any) => setError(String(e?.message || e)))} className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">Refresh menu</button>
            </div>

            <div className="mt-4 rounded-xl border bg-slate-50 p-3">
              <div className="mb-2 text-sm font-semibold">Add menu item</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
                <input value={form.name} onChange={(e) => setForm((x) => ({ ...x, name: e.target.value }))} placeholder="Item name" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={form.price} onChange={(e) => setForm((x) => ({ ...x, price: e.target.value }))} placeholder="Price" className="rounded-lg border px-3 py-2 text-sm" />
                <input value={form.sort_order} onChange={(e) => setForm((x) => ({ ...x, sort_order: e.target.value }))} placeholder="Sort" className="rounded-lg border px-3 py-2 text-sm" />
                <button type="button" onClick={addMenuItem} disabled={saving} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Adding..." : "Add item"}</button>
              </div>
              <textarea value={form.description} onChange={(e) => setForm((x) => ({ ...x, description: e.target.value }))} placeholder="Description" className="mt-2 w-full rounded-lg border px-3 py-2 text-sm" rows={2} />
            </div>

            <div className="mt-4 space-y-2">
              {menuItems.length === 0 ? (
                <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No menu items loaded for this vendor.</div>
              ) : (
                menuItems.map((item) => {
                  const id = menuItemId(item);
                  const available = itemAvailable(item);
                  const sold = itemSoldOut(item);
                  const orderable = itemOrderable(item);
                  const disabled = !!updatingId;
                  return (
                    <div key={id} className="rounded-xl border bg-white p-3">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="font-semibold">{text(item.name) || "Unnamed item"}</div>
                          <div className="text-xs text-slate-500">{text(item.description) || "No description"}</div>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs">
                            <span className="rounded-full border bg-slate-50 px-2 py-1">{money(item.price)}</span>
                            <span className={["rounded-full border px-2 py-1", orderable ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"].join(" ")}>{orderable ? "Orderable" : "Not orderable"}</span>
                            {sold ? <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800">Sold out</span> : null}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" disabled={disabled} onClick={() => menuAction(item, "toggle_available")} className={itemButtonClass(available)}>{available ? "Set unavailable" : "Set available"}</button>
                          <button type="button" disabled={disabled} onClick={() => menuAction(item, "toggle_soldout")} className={itemButtonClass(sold)}>{sold ? "Clear sold out" : "Sold out"}</button>
                          <button type="button" disabled={disabled} onClick={() => {
                            const next = window.prompt("New price", String(num(item.price).toFixed(2)));
                            if (next !== null) void menuAction(item, "update_price", next);
                          }} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Edit price</button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">Order Queue</h2>
                <p className="text-sm text-slate-600">Process live takeout orders without using ride dispatch routes.</p>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-600">
                <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
                Show completed
              </label>
            </div>

            <div className="mt-4 space-y-3">
              {visibleOrders.length === 0 ? (
                <div className="rounded-xl border bg-white p-4 text-sm text-slate-500">No orders in this view.</div>
              ) : (
                visibleOrders.map((order) => {
                  const id = orderId(order);
                  const status = orderStatus(order);
                  const disabled = !!updatingId;
                  const items = Array.isArray(order.items) ? order.items : [];
                  return (
                    <div key={id || orderCode(order)} className="rounded-xl border bg-white p-4">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <div className="font-bold">{orderCode(order)}</div>
                            <span className={["rounded-full border px-2 py-1 text-xs font-semibold", statusClass(status)].join(" ")}>{displayStatus(status)}</span>
                          </div>
                          <div className="mt-1 text-sm text-slate-700">{text(order.customer_name || order.passenger_name) || "Customer"}</div>
                          <div className="text-xs text-slate-500">Deliver to: {text(order.to_label || order.dropoff_label) || "-"}</div>
                          <div className="text-xs text-slate-400">Created: {text(order.created_at) || "-"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-slate-500">Subtotal</div>
                          <div className="text-lg font-bold">{money(orderSubtotal(order))}</div>
                        </div>
                      </div>

                      <div className="mt-3 rounded-xl border bg-slate-50 p-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</div>
                        {items.length === 0 ? <div className="mt-2 text-sm text-slate-500">No item snapshot.</div> : null}
                        {items.map((item, idx) => (
                          <div key={idx} className="mt-2 flex items-center justify-between gap-3 text-sm">
                            <div>
                              <div className="font-medium">{text(item.name) || "Item"}</div>
                              <div className="text-xs text-slate-500">Qty {Math.max(1, num(item.quantity) || 1)} x {money(item.price)}</div>
                            </div>
                            <div className="font-semibold">{money(num(item.price) * Math.max(1, num(item.quantity) || 1))}</div>
                          </div>
                        ))}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        {STATUS_OPTIONS.map((next) => (
                          <button key={next} type="button" disabled={disabled || status === next} onClick={() => updateOrderStatus(order, next)} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                            {displayStatus(next)}
                          </button>
                        ))}
                        {order.booking_code ? <a href={`/takeout/orders/${encodeURIComponent(order.booking_code)}/track`} className="rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Track</a> : null}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
