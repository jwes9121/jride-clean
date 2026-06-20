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
  vendor_cancel_reason?: string | null;
  cancel_reason?: string | null;
  takeout_pricing_status?: string | null;
  takeout_delivery_fee?: number | string | null;
  takeout_service_fee?: number | string | null;
  takeout_total_payable?: number | string | null;
  takeout_cash_collection_required?: boolean | null;
  premium_packaging_fee?: number | string | null;
  order_preferences?: any;
  takeout_pricing_snapshot?: any;
  takeout_pickup_distance_km?: number | string | null;
  takeout_pickup_free_km?: number | string | null;
  takeout_pickup_billable_excess_km?: number | string | null;
  takeout_pickup_excess_fee?: number | string | null;
  takeout_fee_expires_at?: string | null;
  total_bill?: number | string | null;
  takeout_items_subtotal?: number | string | null;
  created_at?: string | null;
  vendor_accept_expires_at?: string | null;
  vendor_accept_expired?: boolean | null;
  assigned_driver_id?: string | null;
  driver_id?: string | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  driver_callsign?: string | null;
  driver_vehicle_type?: string | null;
  vehicle_type?: string | null;
  driver_status?: string | null;
  takeout_route_plan?: string | null;
  driver_lat?: number | string | null;
  driver_lng?: number | string | null;
  vendor_lat?: number | string | null;
  vendor_lng?: number | string | null;
  customer_lat?: number | string | null;
  customer_lng?: number | string | null;
  pickup_lat?: number | string | null;
  pickup_lng?: number | string | null;
  dropoff_lat?: number | string | null;
  dropoff_lng?: number | string | null;
};

function normText(v: any): string {
  return String(v ?? "").trim();
}

function formatPhilippineDateTime(v: unknown): string {
  const raw = normText(v);
  if (!raw) return "-";

  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return raw;

  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}
type TakeoutMapPoint = {
  lat: number;
  lng: number;
};

function takeoutMapNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function takeoutMapPoint(lat: any, lng: any): TakeoutMapPoint | null {
  const y = takeoutMapNum(lat);
  const x = takeoutMapNum(lng);
  if (y === null || x === null) return null;
  return { lat: y, lng: x };
}

function takeoutMapsDirectionsUrl(origin: TakeoutMapPoint, destination: TakeoutMapPoint): string {
  const params = new URLSearchParams({
    api: "1",
    origin: String(origin.lat) + "," + String(origin.lng),
    destination: String(destination.lat) + "," + String(destination.lng),
    travelmode: "driving",
  });
  return "https://maps.google.com/maps?saddr=" + encodeURIComponent(String(origin.lat) + "," + String(origin.lng)) + "&daddr=" + encodeURIComponent(String(destination.lat) + "," + String(destination.lng)) + "&dirflg=d";
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


function cancelReason(order: TakeoutOrder): string {
  return normText(order.vendor_cancel_reason || order.cancel_reason);
}

function isVendorAcceptTimeout(order: TakeoutOrder): boolean {
  const reason = cancelReason(order).toLowerCase();
  return Boolean(order.vendor_accept_expired) || reason.includes("did not respond within 5 minutes");
}

export default function TakeoutTrackPage() {
  const params = useParams<{ bookingCode?: string }>();
  const trackingKey = useMemo(() => decodeURIComponent(normText(params?.bookingCode)), [params?.bookingCode]);

  const [order, setOrder] = useState<TakeoutOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [ratingBusy, setRatingBusy] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [driverRating, setDriverRating] = useState(5);
  const [vendorRating, setVendorRating] = useState(5);
  const [driverComment, setDriverComment] = useState("");
  const [vendorComment, setVendorComment] = useState("");
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

  async function submitTakeoutRating() {
    if (!order) return;

    const orderId = normText(order.id);
    const bookingCode = normText(order.booking_code || order.code);

    if (!orderId && !bookingCode) {
      setErr("Missing takeout order id.");
      return;
    }

    if (driverRating < 1 || driverRating > 5 || vendorRating < 1 || vendorRating > 5) {
      setErr("Please rate both driver and store from 1 to 5 stars.");
      return;
    }

    setRatingBusy(true);
    setErr(null);

    try {
      await postJson("/api/takeout/rate", {
        order_id: orderId || undefined,
        booking_code: bookingCode || undefined,
        driver_rating: driverRating,
        driver_comment: driverComment,
        vendor_rating: vendorRating,
        vendor_comment: vendorComment,
      });
      setRatingSubmitted(true);
    } catch (e: any) {
      setErr(String(e?.message || e || "Failed to submit rating."));
    } finally {
      setRatingBusy(false);
    }
  }

  function StarButtons(props: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
    return (
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(n)}
            className={n <= props.value ? "text-2xl text-amber-500" : "text-2xl text-slate-300"}
            aria-label={"Rate " + n + " stars"}
          >
            ★
          </button>
        ))}
      </div>
    );
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
      vendor_timeout: "Vendor did not respond in time",
    };
    const progressLabel = progressLabels[progressStatus] || (progressStatus ? progressStatus.replace(/_/g, " ") : "Waiting for update");
    const isCompleted = progressStatus === "completed";
    const isCancelled = progressStatus === "cancelled" || progressStatus === "vendor_timeout";
    const foodSubtotal = toNum(order?.takeout_items_subtotal ?? order?.total_bill);
    const deliveryFee = toNum(order?.takeout_delivery_fee);
    const serviceFee = toNum(order?.takeout_service_fee || 15);
    const displayDeliveryFee = deliveryFee > 0 ? deliveryFee + serviceFee : 0;
    const totalPayable = toNum(order?.takeout_total_payable);
    const packagingSubtotal = Math.max(
      0,
      toNum(order?.premium_packaging_fee),
      toNum(order?.order_preferences?.premium_packaging_fee),
      toNum(order?.takeout_pricing_snapshot?.packaging_subtotal),
      toNum(order?.takeout_pricing_snapshot?.takeout_packaging_subtotal)
    );
    // JRIDE_TAKEOUT_PICKUP_EXCESS_DISPLAY_V3
    // Prefer explicit backend fields. If the current read API has not exposed them yet, infer the hidden line item from total - food - delivery - service.
    const explicitPickupExcessFee = toNum(order?.takeout_pickup_excess_fee);
    const inferredPickupExcessFee = Math.max(0, Number((totalPayable - foodSubtotal - packagingSubtotal - deliveryFee - serviceFee).toFixed(2)));
    const pickupExcessFee = explicitPickupExcessFee > 0 ? explicitPickupExcessFee : inferredPickupExcessFee;
    const pickupDistanceKm = toNum(order?.takeout_pickup_distance_km);
    const pickupFreeKm = toNum(order?.takeout_pickup_free_km || 1.5);
    const pickupBillableExcessKm = toNum(order?.takeout_pickup_billable_excess_km);
    const expiresIn = secondsUntil(order?.takeout_fee_expires_at);
    const readyToConfirm = !isCompleted && !isCancelled && pricingStatus === "driver_fee_proposed" && totalPayable > 0 && (expiresIn === null || expiresIn > 0);
    const assignedDriverId = normText(order?.assigned_driver_id || order?.driver_id);
    const driverName = normText(order?.driver_name || order?.driver_callsign);
    const driverPhone = normText(order?.driver_phone);
    const driverVehicleType = normText(order?.driver_vehicle_type || order?.vehicle_type);
    const hasDriverIdentity = Boolean(assignedDriverId || driverName || driverPhone || driverVehicleType);
        const driverStatus = normText(order?.driver_status || "").toLowerCase();
    const routePlan = normText(order?.takeout_route_plan || order?.takeout_pricing_snapshot?.takeout_route_plan || order?.takeout_pricing_snapshot?.route_plan || "").toLowerCase();
    const driverPoint = takeoutMapPoint(order?.driver_lat, order?.driver_lng);
    const vendorPoint = takeoutMapPoint(order?.vendor_lat ?? order?.pickup_lat, order?.vendor_lng ?? order?.pickup_lng);
    const customerPoint = takeoutMapPoint(order?.customer_lat ?? order?.dropoff_lat, order?.customer_lng ?? order?.dropoff_lng);
    const cashFirstRoute = order?.takeout_cash_collection_required === true || routePlan === "customer_cash_first";
    const alreadyPickedUp = ["picked_up", "delivering", "completed"].includes(progressStatus);
    const cashAlreadyCollected = ["cash_collected", "vendor_bound", "rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering", "completed"].some((s) =>
      [progressStatus, customerStatus, vendorStatus, driverStatus].includes(s)
    );
    const takeoutMapTarget = alreadyPickedUp
      ? customerPoint
      : cashFirstRoute && !cashAlreadyCollected
        ? customerPoint
        : vendorPoint;
    const takeoutMapTargetLabel = alreadyPickedUp
      ? "customer"
      : cashFirstRoute && !cashAlreadyCollected
        ? "customer"
        : "vendor";
    const takeoutMapUrl = driverPoint && takeoutMapTarget ? takeoutMapsDirectionsUrl(driverPoint, takeoutMapTarget) : "";

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
      displayDeliveryFee,
      serviceFee,
      packagingSubtotal,
      totalPayable,
      pickupExcessFee,
      pickupDistanceKm,
      pickupFreeKm,
      pickupBillableExcessKm,
      expiresIn,
      readyToConfirm,
      assignedDriverId,
      driverName,
      driverPhone,
      driverVehicleType,
      hasDriverIdentity,
            takeoutMapUrl,
      takeoutMapTargetLabel,
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
              {state.isCompleted ? "This order is completed." : state.isCancelled ? (order && isVendorAcceptTimeout(order) ? "The vendor did not respond in time." : "This order was cancelled.") : "This page refreshes automatically."}
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
            {state.hasDriverIdentity ? (
              <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <div className="font-semibold">Assigned driver</div>
                <div className="mt-2 space-y-1 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-emerald-700">Name</span>
                    <span className="font-semibold text-emerald-950">{state.driverName || state.assignedDriverId || "Assigned"}</span>
                  </div>
                  {state.driverPhone ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-emerald-700">Phone</span>
                      <a className="font-semibold text-emerald-950 underline" href={"tel:" + state.driverPhone}>{state.driverPhone}</a>
                    </div>
                  ) : null}
                  {state.driverVehicleType ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-emerald-700">Vehicle</span>
                      <span className="font-semibold text-emerald-950">{state.driverVehicleType}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}

            <div className="rounded border border-slate-300 bg-white p-3 text-slate-900">
              <div className="flex justify-between gap-3">
                <span className="text-slate-800">Pricing status</span>
                <span className="font-semibold">{state.pricingStatus.replace(/_/g, " ")}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-800">Order progress</span>
                <span className="font-semibold">{state.progressLabel}</span>
              </div>
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-800">Food subtotal</span>
                <span>{money(state.foodSubtotal)}</span>
              </div>
              {state.packagingSubtotal > 0 ? (
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-slate-800">Premium packaging</span>
                  <span>{money(state.packagingSubtotal)}</span>
                </div>
              ) : null}
              <div className="mt-1 flex justify-between gap-3">
                <span className="text-slate-800">Delivery fee</span>
                <span className="font-bold text-slate-950">{order && isVendorAcceptTimeout(order) ? "Not applicable" : state.displayDeliveryFee > 0 ? money(state.displayDeliveryFee) : "Waiting for delivery quote"}</span>
              </div>
                            {state.pickupExcessFee > 0 ? (
                <div className="mt-1 flex justify-between gap-3">
                  <span className="text-slate-800">Pickup distance fee</span>
                  <span>{money(state.pickupExcessFee)}</span>
                </div>
              ) : null}
              {state.pickupExcessFee > 0 ? (
                <details className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs text-slate-700">
                  <summary className="cursor-pointer font-semibold text-slate-800">
                    Show pickup distance fee breakdown
                  </summary>

                  <div className="mt-2 space-y-1">
                    <div className="flex justify-between gap-3">
                      <span className="text-slate-800">
                        Nearest available driver road distance
                      </span>
                      <span>
                        {state.pickupDistanceKm > 0
                          ? state.pickupDistanceKm.toFixed(2) + " km"
                          : "--"}
                      </span>
                    </div>

                    <div className="flex justify-between gap-3">
                      <span className="text-slate-900">
                        Free pickup allowance
                      </span>
                      <span>
                        {state.pickupFreeKm > 0
                          ? state.pickupFreeKm.toFixed(1)
                          : "1.5"} km
                      </span>
                    </div>

                    <div className="flex justify-between gap-3">
                      <span className="text-slate-900">
                        Billable pickup distance
                      </span>
                      <span>
                        {state.pickupBillableExcessKm > 0
                          ? state.pickupBillableExcessKm.toFixed(2) + " km"
                          : "--"}
                      </span>
                    </div>

                    <div className="border-t pt-2 text-slate-700">
                      <div className="font-medium">
                        Pickup distance fee rules
                      </div>

                      <div className="mt-1">
                        First 10 km after the free allowance:
                        PHP 20 per 500 meters
                      </div>

                      <div>
                        Beyond 10 km:
                        PHP 10 per additional km
                      </div>
                    </div>

                    <div className="rounded bg-amber-50 p-2 text-amber-800">
                      Long-distance pickup may increase delivery cost
                      when the nearest available driver is far from
                      the pickup location.
                    </div>
                  </div>
                </details>
              ) : null}
              <div className="mt-2 flex justify-between gap-3 border-t pt-2 text-base">
                <span className="font-semibold">Total payable</span>
                <span className="font-black text-slate-950">{order && isVendorAcceptTimeout(order) ? "Order expired" : state.totalPayable > 0 ? money(state.totalPayable) : "Pending"}</span>
              </div>
              {order?.takeout_cash_collection_required === true ? (
                <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">Cash collection required before vendor pickup.</div>
              ) : null}
                            {state.pickupExcessFee >= 200 ? (
  <div className="mt-2 rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
    <div className="font-semibold">
      Long-distance driver warning
    </div>

    <div className="mt-1">
      The nearest available driver is far from the pickup area.
      Because this order requires cash collection before going to the store,
      the pickup distance fee may be significantly higher than normal.
    </div>

    <div className="mt-2">
      Please review the delivery fee and pickup distance fee carefully before confirming the order total.
    </div>
  </div>
) : null}
              {state.pricingStatus === "driver_fee_proposed" && !state.isCompleted && !state.isCancelled ? (
                <div className="mt-2 rounded border border-rose-200 bg-rose-50 p-2 text-xs font-semibold text-rose-900">Proposal expires in: <span className="font-semibold">{state.expiresIn === null ? "--" : String(state.expiresIn) + " sec"}</span></div>
              ) : null}
            </div>

            {state.pricingStatus === "pricing_pending" && !state.isCancelled ? (
              <div className="rounded border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                {state.vendorHasAccepted ? "Store confirmed. Waiting for a nearby driver to provide the delivery quote." : "Your order has been sent. Please wait while the store confirms and a nearby driver becomes available."}
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
<div className="mb-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
  {[
    ["Store confirmed", state.vendorHasAccepted],
    ["Driver found", Boolean(state.assignedDriverId || state.driverName || state.driverPhone)],
    ["Quote ready", state.pricingStatus === "driver_fee_proposed" || state.passengerConfirmed],
    ["Order confirmed", state.passengerConfirmed],
    ["At store", ["rider_arrived_vendor", "arrived_vendor", "picked_up", "delivering", "completed"].includes(state.progressStatus)],
    ["Picked up", ["picked_up", "delivering", "completed"].includes(state.progressStatus)],
    ["Delivering", ["delivering", "completed"].includes(state.progressStatus)],
    ["Completed", state.isCompleted],
  ].map(([label, done], idx) => (
    <div
      key={String(label)}
      className={
        "rounded-full border px-2 py-1 text-center font-semibold " +
        (done
          ? "border-emerald-300 bg-emerald-50 text-emerald-700"
          : idx === 0 || idx === 1 || idx === 2
            ? "border-amber-300 bg-amber-50 text-amber-700"
            : "border-slate-200 bg-slate-50 text-slate-500")
      }
    >
      {label}
    </div>
  ))}
</div>
                <div className="font-semibold text-slate-900">Live takeout progress</div>
                <div className="mt-1">{state.progressLabel}</div>
                {state.vendorStatus ? <div className="mt-1 text-slate-500">Vendor status: {state.vendorStatus.replace(/_/g, " ")}</div> : null}
                {state.customerStatus ? <div className="mt-1 text-slate-500">Customer status: {state.customerStatus.replace(/_/g, " ")}</div> : null}
                                {state.takeoutMapUrl ? (
                  <a
                    href={state.takeoutMapUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex w-full items-center justify-center rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white hover:bg-slate-800"
                  >
                    View driver route to {state.takeoutMapTargetLabel}
                  </a>
                ) : null}
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
              <div className="space-y-3">
                <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                  <div className="font-semibold">Order completed.</div>
                  <div className="mt-1">Thank you for using JRide Takeout.</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <a href="/takeout" className="rounded bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800">Order again</a>
                    <a href="/takeout" className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">Home</a>
                    <a href="/takeout/orders" className="rounded border border-emerald-300 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-50">View orders</a>
                  </div>
                </div>

                <div className="rounded border border-slate-200 bg-white p-3 text-sm text-slate-800">
                  <div className="font-semibold">Rate this takeout order</div>
                  <div className="mt-1 text-xs text-slate-500">Rate the driver and the store separately.</div>

                  {ratingSubmitted ? (
                    <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-3 text-xs font-semibold text-emerald-800">
                      Rating submitted. Thank you for helping improve JRide Takeout.
                    </div>
                  ) : (
                    <div className="mt-3 space-y-4">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Driver rating</div>
                        <StarButtons value={driverRating} onChange={setDriverRating} disabled={ratingBusy} />
                        <textarea
                          value={driverComment}
                          onChange={(e) => setDriverComment(e.target.value)}
                          disabled={ratingBusy}
                          placeholder="Optional driver comment"
                          className="mt-2 w-full rounded border px-3 py-2 text-sm"
                          rows={2}
                        />
                      </div>

                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Store rating</div>
                        <StarButtons value={vendorRating} onChange={setVendorRating} disabled={ratingBusy} />
                        <textarea
                          value={vendorComment}
                          onChange={(e) => setVendorComment(e.target.value)}
                          disabled={ratingBusy}
                          placeholder="Optional store comment"
                          className="mt-2 w-full rounded border px-3 py-2 text-sm"
                          rows={2}
                        />
                      </div>

                      <button
                        type="button"
                        onClick={submitTakeoutRating}
                        disabled={ratingBusy}
                        className="w-full rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:bg-slate-400"
                      >
                        {ratingBusy ? "Submitting..." : "Submit rating"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {state.isCancelled ? (
              <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <div className="font-semibold">
                  {isVendorAcceptTimeout(order) ? "Vendor did not respond in time." : "Order cancelled by vendor."}
                </div>

                <div className="mt-2">
                  {isVendorAcceptTimeout(order)
                    ? "This order was automatically closed because the vendor did not accept it within 5 minutes."
                    : cancelReason(order)
                      ? (() => {
                        const raw = cancelReason(order);
                        const parts = raw.split(" - ");
                        if (parts.length < 2) return "Reason: " + raw;
                        return (
                          <>
                            <div>Reason: {parts[0]}</div>
                            <div className="mt-1">Note: {parts.slice(1).join(" - ")}</div>
                          </>
                        );
                      })()
                      : ""}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/takeout" className="rounded bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800">Start new order</a>
                  <a href="/takeout" className="rounded border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-800 hover:bg-amber-50">Home</a>
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












