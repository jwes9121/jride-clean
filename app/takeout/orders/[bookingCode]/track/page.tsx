"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type FareBreakdown = {
  items_total?: number | string | null;
  delivery_fee?: number | string | null;
  platform_fee?: number | string | null;
  other_fees?: number | string | null;
  grand_total?: number | string | null;
};

type Order = {
  booking_code?: string | null;
  status?: string | null;
  customer_status?: string | null;
  vendor_status?: string | null;
  vendor_name?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  pickup_lat?: number | string | null;
  pickup_lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
  created_at?: string | null;
  updated_at?: string | null;
  takeout_items_subtotal?: number | string | null;
  items_total?: number | string | null;
  delivery_fee?: number | string | null;
  platform_fee?: number | string | null;
  other_fees?: number | string | null;
  grand_total?: number | string | null;
  fare_breakdown?: FareBreakdown | null;
  [key: string]: any;
};

type PageProps = { params: { bookingCode: string } };
type StepKey = "requested" | "accepted" | "preparing" | "pickup_ready" | "on_the_way" | "completed";

const STEPS: { key: StepKey; label: string; detail: string }[] = [
  { key: "requested", label: "Requested", detail: "Order sent to vendor" },
  { key: "accepted", label: "Accepted", detail: "Vendor acknowledged" },
  { key: "preparing", label: "Preparing", detail: "Food is being prepared" },
  { key: "pickup_ready", label: "Pickup ready", detail: "Ready for pickup" },
  { key: "on_the_way", label: "On the way", detail: "Rider is delivering" },
  { key: "completed", label: "Completed", detail: "Order delivered" },
];

function text(value: any): string {
  return String(value ?? "").trim();
}

function num(value: any): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function money(value: any): string {
  return "PHP " + num(value).toFixed(2);
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function normalizeStatus(order: Order | null): StepKey | "cancelled" {
  if (!order) return "requested";
  const raw = text(order.customer_status || order.vendor_status || order.status).toLowerCase();
  if (["cancelled", "canceled", "cancelled_by_vendor", "cancelled_by_customer"].includes(raw)) return "cancelled";
  if (["completed", "done", "delivered"].includes(raw)) return "completed";
  if (["on_the_way", "on_the_way_to_customer", "picked_up", "order_picked_up", "on_trip"].includes(raw)) return "on_the_way";
  if (["pickup_ready", "ready", "prepared", "ready_for_pickup", "driver_arrived"].includes(raw)) return "pickup_ready";
  if (["preparing", "preparing_order"].includes(raw)) return "preparing";
  if (["accepted", "order_accepted", "assigned", "acknowledged"].includes(raw)) return "accepted";
  return "requested";
}

function statusLabel(status: StepKey | "cancelled") {
  if (status === "cancelled") return "Cancelled";
  return STEPS.find((s) => s.key === status)?.label || "Requested";
}

function makeBreakdown(order: Order | null) {
  const fb = order?.fare_breakdown || {};
  const itemsTotal = num(order?.items_total ?? order?.takeout_items_subtotal ?? fb.items_total);
  const deliveryFee = num(order?.delivery_fee ?? fb.delivery_fee);
  const platformFee = num(order?.platform_fee ?? fb.platform_fee);
  const otherFees = num(order?.other_fees ?? fb.other_fees);
  const rawGrandTotal = num(order?.grand_total ?? fb.grand_total);
  const grandTotal = rawGrandTotal > 0 ? rawGrandTotal : itemsTotal + deliveryFee + otherFees;
  return { itemsTotal, deliveryFee, platformFee, otherFees, grandTotal };
}

function cssJoin(parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function TakeoutTrackPage({ params }: PageProps) {
  const bookingCode = decodeURIComponent(params.bookingCode);
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const currentStatus = useMemo(() => normalizeStatus(order), [order]);
  const totals = useMemo(() => makeBreakdown(order), [order]);

  const currentStepIndex = useMemo(() => {
    if (currentStatus === "cancelled") return -1;
    const idx = STEPS.findIndex((s) => s.key === currentStatus);
    return idx >= 0 ? idx : 0;
  }, [currentStatus]);

  async function load(showSpinner = false) {
    try {
      if (showSpinner) setLoading(true);
      setError(null);
      const res = await fetch("/api/orders/" + encodeURIComponent(bookingCode), { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || data?.message || "Failed to load order: " + res.status);
      const nextOrder: Order = (data.booking ?? data.order ?? data) as Order;
      setOrder(nextOrder);
      setLastLoadedAt(new Date().toLocaleTimeString());
    } catch (err: any) {
      setError(err?.message || "Error loading order.");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    load(true);
    const timer = setInterval(() => load(false), 15000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCode]);

  const staticMapUrl = useMemo(() => {
    if (!mapboxToken || !order) return null;
    const pickupLat = num(order.pickup_lat);
    const pickupLng = num(order.pickup_lng);
    const dropLat = num(order.dropoff_lat);
    const dropLng = num(order.dropoff_lng);
    if (!pickupLat || !pickupLng || !dropLat || !dropLng) return null;
    const base = "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static";
    const pins = [
      "pin-s+1D4ED8(" + pickupLng + "," + pickupLat + ")",
      "pin-s+16A34A(" + dropLng + "," + dropLat + ")",
    ].join(",");
    return base + "/" + pins + "/auto/760x420?access_token=" + encodeURIComponent(mapboxToken);
  }, [order, mapboxToken]);

  function buildUrl(path: string) {
    if (typeof window === "undefined") return path;
    return window.location.origin + path;
  }

  async function copyTrackingLink() {
    try {
      const path = "/takeout/orders/" + encodeURIComponent(bookingCode) + "/track";
      if (navigator?.clipboard?.writeText) await navigator.clipboard.writeText(buildUrl(path));
      setCopyMessage("Tracking link copied.");
      setTimeout(() => setCopyMessage(null), 2500);
    } catch {
      setCopyMessage("Could not copy link on this device.");
      setTimeout(() => setCopyMessage(null), 2500);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto w-full max-w-3xl space-y-4">
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">JRide Takeout</p>
              <h1 className="mt-1 text-xl font-bold text-slate-950">Track your order</h1>
              <p className="mt-1 text-sm text-slate-600">Order code: <span className="font-semibold text-slate-950">{bookingCode}</span></p>
              <p className="mt-1 text-xs text-slate-500">Last update: {formatDateTime(order?.updated_at || order?.created_at)}{lastLoadedAt ? " | refreshed " + lastLoadedAt : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => load(true)} className="rounded-full border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Refresh</button>
              <button type="button" onClick={copyTrackingLink} className="rounded-full border px-3 py-2 text-xs font-semibold hover:bg-slate-50">Copy link</button>
              <button type="button" onClick={() => router.push("/takeout/orders/" + encodeURIComponent(bookingCode) + "/receipt")} className="rounded-full bg-slate-950 px-3 py-2 text-xs font-semibold text-white">Receipt</button>
            </div>
          </div>
          {copyMessage ? <p className="mt-3 text-xs text-slate-600">{copyMessage}</p> : null}
          {error ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p> : null}
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current status</p>
              <p className={cssJoin(["mt-1 text-2xl font-bold", currentStatus === "cancelled" ? "text-rose-700" : currentStatus === "completed" ? "text-emerald-700" : "text-slate-950"])}>{statusLabel(currentStatus)}</p>
            </div>
            <div className="rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">Vendor: <span className="font-semibold">{text(order?.vendor_name) || "Vendor"}</span></div>
          </div>

          <div className="mt-5 space-y-3">
            {STEPS.map((step, index) => {
              const done = currentStatus !== "cancelled" && index <= currentStepIndex;
              const active = currentStatus !== "cancelled" && index === currentStepIndex;
              return (
                <div key={step.key} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cssJoin(["flex h-8 w-8 items-center justify-center rounded-full border text-xs font-bold", done ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-500", active ? "ring-4 ring-emerald-100" : ""])}>{index + 1}</div>
                    {index < STEPS.length - 1 ? <div className={cssJoin(["h-8 w-px", done ? "bg-emerald-300" : "bg-slate-200"])} /> : null}
                  </div>
                  <div className="pb-3">
                    <p className={cssJoin(["text-sm font-semibold", done ? "text-slate-950" : "text-slate-500"])}>{step.label}</p>
                    <p className="text-xs text-slate-500">{step.detail}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {currentStatus === "cancelled" ? <p className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">This order was cancelled.</p> : null}
          {loading ? <p className="mt-3 text-xs text-slate-500">Loading latest order status...</p> : null}
        </section>

        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Route overview</p>
            <div className="mt-3 overflow-hidden rounded-xl border bg-slate-50">
              {staticMapUrl ? <img src={staticMapUrl} alt="Takeout pickup and dropoff map" className="w-full" /> : <div className="flex min-h-[220px] items-center justify-center px-4 text-center text-sm text-slate-500">Map unavailable. Pickup/dropoff coordinates or Mapbox token may be missing.</div>}
            </div>
            <div className="mt-3 space-y-1 text-xs text-slate-600">
              <p><span className="font-semibold">From:</span> {text(order?.from_label) || "Vendor pickup"}</p>
              <p><span className="font-semibold">To:</span> {text(order?.to_label) || "Customer dropoff"}</p>
            </div>
          </div>

          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order total</p>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-600">Items total</span><span className="font-semibold">{money(totals.itemsTotal)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Delivery fee</span><span className="font-semibold">{money(totals.deliveryFee)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Platform fee</span><span className="font-semibold">{money(totals.platformFee)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Other fees</span><span className="font-semibold">{money(totals.otherFees)}</span></div>
              <div className="mt-3 border-t pt-3 flex justify-between text-base"><span className="font-bold">Total paid</span><span className="font-bold text-emerald-700">{money(totals.grandTotal)}</span></div>
            </div>
            <p className="mt-4 text-xs text-slate-500">This tracking page reads the existing takeout order API only. It does not call ride dispatch, fare proposal, or trip lifecycle routes.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
