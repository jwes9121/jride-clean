"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabaseDriverClient";

type OfferItem = {
  product_name: string;
  product_group?: string | null;
  species?: string | null;
  breed?: string | null;
  meat_cut?: string | null;
  condition_required: string;
  cargo_class: string;
  selling_unit: string;
  quantity: number;
  handling_eligible: boolean;
  required_pickup_checks: string[];
  live_at_pickup_check_required: boolean;
};

type AgrimarketOffer = {
  offer_id: string;
  order_code: string;
  offer_rank: number;
  assignment_anchor: "customer" | "farmer";
  first_pickup: "customer" | "farmer";
  pickup_area?: string | null;
  pickup_road_distance_km: number;
  pickup_distance_fee: number;
  eta_seconds_to_first_pickup: number;
  eta_seconds_to_farmer: number;
  route_plan: string;
  cash_collection_required: boolean;
  cash_collection_amount: number;
  driver_cash_advance_required: boolean;
  farmer_payment_amount: number;
  preferred_vehicle_type: string;
  required_vehicle_type: string;
  service_route_distance_km: number;
  service_route_duration_seconds: number;
  estimated_driver_earnings_before_handling: number;
  handling_may_apply: boolean;
  items: OfferItem[];
  offered_at: string;
  expires_at: string;
};

type PickupCheck = {
  check_type: string;
  result: string;
  observed_condition?: string | null;
  notes?: string | null;
  checked_at?: string | null;
};

type AssignedItem = OfferItem & {
  id: string;
  processing_form?: string | null;
  pickup_checks: PickupCheck[];
};

type AssignedOrder = {
  order_code: string;
  status: string;
  next_action?: string | null;
  route_plan: string;
  assignment_anchor: "customer" | "farmer";
  cash_collection_required: boolean;
  cash_collection_amount: number;
  customer_cash_collected_at?: string | null;
  customer_cash_collected_amount: number;
  driver_cash_advance_required: boolean;
  farmer_payment_amount: number;
  producer_paid_at?: string | null;
  producer_paid_amount: number;
  pickup_distance_fee: number;
  handling_fee: number;
  handling_reason?: string | null;
  handling_locked: boolean;
  total_payable: number;
  final_cash_due: number;
  final_cash_collected_at?: string | null;
  final_cash_collected_amount: number;
  wallet_settlement_status: string;
  wallet_settlement_amount: number;
  wallet_settlement_error?: string | null;
  farmer: {
    name: string;
    town?: string | null;
    barangay?: string | null;
    pickup_label: string;
    lat: number;
    lng: number;
  };
  customer_delivery: {
    label: string;
    lat: number;
    lng: number;
  };
  preferred_vehicle_type: string;
  required_vehicle_type: string;
  items: AssignedItem[];
  ready_at?: string | null;
};

type DriverState =
  | { state: "none"; offer: null; order: null }
  | { state: "offered"; offer: AgrimarketOffer; order?: null }
  | { state: "assigned"; order: AssignedOrder; offer?: null };

type Props = {
  online: boolean;
};

const HANDLING_AMOUNTS = [0, 10, 20, 30, 40, 50];
const HANDLING_REASONS = [
  ["carry_load_sack", "Carry/load sack"],
  ["multiple_sacks", "Multiple sacks"],
  ["heavy_crate", "Heavy crate"],
  ["livestock_loading", "Livestock loading"],
  ["unloading_assistance", "Unloading assistance"],
  ["other_approved", "Other approved handling"],
] as const;

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function duration(seconds: unknown): string {
  const value = Number(seconds || 0);
  if (!Number.isFinite(value) || value <= 0) return "0 min";
  if (value < 60) return `${Math.ceil(value)} sec`;
  return `${Math.ceil(value / 60)} min`;
}

function mapsHref(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

function checkResult(item: AssignedItem, checkType: string): string | null {
  const match = item.pickup_checks.find((check) => check.check_type === checkType);
  return match?.result || null;
}

async function authHeaders(json = false): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = String(data.session?.access_token || "").trim();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

export default function AgrimarketDriverPanel({ online }: Props) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [driverState, setDriverState] = useState<DriverState>({ state: "none", offer: null, order: null });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [handlingAmount, setHandlingAmount] = useState(0);
  const [handlingReason, setHandlingReason] = useState("carry_load_sack");
  const [nowMs, setNowMs] = useState(() => Date.now());
  const previousOfferRef = useRef("");

  const load = useCallback(async (quiet = false) => {
    if (!online) {
      setDriverState({ state: "none", offer: null, order: null });
      return;
    }
    if (!quiet) setError("");

    try {
      const headers = await authHeaders();
      const response = await fetch("/api/driver/agrimarket/offer", { cache: "no-store", headers });
      const payload = await response.json().catch(() => ({}));

      if (payload?.error === "AGRIMARKET_DISABLED") {
        setEnabled(false);
        setDriverState({ state: "none", offer: null, order: null });
        return;
      }
      if (response.status === 401 || response.status === 403) {
        setEnabled(true);
        setError("Driver sign-in is required before Agrimarket jobs can be received.");
        return;
      }
      if (!response.ok || payload?.ok === false) {
        setEnabled(true);
        setError(payload?.message || payload?.error || "Unable to check Agrimarket jobs.");
        return;
      }

      setEnabled(true);
      const state = String(payload?.state || "none");
      if (state === "offered" && payload?.offer) {
        const nextOffer = payload.offer as AgrimarketOffer;
        setDriverState({ state: "offered", offer: nextOffer });
        if (previousOfferRef.current !== nextOffer.offer_id) {
          previousOfferRef.current = nextOffer.offer_id;
          try {
            navigator.vibrate?.([250, 100, 250]);
          } catch {}
        }
      } else if (state === "assigned" && payload?.order) {
        const order = payload.order as AssignedOrder;
        setDriverState({ state: "assigned", order });
        setHandlingAmount(Number(order.handling_fee || 0));
        if (order.handling_reason) setHandlingReason(order.handling_reason);
        previousOfferRef.current = "";
      } else {
        setDriverState({ state: "none", offer: null, order: null });
        previousOfferRef.current = "";
      }
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to check Agrimarket jobs."));
    }
  }, [online]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!online || enabled === false) return;
    const timer = window.setInterval(() => void load(true), 5000);
    return () => window.clearInterval(timer);
  }, [online, enabled, load]);

  useEffect(() => {
    if (driverState.state !== "offered") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [driverState.state]);

  const offerSecondsRemaining = useMemo(() => {
    if (driverState.state !== "offered") return 0;
    const expiry = Date.parse(driverState.offer.expires_at);
    return Number.isFinite(expiry) ? Math.max(0, Math.floor((expiry - nowMs) / 1000)) : 0;
  }, [driverState, nowMs]);

  async function decide(decision: "accept" | "decline") {
    if (driverState.state !== "offered") return;
    setBusy(`decision:${decision}`);
    setError("");
    setMessage("");
    try {
      const headers = await authHeaders(true);
      const response = await fetch("/api/driver/agrimarket/decision", {
        method: "POST",
        headers,
        body: JSON.stringify({
          offer_id: driverState.offer.offer_id,
          decision,
          reason: decision === "decline" ? "driver_declined" : null,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to respond to the Agrimarket offer.");
      } else {
        setMessage(decision === "accept" ? "Agrimarket job accepted. Follow the required cash and pickup sequence below." : "Offer declined. JRide will try another eligible driver.");
        await load(true);
      }
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to respond to the Agrimarket offer."));
    }
    setBusy("");
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    if (driverState.state !== "assigned") return;
    setBusy(action);
    setError("");
    setMessage("");
    try {
      const headers = await authHeaders(true);
      const response = await fetch("/api/driver/agrimarket/action", {
        method: "POST",
        headers,
        body: JSON.stringify({
          order_code: driverState.order.order_code,
          action,
          payload,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body?.ok === false) {
        setError(body?.message || body?.error || "Unable to update the Agrimarket job.");
      } else {
        setMessage(`${titleCase(action)} recorded.`);
        await load(true);
      }
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to update the Agrimarket job."));
    }
    setBusy("");
  }

  if (enabled === false) return null;

  if (!online) {
    return (
      <section className="mt-5 w-full max-w-3xl rounded-2xl border border-slate-700 bg-slate-900 p-4 text-left">
        <p className="text-sm font-semibold text-emerald-400">Agrimarket jobs</p>
        <p className="mt-1 text-xs text-slate-400">Go Online to receive private Agrimarket delivery offers.</p>
      </section>
    );
  }

  return (
    <section className="mt-5 w-full max-w-3xl rounded-2xl border border-emerald-800 bg-slate-900 p-4 text-left shadow-xl">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-emerald-400">JRide Agrimarket</p>
          <p className="text-[11px] text-slate-400">Road-route assignment. Exact farm/customer locations appear only after you accept.</p>
        </div>
        <button type="button" onClick={() => load()} className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-200">
          Refresh
        </button>
      </div>

      {error ? <div className="mt-3 rounded-xl bg-rose-950/60 p-3 text-xs text-rose-200">{error}</div> : null}
      {message ? <div className="mt-3 rounded-xl bg-emerald-950/60 p-3 text-xs text-emerald-200">{message}</div> : null}

      {driverState.state === "none" ? (
        <div className="mt-4 rounded-xl bg-slate-950 p-4 text-center text-xs text-slate-400">
          No Agrimarket offer right now. Keep this page online; JRide will surface the next eligible job automatically.
        </div>
      ) : null}

      {driverState.state === "offered" ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl border border-amber-700 bg-amber-950/50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-amber-400">Incoming Agrimarket job</p>
                <p className="mt-1 text-xl font-bold">{driverState.offer.order_code}</p>
                <p className="mt-1 text-xs text-slate-300">First pickup: {titleCase(driverState.offer.first_pickup)}{driverState.offer.pickup_area ? ` - ${driverState.offer.pickup_area}` : ""}</p>
              </div>
              <div className="rounded-xl bg-slate-950 px-4 py-2 text-center">
                <p className="text-[10px] uppercase text-slate-500">Respond within</p>
                <p className="text-2xl font-bold text-amber-300">{Math.ceil(offerSecondsRemaining / 60)} min</p>
                <p className="text-[10px] text-slate-500">{offerSecondsRemaining}s</p>
              </div>
            </div>
          </div>

          <div className="grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl bg-slate-950 p-3"><p className="text-slate-500">Road to first pickup</p><p className="mt-1 font-bold">{driverState.offer.pickup_road_distance_km.toFixed(1)} km</p></div>
            <div className="rounded-xl bg-slate-950 p-3"><p className="text-slate-500">Pickup surcharge</p><p className="mt-1 font-bold">{money(driverState.offer.pickup_distance_fee)}</p></div>
            <div className="rounded-xl bg-slate-950 p-3"><p className="text-slate-500">ETA to first pickup</p><p className="mt-1 font-bold">{duration(driverState.offer.eta_seconds_to_first_pickup)}</p></div>
            <div className="rounded-xl bg-slate-950 p-3"><p className="text-slate-500">Earnings before handling</p><p className="mt-1 font-bold text-emerald-300">{money(driverState.offer.estimated_driver_earnings_before_handling)}</p></div>
          </div>

          {driverState.offer.cash_collection_required ? (
            <div className="rounded-xl bg-blue-950/60 p-3 text-xs text-blue-100">
              <strong>Customer cash first.</strong> Collect {money(driverState.offer.cash_collection_amount)} from the customer before going to the farmer. Then pay the farmer {money(driverState.offer.farmer_payment_amount)}.
            </div>
          ) : (
            <div className="rounded-xl bg-amber-950/50 p-3 text-xs text-amber-100">
              <strong>Farmer first.</strong> You must have {money(driverState.offer.farmer_payment_amount)} cash available to advance to the farmer. The customer pays the order at delivery.
            </div>
          )}

          <div className="rounded-xl bg-slate-950 p-3 text-xs">
            <div className="flex flex-wrap gap-x-5 gap-y-1 text-slate-300">
              <span>Route: <strong>{titleCase(driverState.offer.route_plan)}</strong></span>
              <span>Vehicle: <strong>{titleCase(driverState.offer.required_vehicle_type || driverState.offer.preferred_vehicle_type)}</strong></span>
              <span>Service route: <strong>{driverState.offer.service_route_distance_km.toFixed(1)} km</strong></span>
              {driverState.offer.handling_may_apply ? <span>Handling: <strong>PHP 0-50 if actually needed</strong></span> : null}
            </div>
            <div className="mt-3 space-y-2">
              {driverState.offer.items.map((item, index) => (
                <div key={`${driverState.offer.order_code}-${index}`} className="rounded-lg bg-slate-900 p-2">
                  <p className="font-semibold">{item.product_name} - {item.quantity} {item.selling_unit}</p>
                  <p className="mt-1 text-[10px] text-slate-400">{titleCase(item.condition_required)} - {titleCase(item.cargo_class)} - checks: {item.required_pickup_checks.map(titleCase).join(", ")}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={Boolean(busy) || offerSecondsRemaining <= 0} onClick={() => decide("decline")} className="rounded-xl bg-slate-700 px-4 py-3 text-sm font-bold disabled:opacity-50">Decline</button>
            <button type="button" disabled={Boolean(busy) || offerSecondsRemaining <= 0} onClick={() => decide("accept")} className="rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">{busy === "decision:accept" ? "Accepting..." : "Accept job"}</button>
          </div>
        </div>
      ) : null}

      {driverState.state === "assigned" ? (
        <div className="mt-4 space-y-3">
          <div className="rounded-xl bg-emerald-950/50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-emerald-400">Assigned Agrimarket job</p>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
              <div><p className="text-xl font-bold">{driverState.order.order_code}</p><p className="text-xs text-slate-300">{titleCase(driverState.order.status)} - next: {titleCase(driverState.order.next_action || "follow workflow")}</p></div>
              <p className="text-lg font-bold text-emerald-300">{money(driverState.order.total_payable)}</p>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-950 p-3 text-xs">
              <p className="text-[10px] font-bold uppercase text-emerald-400">Farmer pickup</p>
              <p className="mt-1 font-bold">{driverState.order.farmer.name}</p>
              <p className="text-slate-300">{driverState.order.farmer.pickup_label}</p>
              <p className="text-slate-500">{driverState.order.farmer.barangay ? `${driverState.order.farmer.barangay}, ` : ""}{driverState.order.farmer.town}</p>
              <a href={mapsHref(driverState.order.farmer.lat, driverState.order.farmer.lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-emerald-700 px-3 py-2 font-semibold text-white">Directions to farmer</a>
            </div>
            <div className="rounded-xl bg-slate-950 p-3 text-xs">
              <p className="text-[10px] font-bold uppercase text-blue-400">Customer delivery</p>
              <p className="mt-1 font-bold">{driverState.order.customer_delivery.label}</p>
              <p className="mt-1 text-slate-400">Follow the route sequence shown by JRide.</p>
              <a href={mapsHref(driverState.order.customer_delivery.lat, driverState.order.customer_delivery.lng)} target="_blank" rel="noreferrer" className="mt-3 inline-flex rounded-lg bg-blue-700 px-3 py-2 font-semibold text-white">Directions to customer</a>
            </div>
          </div>

          {driverState.order.next_action === "collect_customer_cash" ? (
            <div className="rounded-xl bg-blue-950/60 p-4">
              <p className="text-sm font-bold">1. Collect product cash from customer</p>
              <p className="mt-1 text-2xl font-bold text-blue-200">{money(driverState.order.cash_collection_amount)}</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => runAction("collect_customer_cash", { amount: driverState.order.cash_collection_amount })} className="mt-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Confirm cash collected</button>
            </div>
          ) : null}

          {driverState.order.next_action === "pay_farmer" ? (
            <div className="rounded-xl bg-amber-950/50 p-4">
              <p className="text-sm font-bold">Pay farmer</p>
              <p className="mt-1 text-2xl font-bold text-amber-200">{money(driverState.order.farmer_payment_amount)}</p>
              {driverState.order.driver_cash_advance_required ? <p className="mt-1 text-xs text-amber-100">This is your cash advance. You recover it from the customer at final delivery.</p> : <p className="mt-1 text-xs text-amber-100">Use the product cash already collected from the customer.</p>}
              <button type="button" disabled={Boolean(busy)} onClick={() => runAction("pay_farmer", { amount: driverState.order.farmer_payment_amount })} className="mt-3 rounded-xl bg-amber-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Confirm farmer paid</button>
            </div>
          ) : null}

          {driverState.order.status === "driver_assigned" && driverState.order.producer_paid_at ? (
            <>
              {!driverState.order.handling_locked && driverState.order.items.some((item) => item.handling_eligible) ? (
                <div className="rounded-xl bg-slate-950 p-4">
                  <p className="text-sm font-bold">Handling fee, only if actually required</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <label className="text-xs text-slate-300">Amount<select value={handlingAmount} onChange={(event) => setHandlingAmount(Number(event.target.value))} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">{HANDLING_AMOUNTS.map((amount) => <option key={amount} value={amount}>{money(amount)}</option>)}</select></label>
                    <label className="text-xs text-slate-300">Reason<select value={handlingReason} onChange={(event) => setHandlingReason(event.target.value)} disabled={handlingAmount === 0} className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-50">{HANDLING_REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                  </div>
                  <button type="button" disabled={Boolean(busy)} onClick={() => runAction("set_handling_fee", { amount: handlingAmount, reason: handlingAmount > 0 ? handlingReason : null })} className="mt-3 rounded-lg bg-slate-700 px-3 py-2 text-xs font-bold disabled:opacity-50">Save handling fee</button>
                </div>
              ) : null}

              <div className="rounded-xl bg-slate-950 p-4">
                <p className="text-sm font-bold">Pickup verification</p>
                <p className="mt-1 text-[11px] text-slate-400">All required checks must PASS before Confirm Pickup. A mismatch blocks pickup until corrected and rechecked.</p>
                <div className="mt-3 space-y-3">
                  {driverState.order.items.map((item) => (
                    <div key={item.id} className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                      <p className="text-sm font-semibold">{item.product_name} - {item.quantity} {item.selling_unit}</p>
                      <p className="mt-1 text-[10px] text-slate-400">Expected: {titleCase(item.condition_required)} - Cargo: {titleCase(item.cargo_class)}</p>
                      <div className="mt-2 space-y-2">
                        {item.required_pickup_checks.map((check) => {
                          const result = checkResult(item, check);
                          return (
                            <div key={check} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-950 p-2 text-xs">
                              <span>{titleCase(check)}: <strong className={result === "pass" ? "text-emerald-400" : result === "mismatch" ? "text-rose-400" : "text-amber-300"}>{result ? titleCase(result) : "Pending"}</strong></span>
                              <div className="flex gap-1">
                                <button type="button" disabled={Boolean(busy)} onClick={() => runAction("verify_item", { order_item_id: item.id, check_type: check, result: "mismatch", notes: "Driver reported mismatch at pickup" })} className="rounded bg-rose-800 px-2 py-1 text-[10px] font-bold disabled:opacity-50">Mismatch</button>
                                <button type="button" disabled={Boolean(busy)} onClick={() => runAction("verify_item", { order_item_id: item.id, check_type: check, result: "pass", observed_condition: check === "condition" ? item.condition_required : null })} className="rounded bg-emerald-700 px-2 py-1 text-[10px] font-bold disabled:opacity-50">Pass</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
                <button type="button" disabled={Boolean(busy)} onClick={() => runAction("confirm_pickup")} className="mt-4 w-full rounded-xl bg-emerald-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Confirm pickup and lock handling</button>
              </div>
            </>
          ) : null}

          {driverState.order.next_action === "start_delivery" ? (
            <button type="button" disabled={Boolean(busy)} onClick={() => runAction("start_delivery")} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Start delivery to customer</button>
          ) : null}

          {driverState.order.next_action === "confirm_delivery" ? (
            <div className="rounded-xl bg-blue-950/60 p-4">
              <p className="text-sm font-bold">Final customer cash due</p>
              <p className="mt-1 text-2xl font-bold text-blue-200">{money(driverState.order.final_cash_due)}</p>
              <p className="mt-1 text-xs text-blue-100">Collect this exact remaining amount, then confirm delivery.</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => runAction("confirm_delivery", { amount: driverState.order.final_cash_due })} className="mt-3 rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Confirm cash and delivery</button>
            </div>
          ) : null}

          {driverState.order.next_action === "retry_settlement" ? (
            <div className="rounded-xl bg-rose-950/50 p-4">
              <p className="text-sm font-bold">Delivery complete - JRide settlement pending</p>
              <p className="mt-1 text-xl font-bold text-rose-200">{money(driverState.order.wallet_settlement_amount)}</p>
              <p className="mt-1 text-xs text-rose-100">{driverState.order.wallet_settlement_error || "Top up the driver wallet if needed. You cannot receive another Agrimarket job until this is settled."}</p>
              <button type="button" disabled={Boolean(busy)} onClick={() => runAction("retry_settlement")} className="mt-3 rounded-xl bg-rose-700 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">Retry settlement</button>
            </div>
          ) : null}

          <div className="rounded-xl bg-slate-950 p-3 text-[11px] text-slate-400">
            Farmer identity and exact pickup pin shown here are for this assigned delivery only. Do not disclose the farmer source to the customer or other parties.
          </div>
        </div>
      ) : null}
    </section>
  );
}
