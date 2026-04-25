"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

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

type ApiResult = {
  ok?: boolean;
  error?: string;
  message?: string;
  orders?: TakeoutOrder[];
  [key: string]: unknown;
};

const LS_VENDOR_ID = "JRIDE_TAKEOUT_VENDOR_ID";
const REFRESH_MS = 10000;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "PHP 0.00";
  return "PHP " + n.toFixed(2);
}

function orderId(order: TakeoutOrder): string {
  return text(order.id || order.order_id || order.booking_id);
}

function code(order: TakeoutOrder): string {
  return text(order.booking_code) || orderId(order).slice(0, 8) || "-";
}

function statusOf(order: TakeoutOrder): string {
  return text(order.customer_status || order.vendor_status || order.status || "requested").toLowerCase();
}

function displayStatus(order: TakeoutOrder): string {
  const s = statusOf(order);
  if (s === "pickup_ready" || s === "ready" || s === "prepared" || s === "driver_arrived") return "ready_for_pickup";
  if (s === "preparing_order") return "preparing";
  return s || "requested";
}

function statusClass(status: string): string {
  if (status === "completed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "cancelled" || status === "canceled") return "border-rose-200 bg-rose-50 text-rose-800";
  if (status === "ready_for_pickup" || status === "pickup_ready" || status === "ready") return "border-blue-200 bg-blue-50 text-blue-800";
  if (status === "preparing") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function isActive(order: TakeoutOrder): boolean {
  const s = displayStatus(order);
  return s !== "completed" && s !== "cancelled" && s !== "canceled";
}

async function readJson(url: string): Promise<ApiResult> {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(text((body as ApiResult).message || (body as ApiResult).error) || "REQUEST_FAILED");
  }
  return body as ApiResult;
}

async function postJson(url: string, payload: Record<string, unknown>): Promise<ApiResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(text((body as ApiResult).message || (body as ApiResult).error) || "REQUEST_FAILED");
  }
  return body as ApiResult;
}

export default function VendorTakeoutOrdersPage() {
  const [vendorId, setVendorId] = useState("");
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    try {
      const saved = text(window.localStorage.getItem(LS_VENDOR_ID));
      if (saved) setVendorId(saved);
    } catch {
      // localStorage may be blocked; ignore.
    }
  }, []);

  const loadOrders = useCallback(async () => {
    const vid = text(vendorId);
    if (!vid) {
      setOrders([]);
      return;
    }

    setLoading(true);
    setError("");
    try {
      try {
        window.localStorage.setItem(LS_VENDOR_ID, vid);
      } catch {
        // localStorage may be blocked; ignore.
      }

      const data = await readJson("/api/takeout/vendor/orders?vendor_id=" + encodeURIComponent(vid));
      const list = Array.isArray(data.orders) ? data.orders : [];
      setOrders(list);
      setMessage("Loaded " + list.length + " order(s).");
    } catch (err: any) {
      setError(text(err?.message) || "Failed to load vendor orders.");
    } finally {
      setLoading(false);
    }
  }, [vendorId]);

  useEffect(() => {
    if (!text(vendorId)) return;
    void loadOrders();
  }, [vendorId, loadOrders]);

  useEffect(() => {
    if (!text(vendorId)) return;
    const timer = window.setInterval(() => {
      void loadOrders();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [vendorId, loadOrders]);

  async function updateStatus(order: TakeoutOrder, vendorStatus: string) {
    const vid = text(vendorId);
    const id = orderId(order);
    if (!vid || !id) return;

    setSavingId(id);
    setError("");
    setMessage("");
    try {
      await postJson("/api/takeout/vendor/orders", {
        vendor_id: vid,
        order_id: id,
        vendor_status: vendorStatus,
      });
      setMessage("Order " + code(order) + " updated to " + vendorStatus + ".");
      await loadOrders();
    } catch (err: any) {
      setError(text(err?.message) || "Failed to update order.");
    } finally {
      setSavingId(null);
    }
  }

  const visibleOrders = useMemo(() => {
    return orders.filter((order) => showCompleted || isActive(order));
  }, [orders, showCompleted]);

  const totals = useMemo(() => {
    let active = 0;
    let completed = 0;
    let gross = 0;
    for (const order of orders) {
      const status = displayStatus(order);
      if (status === "completed") completed += 1;
      else if (status !== "cancelled" && status !== "canceled") active += 1;
      gross += Number(order.items_subtotal ?? order.total_bill ?? 0) || 0;
    }
    return { active, completed, gross };
  }, [orders]);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-5">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JRide Takeout</p>
              <h1 className="mt-1 text-2xl font-bold">Vendor Orders Dashboard</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Pilot dashboard for receiving takeout orders and updating vendor status. This page does not call ride dispatch, ride fare, or trip lifecycle routes.
              </p>
            </div>
            <button
              type="button"
              onClick={loadOrders}
              disabled={loading || !text(vendorId)}
              className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Vendor ID</span>
              <input
                value={vendorId}
                onChange={(event) => setVendorId(event.target.value)}
                placeholder="Paste vendor UUID here"
                className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-emerald-500"
              />
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={showCompleted}
                onChange={(event) => setShowCompleted(event.target.checked)}
              />
              Show completed/cancelled
            </label>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Active orders</div>
              <div className="mt-1 text-2xl font-bold">{totals.active}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Completed</div>
              <div className="mt-1 text-2xl font-bold">{totals.completed}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">Listed gross subtotal</div>
              <div className="mt-1 text-2xl font-bold">{money(totals.gross)}</div>
            </div>
          </div>

          {message ? <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
          {error ? <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</div> : null}
        </section>

        <section className="space-y-3">
          {!text(vendorId) ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
              Enter a vendor ID to load takeout orders.
            </div>
          ) : loading && visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">Loading orders...</div>
          ) : visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">No takeout orders found for this view.</div>
          ) : (
            visibleOrders.map((order) => {
              const id = orderId(order);
              const currentStatus = displayStatus(order);
              const isSaving = savingId === id;
              const items = Array.isArray(order.items) ? order.items : [];

              return (
                <article key={id || code(order)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-bold">{code(order)}</h2>
                        <span className={"rounded-full border px-2 py-1 text-xs font-semibold " + statusClass(currentStatus)}>
                          {currentStatus}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-600">
                        {text(order.customer_name || order.passenger_name) || "Customer"}
                        {text(order.customer_phone) ? " - " + text(order.customer_phone) : ""}
                      </div>
                      <div className="mt-1 text-sm text-slate-500">Deliver to: {text(order.to_label || order.dropoff_label) || "-"}</div>
                      <div className="mt-1 text-xs text-slate-400">Created: {text(order.created_at) || "-"}</div>
                    </div>
                    <div className="text-left md:text-right">
                      <div className="text-xs text-slate-500">Subtotal</div>
                      <div className="text-xl font-bold">{money(order.items_subtotal ?? order.total_bill)}</div>
                    </div>
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</div>
                    {items.length === 0 ? (
                      <div className="mt-2 text-sm text-slate-500">No item snapshot found.</div>
                    ) : (
                      <div className="mt-2 divide-y divide-slate-200">
                        {items.map((item, index) => {
                          const qty = Number(item.quantity ?? 1) || 1;
                          const price = Number(item.price ?? 0) || 0;
                          return (
                            <div key={index} className="flex items-center justify-between gap-3 py-2 text-sm">
                              <div>
                                <div className="font-semibold">{text(item.name) || "Item"}</div>
                                <div className="text-xs text-slate-500">Qty {qty} x {money(price)}</div>
                              </div>
                              <div className="font-semibold">{money(qty * price)}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={isSaving || currentStatus === "completed" || currentStatus === "cancelled"}
                      onClick={() => updateStatus(order, "preparing")}
                      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Preparing
                    </button>
                    <button
                      type="button"
                      disabled={isSaving || currentStatus === "completed" || currentStatus === "cancelled"}
                      onClick={() => updateStatus(order, "pickup_ready")}
                      className="rounded-xl border border-blue-300 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Ready for pickup
                    </button>
                    <button
                      type="button"
                      disabled={isSaving || currentStatus === "completed" || currentStatus === "cancelled"}
                      onClick={() => updateStatus(order, "completed")}
                      className="rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Complete
                    </button>
                    <button
                      type="button"
                      disabled={isSaving || currentStatus === "completed" || currentStatus === "cancelled"}
                      onClick={() => updateStatus(order, "cancelled")}
                      className="rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Cancel
                    </button>
                    {isSaving ? <span className="self-center text-sm text-slate-500">Saving...</span> : null}
                  </div>
                </article>
              );
            })
          )}
        </section>
      </div>
    </main>
  );
}
