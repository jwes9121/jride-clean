"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type OrderStatus = {
  order_code: string;
  status: string;
  producer_confirm_expires_at?: string | null;
  producer_accepted_at?: string | null;
  producer_rejected_at?: string | null;
  producer_timeout_at?: string | null;
  preparation_minutes: number;
  ready_at?: string | null;
  selected_vehicle_type?: string | null;
  preferred_vehicle_type?: string | null;
  product_subtotal: number;
  cash_collection_required: boolean;
  cash_collection_amount: number;
  customer_cash_collected_at?: string | null;
  customer_cash_collected_amount: number;
  delivery_fee: number;
  driver_to_first_pickup_km?: number | null;
  pickup_distance_fee: number;
  pickup_fee_locked: boolean;
  handling_fee: number;
  handling_reason?: string | null;
  handling_fee_locked: boolean;
  total_payable: number;
  cash_due_now: number;
  final_cash_due: number;
  picked_up_at?: string | null;
  delivering_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  items: Array<{
    product_name: string;
    selling_unit: string;
    unit_price: number;
    quantity: number;
    line_total: number;
    condition_required?: string | null;
  }>;
};

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (typeof window === "undefined") return headers;
  const token =
    window.localStorage.getItem("jride_passenger_token") ||
    window.localStorage.getItem("jride_access_token") ||
    window.sessionStorage.getItem("jride_passenger_token") ||
    window.sessionStorage.getItem("jride_access_token") ||
    "";
  const deviceId =
    window.localStorage.getItem("jride_native_device_id") ||
    window.sessionStorage.getItem("jride_native_device_id") ||
    "";
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  if (deviceId.trim()) headers["x-device-id"] = deviceId.trim();
  return headers;
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function progressLabel(order: OrderStatus): string {
  if (order.completed_at || order.status === "completed") return "Order completed";
  if (order.delivered_at || order.status === "delivered") return "Delivered";
  if (order.delivering_at || order.status === "delivering") return "Driver is delivering your order";
  if (order.picked_up_at || order.status === "picked_up") return "Items verified and picked up";
  if (order.status === "driver_assigned") {
    return order.cash_collection_required && !order.customer_cash_collected_at
      ? "Driver assigned - prepare product cash"
      : "Driver assigned";
  }
  if (["dispatching", "ready_for_dispatch"].includes(order.status)) return "Finding an eligible driver";
  if (["producer_accepted", "preparing"].includes(order.status)) return "Farmer is preparing your order";
  if (order.status === "awaiting_producer") return "Waiting for farmer confirmation";
  return titleCase(order.status);
}

export default function AgrimarketOrderTrackingPage() {
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = new URLSearchParams(window.location.search).get("code") || "";
    if (value.trim()) {
      setCode(value.trim());
      void loadOrder(value.trim());
    }
  }, []);

  useEffect(() => {
    if (!order || disabled) return;
    if (["completed", "cancelled", "rejected", "expired"].includes(String(order.status).toLowerCase())) return;
    const timer = window.setInterval(() => void loadOrder(order.order_code, true), 10000);
    return () => window.clearInterval(timer);
  }, [order?.order_code, order?.status, disabled]);

  async function loadOrder(orderCode = code, quiet = false) {
    const clean = orderCode.trim();
    if (!clean) return;
    if (!quiet) setLoading(true);
    setError("");
    const params = new URLSearchParams({ order_code: clean });
    const response = await fetch(`/api/agrimarket/order-status?${params.toString()}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    const payload = await response.json().catch(() => ({}));

    if (payload?.error === "AGRIMARKET_DISABLED") {
      setDisabled(true);
      setOrder(null);
    } else if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load this Agrimarket order.");
      if (!quiet) setOrder(null);
    } else {
      setOrder(payload.order as OrderStatus);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", `/agrimarket/order?code=${encodeURIComponent(clean)}`);
      }
    }
    if (!quiet) setLoading(false);
  }

  if (disabled) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-3xl border bg-white p-8 shadow-sm">
          <h1 className="text-2xl font-bold">Agrimarket is still in pre-launch</h1>
          <p className="mt-3 text-slate-600">Order tracking will become available when Agrimarket is enabled.</p>
          <Link href="/agrimarket" className="mt-5 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Back to Agrimarket</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
            <h1 className="text-3xl font-bold">Track order</h1>
          </div>
          <Link href="/agrimarket" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Marketplace</Link>
        </div>

        <div className="mt-5 rounded-2xl border bg-white p-4 shadow-sm">
          <label className="text-sm font-semibold">
            Order code
            <div className="mt-2 flex flex-col gap-2 sm:flex-row">
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="AG-..." className="min-w-0 flex-1 rounded-xl border px-3 py-3" />
              <button type="button" onClick={() => loadOrder()} disabled={loading || !code.trim()} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">
                {loading ? "Loading..." : "Track"}
              </button>
            </div>
          </label>
        </div>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

        {order ? (
          <section className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{order.order_code}</p>
            <h2 className="mt-1 text-2xl font-bold">{progressLabel(order)}</h2>
            <p className="mt-1 text-sm text-slate-500">Status: {titleCase(order.status)}</p>

            {order.cash_due_now > 0 ? (
              <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-blue-950">
                <p className="text-sm font-semibold">Cash due now</p>
                <p className="mt-1 text-2xl font-bold">{money(order.cash_due_now)}</p>
                <p className="mt-1 text-xs">Pay only to the assigned JRide driver as instructed by the order flow.</p>
              </div>
            ) : null}

            <div className="mt-5 overflow-hidden rounded-xl border">
              {order.items.map((item, index) => (
                <div key={`${order.order_code}-${index}`} className="flex flex-wrap justify-between gap-2 border-b px-4 py-3 last:border-b-0">
                  <div>
                    <p className="font-semibold">{item.product_name}</p>
                    <p className="text-xs text-slate-500">{item.quantity} {item.selling_unit} x {money(item.unit_price)}</p>
                  </div>
                  <strong>{money(item.line_total)}</strong>
                </div>
              ))}
            </div>

            <div className="mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><span>Products</span><strong>{money(order.product_subtotal)}</strong></div>
              <div className="flex justify-between"><span>Delivery</span><strong>{money(order.delivery_fee)}</strong></div>
              <div className="flex justify-between"><span>Driver pickup surcharge</span><strong>{order.pickup_fee_locked ? money(order.pickup_distance_fee) : "Pending assignment"}</strong></div>
              <div className="flex justify-between"><span>Handling</span><strong>{order.handling_fee_locked ? money(order.handling_fee) : "PHP 0 to PHP 50 if needed"}</strong></div>
              <div className="flex justify-between border-t pt-2 text-base"><span>Total</span><strong>{money(order.total_payable)}</strong></div>
            </div>

            {order.cash_collection_required ? (
              <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                Product cash-first order: {money(order.cash_collection_amount)} is collected before the farmer pickup. Any remaining delivery, pickup, or handling amount is settled at final delivery.
              </div>
            ) : null}

            <div className="mt-5 grid gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Preparation</span><p className="font-semibold">{order.preparation_minutes} min</p></div>
              <div className="rounded-xl bg-slate-50 p-3"><span className="text-slate-500">Vehicle</span><p className="font-semibold">{titleCase(order.selected_vehicle_type || order.preferred_vehicle_type || "pending")}</p></div>
            </div>

            <p className="mt-5 text-xs text-slate-500">The farmer name, personal contact details, and exact farm pickup location are protected by JRide and are not shown here.</p>
          </section>
        ) : null}
      </div>
    </main>
  );
}
