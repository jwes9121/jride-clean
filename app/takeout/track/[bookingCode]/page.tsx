"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

type TakeoutOrder = {
  id?: string | null;
  booking_code?: string | null;
  code?: string | null;
  customer_name?: string | null;
  customer_status?: string | null;
  vendor_status?: string | null;
  takeout_pricing_status?: string | null;
  takeout_delivery_fee?: number | string | null;
  takeout_service_fee?: number | string | null;
  takeout_total_payable?: number | string | null;
  takeout_cash_collection_required?: boolean | null;
  takeout_fee_expires_at?: string | null;
  total_bill?: number | string | null;
  takeout_items_subtotal?: number | string | null;
  created_at?: string | null;
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function money(n: number) {
  const v = Number(n || 0);
  return "PHP " + v.toFixed(2);
}

function secondsUntil(value: any): number | null {
  const raw = normText(value);
  if (!raw) return null;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.ceil((t - Date.now()) / 1000));
}

async function getJson(url: string) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || (j && j.ok === false)) {
    throw new Error(j?.message || j?.error || "HTTP " + res.status);
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
    throw new Error(j?.message || j?.error || "HTTP " + res.status);
  }
  return j;
}

function normalizeTakeoutOrders(j: any): TakeoutOrder[] {
  if (Array.isArray(j)) return j as TakeoutOrder[];
  if (j?.order && typeof j.order === "object") return [j.order as TakeoutOrder];
  if (j?.data && !Array.isArray(j.data) && typeof j.data === "object") return [j.data as TakeoutOrder];
  if (Array.isArray(j?.orders)) return j.orders as TakeoutOrder[];
  if (Array.isArray(j?.data)) return j.data as TakeoutOrder[];
  if (Array.isArray(j?.bookings)) return j.bookings as TakeoutOrder[];
  return [];
}

function looksLikeUuid(v: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default function TakeoutTrackPage() {
  const params = useParams<{ bookingCode?: string }>();
  const trackingKey = useMemo(() => decodeURIComponent(normText(params?.bookingCode)), [params?.bookingCode]);

  const [order, setOrder] = useState<TakeoutOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [nowTick, setNowTick] = useState(0);

  async function refreshOrder() {
    if (!trackingKey) return;
    setBusy(true);
    setErr(null);
    try {
      const qs = looksLikeUuid(trackingKey)
        ? "order_id=" + encodeURIComponent(trackingKey)
        : "booking_code=" + encodeURIComponent(trackingKey);
      const j = await getJson("/api/takeout/orders?" + qs);
      const rows = normalizeTakeoutOrders(j);
      const found = rows.find((r) => {
        const id = normText(r.id);
        const code = normText(r.booking_code || r.code);
        return id === trackingKey || code === trackingKey;
      }) || rows[0] || null;
      if (found) setOrder(found);
      if (!found) setErr("Takeout order not found yet. Refresh in a few seconds.");
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to refresh takeout order."));
    } finally {
      setBusy(false);
    }
  }

  async function confirmTakeoutFee() {
    if (!order) return;
    const orderId = normText(order.id);
    const bookingCode = normText(order.booking_code || order.code);
    if (!orderId && !bookingCode) {
      setErr("Missing takeout order id.");
      return;
    }
    setConfirmBusy(true);
    setErr(null);
    try {
      const j = await postJson("/api/takeout/confirm-fee", {
        order_id: orderId || undefined,
        booking_code: bookingCode || undefined,
        confirm: true,
      });
      const next = (j?.order || j?.data || j?.proposal || null) as TakeoutOrder | null;
      if (next) setOrder(next);
      await refreshOrder();
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to confirm takeout total."));
    } finally {
      setConfirmBusy(false);
    }
  }

  useEffect(() => {
    refreshOrder().catch(() => undefined);
    const t = window.setInterval(() => refreshOrder().catch(() => undefined), 5000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackingKey]);

  useEffect(() => {
    const t = window.setInterval(() => setNowTick((v) => v + 1), 1000);
    return () => window.clearInterval(t);
  }, []);

  const state = useMemo(() => {
    const pricingStatus = normText(order?.takeout_pricing_status || "pricing_pending").toLowerCase();
    const vendorStatus = normText(order?.vendor_status || "").toLowerCase();
    const customerStatus = normText(order?.customer_status || "").toLowerCase();
    const progressStatus = customerStatus || vendorStatus;
    const vendorHasAccepted = ["vendor_accepted", "driver_assigned", "preparing", "pickup_ready", "completed"].includes(vendorStatus);
    const passengerConfirmed = pricingStatus.includes("customer_confirmed") || pricingStatus.includes("confirmed") || customerStatus.includes("confirmed");
    const progressLabels: Record<string, string> = {
      requested: "Order submitted",
      vendor_pending: "Waiting for vendor confirmation",
      vendor_accepted: "Vendor accepted. Looking for driver",
      preparing: "Vendor preparing order",
      pickup_ready: "Order ready for pickup",
      driver_assigned: passengerConfirmed ? "Passenger confirmed total" : "Driver assigned",
      driver_fee_proposed: "Driver fee proposed",
      customer_confirmed: "Passenger confirmed total",
      rider_arrived_vendor: "Driver arrived at vendor",
      arrived_vendor: "Driver arrived at vendor",
      picked_up: "Order picked up",
      delivering: "Driver delivering order",
      completed: "Order completed",
      cancelled: "Order cancelled",
    };
    const progressLabel = progressLabels[progressStatus] || (progressStatus ? progressStatus.replace(/_/g, " ") : "Waiting for update");
    const isCompleted = progressStatus === "completed";
    const isCancelled = progressStatus === "cancelled";
    const foodSubtotal = toNum(order?.takeout_items_subtotal ?? order?.total_bill);
    const deliveryFee = toNum(order?.takeout_delivery_fee);
    const serviceFee = toNum(order?.takeout_service_fee || 15);
    const totalPayable = toNum(order?.takeout_total_payable);
    const expiresIn = secondsUntil(order?.takeout_fee_expires_at);
    const readyToConfirm = !isCompleted && !isCancelled && pricingStatus === "driver_fee_proposed" && totalPayable > 0 && (expiresIn === null || expiresIn > 0);

    return {
      pricingStatus,
      vendorStatus,
      customerStatus,
      progressStatus,
      progressLabel,
      vendorHasAccepted,
      passengerConfirmed,
      isCompleted,
      isCancelled,
      foodSubtotal,
      deliveryFee,
      serviceFee,
      totalPayable,
      expiresIn,
      readyToConfirm,
    };
    // nowTick keeps expiry text fresh without changing backend state.
  }, [order, nowTick]);

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-2xl font-bold">Takeout tracking</div>
          <div className="mt-1 text-sm text-slate-600">Track pricing, vendor status, driver progress, and completion for this order.</div>
          <div className="mt-1 text-xs text-slate-500">Order: <span className="font-mono">{trackingKey || "--"}</span></div>
        </div>

      </div>

      <div className="mt-4 rounded-lg border bg-white p-4 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-semibold text-slate-900">Takeout pricing and progress</div>
            <div className="mt-1 text-xs text-slate-600">
              {state.isCompleted ? "This order is completed." : state.isCancelled ? "This order was cancelled." : "This page refreshes automatically."}
            </div>
          </div>
          <button
            type="button"
            onClick={() => refreshOrder().catch(() => undefined)}
            disabled={busy}
            className="rounded border px-3 py-1 text-xs hover:bg-slate-50 disabled:opacity-60"
          >
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        {err ? (
          <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-700">{err}</div>
        ) : null}

        {!order ? (
          <div className="mt-3 rounded border bg-slate-50 p-3 text-xs text-slate-700">Loading takeout order...</div>
        ) : (
          <div className="mt-3 space-y-2">
            <div className="rounded border bg-slate-50 p-3">
              <div className="flex justify-between gap-3">
                <span className="text-slate-600">Pricing status</span>
                <span className="font-semibold">{state.pricingStatus.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-600">Order progress</span>
                <span className="font-semibold">{state.progressLabel}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-600">Food subtotal</span>
                <span>{money(state.foodSubtotal)}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-600">Driver delivery fee</span>
                <span>{state.deliveryFee > 0 ? money(state.deliveryFee) : "Waiting for driver"}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-600">JRide service fee</span>
                <span>{state.serviceFee > 0 ? money(state.serviceFee) : "--"}</span>
              </div>
              <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-base">
                <span className="font-semibold">Total payable</span>
                <span className="font-bold">{state.totalPayable > 0 ? money(state.totalPayable) : "Pending"}</span>
              </div>
              {order?.takeout_cash_collection_required === true ? (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Cash collection required before vendor pickup.</div>
              ) : null}
              {state.pricingStatus === "driver_fee_proposed" && !state.isCompleted && !state.isCancelled ? (
                <div className="mt-2 text-xs text-slate-600">Proposal expires in: <span className="font-semibold">{state.expiresIn === null ? "--" : String(state.expiresIn) + " sec"}</span></div>
              ) : null}
            </div>

            {state.pricingStatus === "pricing_pending" ? (
              <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                {state.vendorHasAccepted ? "Vendor accepted. Looking for a nearby driver to propose the delivery fee." : "Waiting for vendor acceptance before driver fee proposal."}
              </div>
            ) : null}

            {state.passengerConfirmed && !state.isCompleted && !state.isCancelled ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                Passenger confirmed the total. The driver and vendor workflow can proceed.
              </div>
            ) : null}

            {state.pricingStatus === "expired" ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">The previous driver fee proposal expired. Please wait for another driver proposal.</div>
            ) : null}

            {!state.isCompleted && !state.isCancelled ? (
              <div className="rounded border border-slate-200 bg-white p-3 text-xs text-slate-700">
                <div className="font-semibold text-slate-900">Live takeout progress</div>
                <div className="mt-1">{state.progressLabel}</div>
                {state.vendorStatus ? <div className="mt-1 text-slate-500">Vendor status: {state.vendorStatus.replace(/_/g, " ")}</div> : null}
                {state.customerStatus ? <div className="mt-1 text-slate-500">Customer status: {state.customerStatus.replace(/_/g, " ")}</div> : null}
              </div>
            ) : null}

            {state.readyToConfirm ? (
              <button
                type="button"
                onClick={confirmTakeoutFee}
                disabled={confirmBusy}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
              >
                {confirmBusy ? "Confirming..." : "Confirm order total"}
              </button>
            ) : null}

            {state.isCompleted ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                <div className="font-semibold">Order completed.</div>
                <div className="mt-1">Thank you for using JRide Takeout.</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/takeout" className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Order again</a>
                  <a href="/takeout/orders" className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">View orders</a>
                </div>
              </div>
            ) : null}

            {state.isCancelled ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <div className="font-semibold">Order cancelled.</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/takeout" className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">Start new order</a>
                  <a href="/takeout/orders" className="rounded border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50">View orders</a>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
