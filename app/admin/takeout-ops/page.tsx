"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type StatusFilter = "active" | "requested" | "preparing" | "pickup_ready" | "completed" | "cancelled" | "all";

type TakeoutItem = {
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
};

type TakeoutOrder = {
  id?: string | null;
  booking_code?: string | null;
  service_type?: string | null;
  status?: string | null;
  vendor_status?: string | null;
  customer_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  customer_name?: string | null;
  passenger_name?: string | null;
  customer_phone?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  items?: TakeoutItem[] | null;
  items_subtotal?: number | string | null;
  total_bill?: number | string | null;
  base_fee?: number | string | null;
  company_cut?: number | string | null;
};

type ApiResponse = {
  ok?: boolean;
  enabled?: boolean;
  error?: string;
  message?: string;
  orders?: TakeoutOrder[];
};

const VENDOR_STATUS_OPTIONS = ["preparing", "pickup_ready", "completed", "cancelled"];

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

function dateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeStatus(value: any): string {
  return text(value).toLowerCase();
}

function displayStatus(value: any): string {
  const s = text(value);
  return s ? s.replace(/_/g, " ") : "-";
}

function itemSubtotal(order: TakeoutOrder): number {
  const explicit = order.items_subtotal ?? order.total_bill ?? order.base_fee;
  const explicitNum = num(explicit);
  if (explicitNum > 0) return explicitNum;

  const items = Array.isArray(order.items) ? order.items : [];
  return items.reduce((sum, item) => {
    const qty = Math.max(1, Math.floor(num(item.quantity || 1)) || 1);
    return sum + num(item.price) * qty;
  }, 0);
}

function platformFee(order: TakeoutOrder): number {
  const subtotal = itemSubtotal(order);
  return Math.round(subtotal * 10) / 100;
}

function vendorEarnings(order: TakeoutOrder): number {
  const subtotal = itemSubtotal(order);
  return Math.round((subtotal - platformFee(order)) * 100) / 100;
}

function effectiveStatus(order: TakeoutOrder): string {
  const vendor = normalizeStatus(order.vendor_status);
  const customer = normalizeStatus(order.customer_status);
  const base = normalizeStatus(order.status);
  return vendor || customer || base || "requested";
}

function isActive(order: TakeoutOrder): boolean {
  const s = effectiveStatus(order);
  return !["completed", "cancelled", "canceled"].includes(s);
}

function matchesFilter(order: TakeoutOrder, filter: StatusFilter): boolean {
  const s = effectiveStatus(order);
  if (filter === "all") return true;
  if (filter === "active") return isActive(order);
  if (filter === "pickup_ready") return ["pickup_ready", "ready", "prepared", "driver_arrived", "ready_for_pickup"].includes(s);
  if (filter === "cancelled") return ["cancelled", "canceled"].includes(s);
  return s === filter;
}

function statusClass(order: TakeoutOrder): string {
  const s = effectiveStatus(order);
  if (s === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (s === "cancelled" || s === "canceled") return "border-rose-200 bg-rose-50 text-rose-800";
  if (["pickup_ready", "ready", "prepared", "driver_arrived", "ready_for_pickup"].includes(s)) return "border-amber-200 bg-amber-50 text-amber-800";
  if (s === "preparing") return "border-blue-200 bg-blue-50 text-blue-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function orderCode(order: TakeoutOrder): string {
  return text(order.booking_code) || text(order.id) || "-";
}

function customerName(order: TakeoutOrder): string {
  return text(order.customer_name) || text(order.passenger_name) || "-";
}

export default function AdminTakeoutOpsPage() {
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string>("");

  async function loadOrders(silent = false) {
    try {
      if (!silent) setLoading(true);
      setError(null);
      const res = await fetch("/api/takeout/orders?limit=200", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as ApiResponse;
      if (!res.ok || body.ok === false) {
        throw new Error(body.message || body.error || "Failed to load takeout orders.");
      }
      const next = Array.isArray(body.orders) ? body.orders : [];
      setOrders(next.filter((o) => normalizeStatus(o.service_type || "takeout") === "takeout"));
    } catch (err: any) {
      setError(err?.message || "Failed to load takeout orders.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadOrders(false);
    const t = window.setInterval(() => loadOrders(true), 10000);
    return () => window.clearInterval(t);
  }, []);

  const counts = useMemo(() => {
    const c = { active: 0, requested: 0, preparing: 0, pickup_ready: 0, completed: 0, cancelled: 0, all: orders.length };
    for (const order of orders) {
      const s = effectiveStatus(order);
      if (isActive(order)) c.active++;
      if (s === "requested") c.requested++;
      if (s === "preparing") c.preparing++;
      if (["pickup_ready", "ready", "prepared", "driver_arrived", "ready_for_pickup"].includes(s)) c.pickup_ready++;
      if (s === "completed") c.completed++;
      if (s === "cancelled" || s === "canceled") c.cancelled++;
    }
    return c;
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders
      .filter((order) => matchesFilter(order, filter))
      .filter((order) => {
        if (!q) return true;
        const haystack = [
          order.booking_code,
          order.id,
          order.vendor_id,
          order.vendor_name,
          order.customer_name,
          order.passenger_name,
          order.customer_phone,
          order.from_label,
          order.to_label,
          order.vendor_status,
          order.customer_status,
          order.status,
        ]
          .map((v) => text(v).toLowerCase())
          .join(" ");
        return haystack.includes(q);
      })
      .sort((a, b) => new Date(b.created_at || b.updated_at || 0).getTime() - new Date(a.created_at || a.updated_at || 0).getTime());
  }, [orders, filter, query]);

  const totals = useMemo(() => {
    return filteredOrders.reduce(
      (acc, order) => {
        acc.gross += itemSubtotal(order);
        acc.platform += platformFee(order);
        acc.vendor += vendorEarnings(order);
        return acc;
      },
      { gross: 0, platform: 0, vendor: 0 }
    );
  }, [filteredOrders]);

  async function updateVendorStatus(order: TakeoutOrder, nextStatus: string) {
    const id = text(order.id);
    const vendorId = text(order.vendor_id);
    if (!id || !vendorId) {
      setLastAction("Cannot update: missing order id or vendor id.");
      return;
    }

    try {
      setUpdatingId(id);
      setLastAction("Updating " + orderCode(order) + "...");
      const res = await fetch("/api/takeout/vendor/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ order_id: id, vendor_id: vendorId, vendor_status: nextStatus }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body?.ok === false) {
        throw new Error(body?.message || body?.error || "Status update failed.");
      }
      setLastAction(orderCode(order) + " updated to " + nextStatus + ".");
      await loadOrders(true);
    } catch (err: any) {
      setLastAction(err?.message || "Status update failed.");
    } finally {
      setUpdatingId(null);
    }
  }

  function pillClass(active: boolean): string {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm",
      active ? "border-black bg-black text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
    ].join(" ");
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-4">
        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Admin operations</p>
              <h1 className="text-2xl font-bold">Takeout Ops</h1>
              <p className="mt-1 max-w-3xl text-sm text-slate-600">
                Separate takeout command center. This page reads only takeout orders and does not use ride dispatch lifecycle actions.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/admin/livetrips" className="rounded-lg border px-3 py-2 text-sm hover:bg-slate-50">
                LiveTrips rides only
              </Link>
              <button
                type="button"
                onClick={() => {
                  setRefreshing(true);
                  loadOrders(true);
                }}
                className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                disabled={refreshing || loading}
              >
                {refreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Shown orders</div><div className="text-xl font-bold">{filteredOrders.length}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Active</div><div className="text-xl font-bold">{counts.active}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Pickup ready</div><div className="text-xl font-bold">{counts.pickup_ready}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Gross food</div><div className="text-lg font-bold">{money(totals.gross)}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Platform 10%</div><div className="text-lg font-bold">{money(totals.platform)}</div></div>
            <div className="rounded-xl border bg-slate-50 p-3"><div className="text-xs text-slate-500">Vendor 90%</div><div className="text-lg font-bold">{money(totals.vendor)}</div></div>
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {(["active", "requested", "preparing", "pickup_ready", "completed", "cancelled", "all"] as StatusFilter[]).map((key) => (
                <button key={key} type="button" onClick={() => setFilter(key)} className={pillClass(filter === key)}>
                  {displayStatus(key)} <span className="text-xs opacity-80">{counts[key]}</span>
                </button>
              ))}
            </div>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search code, customer, vendor, place"
              className="w-full rounded-lg border px-3 py-2 text-sm lg:max-w-sm"
            />
          </div>
          {lastAction ? <div className="mt-3 rounded-lg border bg-slate-50 px-3 py-2 text-xs text-slate-600">{lastAction}</div> : null}
          {error ? <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        </section>

        <section className="overflow-hidden rounded-2xl border bg-white shadow-sm">
          <div className="border-b px-4 py-3">
            <div className="font-semibold">Takeout order queue</div>
            <div className="text-xs text-slate-500">Statuses are takeout vendor/customer statuses, not ride trip statuses.</div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="p-3">Order</th>
                  <th className="p-3">Customer</th>
                  <th className="p-3">Vendor</th>
                  <th className="p-3">Delivery</th>
                  <th className="p-3">Items</th>
                  <th className="p-3">Totals</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading takeout orders...</td></tr>
                ) : filteredOrders.length === 0 ? (
                  <tr><td colSpan={8} className="p-6 text-center text-slate-500">No takeout orders in this view.</td></tr>
                ) : (
                  filteredOrders.map((order) => {
                    const id = text(order.id) || orderCode(order);
                    const disabled = updatingId === text(order.id);
                    const items = Array.isArray(order.items) ? order.items : [];
                    return (
                      <tr key={id} className="border-b align-top last:border-b-0">
                        <td className="p-3">
                          <div className="font-semibold">{orderCode(order)}</div>
                          <div className="text-xs text-slate-500">Created {dateTime(order.created_at)}</div>
                          <div className="text-xs text-slate-500">Updated {dateTime(order.updated_at)}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{customerName(order)}</div>
                          <div className="text-xs text-slate-500">{text(order.customer_phone) || "No phone"}</div>
                        </td>
                        <td className="p-3">
                          <div className="font-medium">{text(order.vendor_name) || "Vendor"}</div>
                          <div className="max-w-[160px] break-all text-xs text-slate-500">{text(order.vendor_id) || "-"}</div>
                        </td>
                        <td className="p-3">
                          <div className="max-w-[220px] text-xs text-slate-700">From: {text(order.from_label) || "-"}</div>
                          <div className="mt-1 max-w-[220px] text-xs text-slate-700">To: {text(order.to_label) || "-"}</div>
                        </td>
                        <td className="p-3">
                          {items.length ? (
                            <div className="space-y-1">
                              {items.slice(0, 4).map((item, idx) => (
                                <div key={idx} className="text-xs text-slate-700">
                                  {Math.max(1, Math.floor(num(item.quantity || 1)) || 1)} x {text(item.name) || "Item"} ({money(item.price)})
                                </div>
                              ))}
                              {items.length > 4 ? <div className="text-xs text-slate-400">+{items.length - 4} more</div> : null}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">No item rows loaded</span>
                          )}
                        </td>
                        <td className="p-3">
                          <div className="text-xs text-slate-500">Subtotal</div>
                          <div className="font-semibold">{money(itemSubtotal(order))}</div>
                          <div className="mt-1 text-xs text-slate-500">Platform: {money(platformFee(order))}</div>
                          <div className="text-xs text-slate-500">Vendor: {money(vendorEarnings(order))}</div>
                        </td>
                        <td className="p-3">
                          <span className={["inline-flex rounded-full border px-2 py-1 text-xs font-semibold", statusClass(order)].join(" ")}>{displayStatus(effectiveStatus(order))}</span>
                          <div className="mt-2 text-xs text-slate-500">Vendor: {displayStatus(order.vendor_status)}</div>
                          <div className="text-xs text-slate-500">Customer: {displayStatus(order.customer_status)}</div>
                          <div className="text-xs text-slate-500">Base: {displayStatus(order.status)}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-2">
                              {VENDOR_STATUS_OPTIONS.map((status) => (
                                <button
                                  key={status}
                                  type="button"
                                  disabled={disabled || normalizeStatus(order.vendor_status) === status}
                                  onClick={() => updateVendorStatus(order, status)}
                                  className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  {displayStatus(status)}
                                </button>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              {order.booking_code ? (
                                <Link className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50" href={`/takeout/orders/${order.booking_code}`}>
                                  Customer view
                                </Link>
                              ) : null}
                              {order.booking_code ? (
                                <Link className="rounded-lg border px-2 py-1 text-xs hover:bg-slate-50" href={`/takeout/orders/${order.booking_code}/receipt`}>
                                  Receipt
                                </Link>
                              ) : null}
                            </div>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
