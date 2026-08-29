"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type OrderItem = {
  product_name: string;
  selling_unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  condition_required?: string | null;
};

type ProducerOrder = {
  order_code: string;
  status: string;
  confirmation_seconds_remaining: number;
  preparation_minutes: number;
  ready_at?: string | null;
  preferred_vehicle_type: string;
  required_vehicle_type: string;
  product_subtotal: number;
  producer_paid_at?: string | null;
  producer_paid_amount: number;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  items: OrderItem[];
};

const SESSION_ACCESS_CODE = "JRIDE_AGRIMARKET_ACCESS_CODE";
const SESSION_PIN = "JRIDE_AGRIMARKET_ACCESS_PIN";
const PREP_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];

function farmerHeaders(accessCode: string, pin: string, json = false): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "x-jride-agrimarket-code": accessCode.trim().toUpperCase(),
    "x-jride-agrimarket-pin": pin.trim(),
  };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function orderStep(order: ProducerOrder): string {
  if (order.completed_at || order.status === "completed") return "Completed";
  if (order.delivered_at || order.status === "delivered") return "Delivered to customer";
  if (order.picked_up_at || ["picked_up", "delivering"].includes(order.status)) return "Picked up by driver";
  if (order.producer_paid_at) return "Farmer paid - pickup verification pending";
  if (["driver_assigned", "dispatching", "ready_for_dispatch"].includes(order.status)) return "Driver assignment / pickup in progress";
  if (["producer_accepted", "preparing"].includes(order.status)) return "Preparing order";
  return "Waiting for your decision";
}

export default function AgrimarketProducerPage() {
  const [accessCode, setAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [connected, setConnected] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [orders, setOrders] = useState<ProducerOrder[]>([]);
  const [prepByOrder, setPrepByOrder] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [busyOrder, setBusyOrder] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedCode = window.sessionStorage.getItem(SESSION_ACCESS_CODE) || "";
    const savedPin = window.sessionStorage.getItem(SESSION_PIN) || "";
    setAccessCode(savedCode);
    setPin(savedPin);
    if (savedCode && savedPin) void loadOrders(savedCode, savedPin, true);
  }, []);

  async function loadOrders(code = accessCode, accessPin = pin, quiet = false) {
    if (!code.trim() || !accessPin.trim()) return;
    if (!quiet) setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/producer/orders", {
      cache: "no-store",
      headers: farmerHeaders(code, accessPin),
    });
    const payload = await response.json().catch(() => ({}));

    if (payload?.error === "AGRIMARKET_DISABLED") {
      setDisabled(true);
      setConnected(false);
    } else if (response.status === 401 || response.status === 403) {
      setConnected(false);
      setError(payload?.message || "The Agrimarket farmer credentials were not accepted.");
    } else if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load Agrimarket orders.");
    } else {
      const rows = Array.isArray(payload?.orders) ? payload.orders : [];
      setOrders(rows);
      setConnected(true);
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(SESSION_ACCESS_CODE, code.trim().toUpperCase());
        window.sessionStorage.setItem(SESSION_PIN, accessPin.trim());
      }
      setPrepByOrder((current) => {
        const next = { ...current };
        for (const order of rows as ProducerOrder[]) {
          if (next[order.order_code] == null) next[order.order_code] = PREP_OPTIONS.includes(Number(order.preparation_minutes)) ? Number(order.preparation_minutes) : 15;
        }
        return next;
      });
    }
    if (!quiet) setLoading(false);
  }

  useEffect(() => {
    if (!connected || disabled) return;
    const timer = window.setInterval(() => void loadOrders(accessCode, pin, true), 15000);
    return () => window.clearInterval(timer);
  }, [connected, disabled, accessCode, pin]);

  async function decide(orderCode: string, decision: "accept" | "reject") {
    setBusyOrder(orderCode);
    setError("");
    setMessage("");
    const response = await fetch("/api/agrimarket/producer/orders/decision", {
      method: "POST",
      headers: farmerHeaders(accessCode, pin, true),
      body: JSON.stringify({
        order_code: orderCode,
        decision,
        preparation_minutes: decision === "accept" ? prepByOrder[orderCode] ?? 15 : null,
        reason: decision === "reject" ? "farmer_cannot_fulfill" : null,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to update this order.");
    } else {
      setMessage(decision === "accept" ? "Order accepted. Prepare it within the selected time." : "Order declined and reserved inventory was released.");
      await loadOrders(accessCode, pin, true);
    }
    setBusyOrder("");
  }

  function signOut() {
    setConnected(false);
    setOrders([]);
    setPin("");
    setMessage("");
    setError("");
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SESSION_ACCESS_CODE);
      window.sessionStorage.removeItem(SESSION_PIN);
    }
  }

  if (disabled) {
    return (
      <main className="min-h-screen bg-emerald-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-2xl rounded-3xl border border-emerald-200 bg-white p-8 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket Farmer</p>
          <h1 className="mt-3 text-3xl font-bold">Farmer portal is being prepared</h1>
          <p className="mt-4 text-slate-600">Agrimarket remains disabled while the order and delivery workflow is being tested.</p>
          <Link href="/agrimarket/join" className="mt-6 inline-flex rounded-xl bg-emerald-700 px-5 py-3 font-semibold text-white">Farmer application</Link>
        </div>
      </main>
    );
  }

  if (!connected) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-2xl font-bold">Farmer sign in</h1>
          <p className="mt-2 text-sm text-slate-600">Use the Agrimarket access code and 6-digit PIN issued by JRide after approval. The PIN is kept only for this browser session.</p>
          {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <label className="mt-5 block text-sm font-semibold">Agrimarket Access Code<input value={accessCode} onChange={(event) => setAccessCode(event.target.value.toUpperCase())} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="AGF-XXXXXXXX" /></label>
          <label className="mt-4 block text-sm font-semibold">6-digit PIN<input inputMode="numeric" maxLength={6} type="password" value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-2 w-full rounded-xl border px-3 py-3" placeholder="000000" /></label>
          <button type="button" onClick={() => loadOrders()} disabled={loading || !accessCode.trim() || pin.length !== 6} className="mt-5 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">{loading ? "Checking..." : "Open farmer console"}</button>
          <Link href="/agrimarket/join" className="mt-4 block text-center text-sm font-semibold text-emerald-700">Apply to sell on Agrimarket</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket Farmer</p>
            <h1 className="text-3xl font-bold">Orders</h1>
            <p className="mt-1 text-sm text-slate-600">Selling on Agrimarket is free during launch. There is no farmer wallet and no marketplace deduction.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/agrimarket/producer/products" className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white">Manage products</Link>
            <button type="button" onClick={() => loadOrders()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button>
            <button type="button" onClick={signOut} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Sign out</button>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Joining fee</p><p className="mt-1 text-xl font-bold text-emerald-800">FREE</p></div>
          <div className="rounded-2xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Listing fee</p><p className="mt-1 text-xl font-bold text-emerald-800">FREE</p></div>
          <div className="rounded-2xl border bg-white p-4"><p className="text-xs uppercase text-slate-500">Marketplace deduction</p><p className="mt-1 text-xl font-bold text-emerald-800">0%</p></div>
        </div>

        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5 space-y-4">
          {orders.length === 0 ? <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">No active Agrimarket orders.</div> : null}
          {orders.map((order) => {
            const awaiting = order.status === "awaiting_producer";
            return (
              <article key={order.order_code} className="rounded-2xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{order.order_code}</p><h2 className="mt-1 text-xl font-bold">{orderStep(order)}</h2><p className="mt-1 text-sm text-slate-500">Status: {titleCase(order.status)}</p></div>
                  {awaiting ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900">Confirm within about {Math.ceil(order.confirmation_seconds_remaining / 60)} min</div> : null}
                </div>

                <div className="mt-4 overflow-hidden rounded-xl border">
                  {order.items.map((item, index) => (
                    <div key={`${order.order_code}-${index}`} className="flex flex-wrap justify-between gap-2 border-b px-4 py-3 last:border-b-0">
                      <div><p className="font-semibold">{item.product_name}</p><p className="text-xs text-slate-500">{item.quantity} {item.selling_unit} x {money(item.unit_price)}{item.condition_required ? ` - ${titleCase(item.condition_required)}` : ""}</p></div><strong>{money(item.line_total)}</strong>
                    </div>
                  ))}
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Product total</p><p className="font-bold">{money(order.product_subtotal)}</p></div>
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">JRide marketplace deduction</p><p className="font-bold text-emerald-900">PHP 0.00</p></div>
                  <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs text-emerald-700">Farmer receives</p><p className="font-bold text-emerald-900">{money(order.product_subtotal)}</p></div>
                </div>

                {order.producer_paid_at ? <div className="mt-3 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Driver payment recorded: {money(order.producer_paid_amount)}. Pickup verification follows before the goods leave the farm.</div> : null}

                {awaiting ? (
                  <div className="mt-4 rounded-xl border p-4">
                    <label className="text-sm font-semibold">Preparation time after acceptance<select value={prepByOrder[order.order_code] ?? 15} onChange={(event) => setPrepByOrder((current) => ({ ...current, [order.order_code]: Number(event.target.value) }))} className="mt-2 w-full rounded-xl border bg-white px-3 py-3 sm:max-w-xs">{PREP_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{minutes === 0 ? "Ready now" : `${minutes} minutes`}</option>)}</select></label>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button type="button" disabled={busyOrder === order.order_code} onClick={() => decide(order.order_code, "accept")} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white">Accept order</button>
                      <button type="button" disabled={busyOrder === order.order_code} onClick={() => decide(order.order_code, "reject")} className="rounded-xl bg-red-700 px-5 py-3 font-bold text-white">Cannot fulfill</button>
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
