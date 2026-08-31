"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type OrderItem = {
  product_id: string;
  product_name: string;
  selling_unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  condition_required?: string | null;
};

type HarvestProposal = {
  proposal_type: string;
  proposed_items: any[];
  proposed_harvest_start_at?: string | null;
  proposed_harvest_end_at?: string | null;
  producer_reason?: string | null;
};

type ProducerOrder = {
  order_code: string;
  status: string;
  fulfillment_mode: string;
  harvest_expected_start_at?: string | null;
  harvest_expected_end_at?: string | null;
  harvest_ready_at?: string | null;
  pending_harvest_proposal?: HarvestProposal | null;
  confirmation_seconds_remaining: number;
  preparation_minutes?: number | null;
  ready_at?: string | null;
  preferred_vehicle_type: string;
  required_vehicle_type: string;
  estimated_cargo_weight_kg?: number | null;
  confirmed_cargo_weight_kg?: number | null;
  confirmed_handling_tier?: string | null;
  minimum_handling_tier: string;
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
const HANDLING_TIERS = ["standard", "bulky", "live_single", "live_difficult"] as const;

function allowedHandlingTiers(minimum: string): string[] {
  const index = Math.max(0, HANDLING_TIERS.indexOf(minimum as (typeof HANDLING_TIERS)[number]));
  return HANDLING_TIERS.slice(index);
}

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
  const n = Number(value || 0);
  return `PHP ${Number.isFinite(n) ? n.toFixed(2) : "0.00"}`;
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" })
    : "-";
}

function toIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AgrimarketProducerPage() {
  const [accessCode, setAccessCode] = useState("");
  const [pin, setPin] = useState("");
  const [connected, setConnected] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [orders, setOrders] = useState<ProducerOrder[]>([]);
  const [prep, setPrep] = useState<Record<string, number>>({});
  const [cargoWeight, setCargoWeight] = useState<Record<string, string>>({});
  const [handlingTier, setHandlingTier] = useState<Record<string, string>>({});
  const [reason, setReason] = useState<Record<string, string>>({});
  const [delayStart, setDelayStart] = useState<Record<string, string>>({});
  const [delayEnd, setDelayEnd] = useState<Record<string, string>>({});
  const [shortfall, setShortfall] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const savedCode = window.sessionStorage.getItem(SESSION_ACCESS_CODE) || "";
    const savedPin = window.sessionStorage.getItem(SESSION_PIN) || "";
    setAccessCode(savedCode);
    setPin(savedPin);
    if (savedCode && savedPin) void loadOrders(savedCode, savedPin);
  }, []);

  useEffect(() => {
    if (!connected || disabled) return;
    const timer = window.setInterval(() => void loadOrders(accessCode, pin, true), 10000);
    return () => window.clearInterval(timer);
  }, [connected, disabled, accessCode, pin]);

  async function loadOrders(code = accessCode, accessPin = pin, quiet = false) {
    if (!code.trim() || !accessPin.trim()) return;
    if (!quiet) setLoading(true);
    setError("");
    const response = await fetch("/api/agrimarket/producer/orders", { cache: "no-store", headers: farmerHeaders(code, accessPin) });
    const payload = await response.json().catch(() => ({}));
    if (payload?.error === "AGRIMARKET_DISABLED") {
      setDisabled(true);
      setConnected(false);
    } else if (response.status === 401 || response.status === 403) {
      setConnected(false);
      setError(payload?.message || "Farmer credentials were not accepted.");
    } else if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load farmer orders.");
    } else {
      const rows: ProducerOrder[] = Array.isArray(payload?.orders) ? payload.orders : [];
      setOrders(rows);
      setConnected(true);
      setPrep((current) => {
        const next = { ...current };
        rows.forEach((order) => { if (next[order.order_code] == null) next[order.order_code] = order.preparation_minutes ?? 15; });
        return next;
      });
      setCargoWeight((current) => {
        const next = { ...current };
        rows.forEach((order) => {
          if (next[order.order_code] == null) {
            const initial = order.confirmed_cargo_weight_kg ?? order.estimated_cargo_weight_kg;
            next[order.order_code] = initial == null ? "" : String(initial);
          }
        });
        return next;
      });
      setHandlingTier((current) => {
        const next = { ...current };
        rows.forEach((order) => {
          if (next[order.order_code] == null) {
            next[order.order_code] = order.confirmed_handling_tier || order.minimum_handling_tier || "standard";
          }
        });
        return next;
      });
      setShortfall((current) => {
        const next = { ...current };
        rows.forEach((order) => {
          if (!next[order.order_code]) next[order.order_code] = Object.fromEntries(order.items.map((item) => [item.product_id, String(item.quantity)]));
        });
        return next;
      });
      window.sessionStorage.setItem(SESSION_ACCESS_CODE, code.trim().toUpperCase());
      window.sessionStorage.setItem(SESSION_PIN, accessPin.trim());
    }
    if (!quiet) setLoading(false);
  }

  async function post(path: string, body: any, key: string) {
    setBusy(key);
    setError("");
    setMessage("");
    const response = await fetch(path, { method: "POST", headers: farmerHeaders(accessCode, pin, true), body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) setError(payload?.message || payload?.error || "Unable to update this order.");
    else {
      setMessage("Order updated.");
      await loadOrders(accessCode, pin, true);
    }
    setBusy("");
  }

  async function decide(order: ProducerOrder, decision: "accept" | "reject") {
    const scheduled = order.fulfillment_mode === "scheduled_harvest";
    await post("/api/agrimarket/producer/orders/decision", {
      order_code: order.order_code,
      decision,
      preparation_minutes: decision === "accept" && !scheduled ? prep[order.order_code] ?? 15 : null,
      confirmed_cargo_weight_kg:
        decision === "accept" && !scheduled ? Number(cargoWeight[order.order_code]) : null,
      confirmed_handling_tier:
        decision === "accept" && !scheduled
          ? handlingTier[order.order_code] || order.minimum_handling_tier || "standard"
          : null,
      reason: decision === "reject" ? reason[order.order_code] || null : null,
    }, `decision-${order.order_code}`);
  }

  async function harvestReady(order: ProducerOrder) {
    await post("/api/agrimarket/producer/orders/harvest", {
      order_code: order.order_code,
      action: "ready",
      preparation_minutes: prep[order.order_code] ?? 15,
      confirmed_cargo_weight_kg: Number(cargoWeight[order.order_code]),
      confirmed_handling_tier: handlingTier[order.order_code] || order.minimum_handling_tier || "standard",
    }, `ready-${order.order_code}`);
  }

  async function proposeDelay(order: ProducerOrder) {
    await post("/api/agrimarket/producer/orders/harvest", {
      order_code: order.order_code,
      action: "delay",
      proposed_harvest_start_at: toIso(delayStart[order.order_code] || ""),
      proposed_harvest_end_at: toIso(delayEnd[order.order_code] || ""),
      reason: reason[order.order_code] || null,
    }, `delay-${order.order_code}`);
  }

  async function proposeShortfall(order: ProducerOrder) {
    const draft = shortfall[order.order_code] || {};
    await post("/api/agrimarket/producer/orders/harvest", {
      order_code: order.order_code,
      action: "shortfall",
      items: order.items.map((item) => ({ product_id: item.product_id, quantity: Number(draft[item.product_id] ?? item.quantity) })),
      reason: reason[order.order_code] || null,
    }, `shortfall-${order.order_code}`);
  }

  if (disabled) {
    return <main className="min-h-screen bg-emerald-50 p-8"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8"><h1 className="text-2xl font-bold">Agrimarket farmer console is not enabled yet</h1></div></main>;
  }

  if (!connected) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-900">
        <div className="mx-auto max-w-md rounded-3xl border bg-white p-7 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p>
          <h1 className="mt-2 text-2xl font-bold">Farmer orders</h1>
          <p className="mt-2 text-sm text-slate-600">Use your Agrimarket Access Code and 6-digit PIN.</p>
          {error ? <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</div> : null}
          <input value={accessCode} onChange={(e) => setAccessCode(e.target.value.toUpperCase())} className="mt-5 w-full rounded-xl border px-3 py-3" placeholder="AGF-XXXXXXXX" />
          <input type="password" inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} className="mt-3 w-full rounded-xl border px-3 py-3" placeholder="6-digit PIN" />
          <button onClick={() => loadOrders()} disabled={loading || !accessCode.trim() || pin.length !== 6} className="mt-4 w-full rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">{loading ? "Checking..." : "Open farmer orders"}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-5 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-5xl">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket Farmer</p><h1 className="text-3xl font-bold">Orders</h1><p className="mt-1 text-sm text-slate-600">You receive 100% of the product subtotal during the free launch period.</p></div><div className="flex gap-2"><Link href="/agrimarket/producer/products" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Products</Link><button onClick={() => loadOrders()} className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Refresh</button></div></div>
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}
        {message ? <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">{message}</div> : null}

        <section className="mt-5 space-y-4">
          {!orders.length ? <div className="rounded-2xl border bg-white p-8 text-center text-slate-500">No active Agrimarket orders.</div> : null}
          {orders.map((order) => {
            const scheduled = order.fulfillment_mode === "scheduled_harvest";
            const pendingProposal = order.pending_harvest_proposal;
            return (
              <article key={order.order_code} className="rounded-3xl border bg-white p-5 shadow-sm">
                <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-emerald-700">{order.order_code}</p><h2 className="mt-1 text-xl font-bold">{scheduled ? "Scheduled Harvest" : "Agrimarket Order"}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{titleCase(order.status)}</span></div>
                {scheduled ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Expected harvest window</strong><br/>{formatDate(order.harvest_expected_start_at)}{order.harvest_expected_end_at ? ` to ${formatDate(order.harvest_expected_end_at)}` : ""}</div> : null}
                <div className="mt-4 divide-y rounded-xl border">{order.items.map((item) => <div key={item.product_id} className="flex justify-between gap-3 p-3"><div><strong>{item.product_name}</strong><p className="text-xs text-slate-500">{item.quantity} {item.selling_unit}</p></div><strong>{money(item.line_total)}</strong></div>)}</div>
                <div className="mt-3 flex justify-between"><span>Farmer product payment</span><strong>{money(order.product_subtotal)}</strong></div>

                {order.status === "awaiting_producer" ? (
                  <div className="mt-4 rounded-2xl bg-blue-50 p-4">
                    <p className="font-bold">Respond within {order.confirmation_seconds_remaining}s</p>
                    {scheduled ? (
                      <p className="mt-1 text-sm">Accept reserves the expected quantity. Actual cargo weight and handling are confirmed later, when the harvest is ready.</p>
                    ) : (
                      <>
                        <label className="mt-3 block text-sm font-semibold">Preparation time<select value={prep[order.order_code] ?? 15} onChange={(e) => setPrep((current) => ({ ...current, [order.order_code]: Number(e.target.value) }))} className="ml-2 rounded-lg border bg-white px-2 py-2">{PREP_OPTIONS.map((value) => <option key={value} value={value}>{value} min</option>)}</select></label>
                        <div className="mt-3 grid gap-3 rounded-xl border border-blue-200 bg-white p-3 md:grid-cols-2">
                          <p className="text-xs text-slate-600 md:col-span-2">Checkout estimated cargo weight: <strong>{order.estimated_cargo_weight_kg == null ? "Not available" : `${order.estimated_cargo_weight_kg} kg`}</strong></p>
                          <label className="text-sm font-semibold">Confirmed actual total weight (kg)<input type="number" min="0.001" step="0.001" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>
                          <label className="text-sm font-semibold">Handling classification<select value={handlingTier[order.order_code] || order.minimum_handling_tier || "standard"} onChange={(e) => setHandlingTier((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2">{allowedHandlingTiers(order.minimum_handling_tier).map((tier) => <option key={tier} value={tier}>{titleCase(tier)}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Minimum from the ordered cargo: {titleCase(order.minimum_handling_tier)}</span></label>
                        </div>
                      </>
                    )}
                    <div className="mt-3 flex gap-2"><button disabled={busy.includes(order.order_code) || (!scheduled && !(Number(cargoWeight[order.order_code]) > 0))} onClick={() => decide(order, "accept")} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:bg-slate-400">{scheduled ? "Accept harvest reservation" : "Accept"}</button><button disabled={busy.includes(order.order_code)} onClick={() => decide(order, "reject")} className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white">Cannot fulfill</button></div>
                  </div>
                ) : null}

                {scheduled && order.status === "awaiting_harvest" ? <div className="mt-4 rounded-2xl border p-4">
                  {pendingProposal ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Waiting for customer decision</strong><br/>{pendingProposal.proposal_type === "delay" ? `New proposed window: ${formatDate(pendingProposal.proposed_harvest_start_at)}${pendingProposal.proposed_harvest_end_at ? ` to ${formatDate(pendingProposal.proposed_harvest_end_at)}` : ""}` : "A lower harvest quantity has been proposed."}<br/>{pendingProposal.producer_reason || ""}</div> : <>
                    <h3 className="font-bold">Harvest update</h3>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-emerald-50 p-3"><p className="text-sm font-semibold">Harvest is ready</p><p className="mt-1 text-xs text-emerald-900">Checkout estimate: {order.estimated_cargo_weight_kg == null ? "Not available" : `${order.estimated_cargo_weight_kg} kg`}</p><select value={prep[order.order_code] ?? 15} onChange={(e) => setPrep((current) => ({ ...current, [order.order_code]: Number(e.target.value) }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2">{PREP_OPTIONS.map((value) => <option key={value} value={value}>{value} min prep</option>)}</select><input type="number" min="0.001" step="0.001" placeholder="Actual total weight (kg)" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2"/><select value={handlingTier[order.order_code] || order.minimum_handling_tier || "standard"} onChange={(e) => setHandlingTier((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2">{allowedHandlingTiers(order.minimum_handling_tier).map((tier) => <option key={tier} value={tier}>{titleCase(tier)}</option>)}</select><p className="mt-1 text-xs text-emerald-900">Minimum handling: {titleCase(order.minimum_handling_tier)}</p><button disabled={!(Number(cargoWeight[order.order_code]) > 0)} onClick={() => harvestReady(order)} className="mt-2 w-full rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white disabled:bg-slate-400">Mark ready</button></div>
                      <div className="rounded-xl bg-blue-50 p-3"><p className="text-sm font-semibold">Harvest delayed</p><input type="datetime-local" value={delayStart[order.order_code] || ""} onChange={(e) => setDelayStart((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border px-2 py-2"/><input type="datetime-local" value={delayEnd[order.order_code] || ""} onChange={(e) => setDelayEnd((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border px-2 py-2"/><button onClick={() => proposeDelay(order)} className="mt-2 w-full rounded-lg bg-blue-800 px-3 py-2 font-bold text-white">Propose new date</button></div>
                      <div className="rounded-xl bg-amber-50 p-3"><p className="text-sm font-semibold">Quantity is short</p>{order.items.map((item) => <label key={item.product_id} className="mt-2 block text-xs">{item.product_name}<input type="number" min="0" max={item.quantity} step="0.01" value={shortfall[order.order_code]?.[item.product_id] ?? String(item.quantity)} onChange={(e) => setShortfall((current) => ({ ...current, [order.order_code]: { ...(current[order.order_code] || {}), [item.product_id]: e.target.value } }))} className="mt-1 w-full rounded-lg border px-2 py-2"/></label>)}<button onClick={() => proposeShortfall(order)} className="mt-2 w-full rounded-lg bg-amber-700 px-3 py-2 font-bold text-white">Propose lower quantity</button></div>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">Reason / note<textarea value={reason[order.order_code] || ""} onChange={(e) => setReason((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 min-h-16 w-full rounded-xl border px-3 py-2" /></label>
                  </>}
                </div> : null}

                {["preparing", "ready_for_dispatch", "dispatching", "driver_assigned", "picked_up", "delivering", "delivered", "completed"].includes(order.status) ? <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><strong>{order.status === "preparing" ? "Preparing for driver pickup" : titleCase(order.status)}</strong>{order.ready_at ? <><br/>Ready target: {formatDate(order.ready_at)}</> : null}{order.confirmed_cargo_weight_kg != null ? <><br/>Confirmed cargo: {order.confirmed_cargo_weight_kg} kg - {titleCase(order.confirmed_handling_tier || "")}</> : null}{order.producer_paid_at ? <><br/>Farmer paid: {money(order.producer_paid_amount)}</> : null}</div> : null}
              </article>
            );
          })}
        </section>
      </div>
    </main>
  );
}
