"use client";

import OrderExpiryDialog from "@/components/agrimarket/OrderExpiryDialog";
import { agrimarketExpiryNotice } from "@/lib/agrimarket/orderExpiry";
import CustomerReapprovalDialog from "@/components/agrimarket/CustomerReapprovalDialog";

import Link from "next/link";
import { useEffect, useState } from "react";
import { scheduledActivity, scheduledTitle } from "@/lib/agrimarket/schedule";
import { scheduledHarvestAttention } from "@/lib/agrimarket/harvestAttention";

type CargoConfirmation = {
  weight_basis: string;
  exact_weight_kg?: number | null;
  weight_band?: string | null;
  handling_tier?: string | null;
};

type ChargeBreakdown = {
  products: number;
  delivery: number;
  heavy_load_fee: number;
  special_handling_fee: number;
  driver_approach_fee: number;
  driver_approach_fee_locked: boolean;
};

type OrderStatus = {
  pickup_paused?: boolean;
  pickup_message?: string | null;
  order_code: string;
  store?: { name: string | null; town: string | null } | null;
  status: string;
  fulfillment_mode: string;
  harvest_expected_start_at?: string | null;
  harvest_expected_end_at?: string | null;
  harvest_ready_at?: string | null;
  pending_harvest_proposal?: {
    id: string;
    updated_at: string;
    proposal_type: string;
    proposed_items: Array<{
      product_name?: string;
      selling_unit?: string;
      original_quantity?: number;
      proposed_quantity?: number;
    }>;
    proposed_harvest_start_at?: string | null;
    proposed_harvest_end_at?: string | null;
    reason?: string | null;
    proposed_at?: string | null;
  } | null;
  producer_confirm_expires_at?: string | null;
  producer_accepted_at?: string | null;
  producer_rejected_at?: string | null;
  producer_timeout_at?: string | null;
  preparation_minutes?: number | null;
  ready_at?: string | null;
  selected_vehicle_type?: string | null;
  preferred_vehicle_type?: string | null;
  required_vehicle_type?: string | null;
  estimated_cargo_weight_kg?: number | null;
  confirmed_cargo_weight_basis?: string | null;
  confirmed_cargo_weight_kg?: number | null;
  confirmed_cargo_weight_band?: string | null;
  confirmed_handling_tier?: string | null;
  cargo_confirmation?: CargoConfirmation | null;
  server_now?: string;
  cancel_reason?: string | null;
  customer_reapproval_required?: boolean;
  customer_reapproval?: {
    approved_total: number;
    revised_total: number;
    increase_amount: number;
    approved_vehicle_type: string;
    revised_vehicle_type: string;
    price_increased: boolean;
    vehicle_escalated: boolean;
    required_at?: string | null;
    expires_at?: string | null;
    confirmed_cargo?: CargoConfirmation | null;
    charge_breakdown?: ChargeBreakdown | null;
  } | null;
  product_subtotal: number;
  cash_collection_required: boolean;
  cash_collection_amount: number;
  customer_cash_collected_at?: string | null;
  customer_cash_collected_amount: number;
  delivery_fee: number;
  driver_to_first_pickup_km?: number | null;
  pickup_distance_fee: number;
  pickup_fee_locked: boolean;
  heavy_load_fee: number;
  heavy_load_fee_confirmed: boolean;
  handling_fee: number;
  special_handling_fee: number;
  handling_reason?: string | null;
  handling_fee_locked: boolean;
  special_handling_fee_confirmed: boolean;
  charge_breakdown?: ChargeBreakdown | null;
  total_payable: number;
  cash_due_now: number;
  final_cash_due: number;
  picked_up_at?: string | null;
  delivering_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  items: Array<{
    product_id?: string;
    product_name: string;
    product_group?: string;
    selling_unit: string;
    unit_price: number;
    quantity: number;
    line_total: number;
    condition_required?: string | null;
  }>;
};

function authHeaders(json = false): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (json) headers["Content-Type"] = "application/json";
  if (typeof window === "undefined") return headers;
  const token = window.localStorage.getItem("jride_passenger_token") || window.localStorage.getItem("jride_access_token") || window.sessionStorage.getItem("jride_passenger_token") || window.sessionStorage.getItem("jride_access_token") || "";
  const deviceId = window.localStorage.getItem("jride_native_device_id") || window.sessionStorage.getItem("jride_native_device_id") || "";
  if (token.trim()) headers.Authorization = `Bearer ${token.trim()}`;
  if (deviceId.trim()) headers["x-device-id"] = deviceId.trim();
  return headers;
}

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  return String(value || "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-PH", { timeZone: "Asia/Manila", dateStyle: "medium", timeStyle: "short" }) : "-";
}

function cargoConfirmationLabel(order: OrderStatus): string {
  if (order.confirmed_cargo_weight_basis === "exact") {
    return `${order.confirmed_cargo_weight_kg ?? "?"} kg exact weight`;
  }
  if (order.confirmed_cargo_weight_basis === "approximate") {
    return `${String(order.confirmed_cargo_weight_band || "").replace(/_/g, "-")} kg approximate range`;
  }
  return "Pending farmer confirmation";
}

function progressLabel(order: OrderStatus): string {
  const expiry = agrimarketExpiryNotice(order);
  if (expiry) return expiry.title;
  if (order.pickup_paused) return "Pickup paused - JRide is resolving a load issue";
  if (order.completed_at || order.status === "completed") return "Order completed";
  if (order.delivered_at || order.status === "delivered") return "Delivered";
  if (order.delivering_at || order.status === "delivering") return "Driver is delivering your order";
  if (order.picked_up_at || order.status === "picked_up") return "Items verified and picked up";
  if (order.status === "driver_assigned") return order.cash_collection_required && !order.customer_cash_collected_at ? "Driver assigned - prepare product cash" : "Driver assigned";
  if (order.status === "awaiting_customer_reapproval") return "Review revised delivery charges";
  if (["dispatching", "ready_for_dispatch"].includes(order.status)) return "Finding an eligible driver";
  if (order.status === "awaiting_harvest") return order.pending_harvest_proposal ? "Farmer needs your decision" : `${scheduledTitle(order.items)} reservation confirmed`;
  if (["producer_accepted", "preparing"].includes(order.status)) return "Farmer is preparing your order";
  if (order.status === "awaiting_producer") return order.fulfillment_mode === "scheduled_harvest" ? "Waiting for farmer to confirm your reservation" : "Waiting for farmer confirmation";
  return titleCase(order.status);
}

export default function AgrimarketOrderTrackingPage() {
  const [code, setCode] = useState("");
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [disabled, setDisabled] = useState(false);
  const [loading, setLoading] = useState(false);
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const value = new URLSearchParams(window.location.search).get("code") || "";
    if (value.trim()) { setCode(value.trim()); void loadOrder(value.trim()); }
  }, []);

  useEffect(() => {
    if (!order || disabled) return;
    if (["completed", "cancelled", "producer_rejected", "producer_timeout"].includes(String(order.status).toLowerCase())) return;
    const refresh = () => { if (document.visibilityState === "visible") void loadOrder(order.order_code, true); };
    const timer = window.setInterval(refresh, 10000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [order?.order_code, order?.status, disabled]);

  async function loadOrder(orderCode = code, quiet = false) {
    const clean = orderCode.trim();
    if (!clean) return;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/agrimarket/order-status?${new URLSearchParams({ order_code: clean }).toString()}`, { cache: "no-store", headers: authHeaders() });
      const payload = await response.json().catch(() => ({}));
      if (payload?.error === "AGRIMARKET_DISABLED") { setDisabled(true); setOrder(null); }
      else if (!response.ok || payload?.ok === false) { setError(payload?.message || payload?.error || "Unable to load this Agrimarket order."); if (!quiet) setOrder(null); }
      else { setOrder(payload.order as OrderStatus); window.history.replaceState(null, "", `/agrimarket/order?code=${encodeURIComponent(clean)}`); }
    } catch {
      setError("Unable to refresh the order. Check your connection. The approval deadline still applies.");
    } finally { if (!quiet) setLoading(false); }
  }

  async function respondHarvest(responseValue: "accept" | "reject") {
    const proposal = order?.pending_harvest_proposal;
    if (!order || responding || !proposal?.id || !proposal.updated_at) return;
    if (!window.confirm(responseValue === "reject" ? "Reject this displayed change and cancel the entire reservation?" : "Accept this displayed date or quantity change?")) return;
    const code = order.order_code;
    setResponding(true); setError("");
    try {
      const response = await fetch("/api/agrimarket/order-harvest-response", { method: "POST", headers: authHeaders(true),
        body: JSON.stringify({ order_code: code, response: responseValue, proposal_id: proposal.id, expected_updated_at: proposal.updated_at }) });
      const payload = await response.json().catch(() => ({}));
      await loadOrder(code, true);
      if (!response.ok || payload?.ok === false) setError(payload?.message || "Refresh and review the current proposal before responding.");
    } catch { setError("Response not confirmed. Refresh to check the reservation before retrying."); }
    finally { setResponding(false); }
  }

  async function respondReapproval(responseValue: "accept" | "reject") {
    if (!order || responding) return;
    setResponding(true); setError("");
    try {
      const response = await fetch("/api/agrimarket/order-reapproval-response", {
        method: "POST", headers: authHeaders(true), body: JSON.stringify({
          order_code: order.order_code, response: responseValue,
          expected_total: order.customer_reapproval?.revised_total,
          expected_vehicle: order.customer_reapproval?.revised_vehicle_type,
          expected_deadline: order.customer_reapproval?.expires_at,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      await loadOrder(order.order_code, true);
      if (!response.ok || payload?.ok === false) {
        setError(payload?.error === "AGRIMARKET_REAPPROVAL_PROPOSAL_STALE"
          ? "The proposal changed. Review the refreshed details before approving."
          : payload?.error === "AGRIMARKET_REAPPROVAL_EXPIRED" ? "The approval window has expired."
          : payload?.message || "Unable to respond. Please check the order and try again.");
      }
    } catch {
      setError("Unable to reach JRide. Check your connection and try again before the deadline.");
    } finally { setResponding(false); }
  }

  const expiryNotice = order ? agrimarketExpiryNotice(order) : null;

  if (disabled) return <main className="min-h-screen bg-emerald-50 p-8"><div className="mx-auto max-w-xl rounded-3xl bg-white p-8"><h1 className="text-2xl font-bold">Agrimarket is still in pre-launch</h1></div></main>;

  return (
    <main className="min-h-screen bg-slate-50 px-3 py-6 text-slate-900 sm:px-5">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold uppercase tracking-widest text-emerald-700">JRide Agrimarket</p><h1 className="text-3xl font-bold">Track order</h1></div><Link href="/agrimarket" className="rounded-xl border bg-white px-4 py-2 text-sm font-semibold">Marketplace</Link></div>
        <div className="mt-5 rounded-2xl border bg-white p-4 shadow-sm"><div className="flex flex-col gap-2 sm:flex-row"><input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Order code" className="min-w-0 flex-1 rounded-xl border px-3 py-3"/><button onClick={() => loadOrder()} disabled={loading || !code.trim()} className="rounded-xl bg-emerald-700 px-5 py-3 font-bold text-white disabled:bg-slate-400">{loading ? "Loading..." : "Track"}</button></div></div>
        {error ? <div className="mt-4 rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</div> : null}

        {order ? <section className="mt-5 rounded-3xl border bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">{order.order_code}</p><h2 className="mt-1 text-2xl font-bold">{progressLabel(order)}</h2><p className="mt-1 text-sm text-slate-500">Status: {titleCase(order.status)}</p>

          {order.store?.name && <p className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm">Store: <strong>{order.store.name}</strong>{order.store.town ? ` - ${order.store.town}` : ""}</p>}
          {expiryNotice ? <>
            <p role="alert" className="mt-4 rounded-xl border-2 border-red-400 bg-red-50 p-4 font-semibold text-red-900">{expiryNotice.message}</p>
            <OrderExpiryDialog key={order.order_code} orderCode={order.order_code} storeName={order.store?.name}
              title={expiryNotice.title} message={expiryNotice.message} onAcknowledge={() => window.location.replace("/agrimarket")} />
          </> : <>
          {order.fulfillment_mode === "scheduled_harvest" ? <div className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-900"><strong>{scheduledTitle(order.items)} reservation</strong><br/>Expected: {formatDate(order.harvest_expected_start_at)}{order.harvest_expected_end_at ? ` to ${formatDate(order.harvest_expected_end_at)}` : ""}<br/>{order.harvest_ready_at ? `Farmer marked products ready: ${formatDate(order.harvest_ready_at)}` : "No driver will be assigned until the farmer confirms the products are ready."}</div> : null}

          {scheduledHarvestAttention(order, Date.parse(order.server_now || "")) === "overdue" ? <div role="status" className="mt-4 rounded-2xl border border-amber-400 bg-amber-50 p-4 text-sm text-amber-950"><strong>Farmer update overdue.</strong> The preparation window ended without a readiness update. No driver has been offered this reservation. Check this order for a farmer proposal or contact JRide for help. It has not been automatically cancelled.</div> : null}
          {order.pending_harvest_proposal ? <div className="mt-4 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 text-amber-950"><h3 className="font-bold">Farmer proposes a change</h3>{order.pending_harvest_proposal.proposal_type === "delay" ? <p className="mt-2 text-sm">New {scheduledActivity(order.items)} date: <strong>{formatDate(order.pending_harvest_proposal.proposed_harvest_start_at)}</strong>{order.pending_harvest_proposal.proposed_harvest_end_at ? ` to ${formatDate(order.pending_harvest_proposal.proposed_harvest_end_at)}` : ""}</p> : <div className="mt-2 space-y-1 text-sm">{order.pending_harvest_proposal.proposed_items.map((item, index) => <p key={index}>{item.product_name}: <strong>{item.proposed_quantity} {item.selling_unit}</strong> instead of {item.original_quantity}</p>)}</div>}{order.pending_harvest_proposal.reason ? <p className="mt-2 text-sm">Reason: {order.pending_harvest_proposal.reason}</p> : null}<p className="mt-3 text-xs">Accept keeps the reservation with the revised date/quantity. Reject cancels the order and releases the reserved inventory.</p><div className="mt-3 flex gap-2"><button disabled={responding} onClick={() => respondHarvest("accept")} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white">Accept change</button><button disabled={responding} onClick={() => respondHarvest("reject")} className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white">Cancel order</button></div></div> : null}

          <div className="mt-4 rounded-2xl border bg-slate-50 p-4 text-sm">
            <h3 className="font-bold">Cargo weight and handling</h3>
            <div className="mt-2 space-y-1">
              <p>Checkout estimate: <strong>{order.estimated_cargo_weight_kg == null ? "Unavailable" : `${order.estimated_cargo_weight_kg} kg`}</strong></p>
              <p>Farmer confirmation: <strong>{cargoConfirmationLabel(order)}</strong></p>
              <p>Handling classification: <strong>{order.confirmed_handling_tier ? titleCase(order.confirmed_handling_tier) : "Pending farmer confirmation"}</strong></p>
            </div>
            {order.confirmed_cargo_weight_basis === "approximate" ? <p className="mt-2 text-xs text-slate-600">The selected weight range is authoritative for Heavy Load Fee and vehicle sizing. Any rough kilogram estimate is not treated as an exact weight.</p> : null}
          </div>

          {order.customer_reapproval_required && order.customer_reapproval ? <CustomerReapprovalDialog
            proposal={order.customer_reapproval} serverNow={order.server_now} busy={responding} error={error}
            onRespond={response => void respondReapproval(response)} onExpire={() => void loadOrder(order.order_code, true)} /> : null}


          {order.cash_due_now > 0 ? <div className="mt-4 rounded-2xl bg-blue-50 p-4 text-blue-950"><p className="text-sm font-semibold">Cash due now</p><p className="mt-1 text-2xl font-bold">{money(order.cash_due_now)}</p><p className="mt-1 text-xs">Pay only to the assigned JRide driver as instructed.</p></div> : null}

          <div className="mt-5 overflow-hidden rounded-xl border">{order.items.map((item, index) => <div key={`${order.order_code}-${index}`} className="flex flex-wrap justify-between gap-2 border-b px-4 py-3 last:border-b-0"><div><p className="font-semibold">{item.product_name}</p><p className="text-xs text-slate-500">{item.quantity} {item.selling_unit} x {money(item.unit_price)}</p></div><strong>{money(item.line_total)}</strong></div>)}</div>
          <div className="mt-5 space-y-2 text-sm"><div className="flex justify-between"><span>Products</span><strong>{money(order.product_subtotal)}</strong></div><div className="flex justify-between"><span>Delivery</span><strong>{money(order.delivery_fee)}</strong></div><div className="flex justify-between"><span>Heavy Load Fee</span><strong>{order.heavy_load_fee_confirmed ? money(order.heavy_load_fee) : "Pending farmer confirmation"}</strong></div><div className="flex justify-between"><span>Special Handling Fee</span><strong>{order.special_handling_fee_confirmed ? money(order.special_handling_fee) : "Pending farmer confirmation"}</strong></div><div className="flex justify-between"><span>Driver Approach Fee</span><strong>{order.pickup_fee_locked ? money(order.pickup_distance_fee) : "Pending driver assignment"}</strong></div><div className="flex justify-between border-t pt-2 text-base"><span>Current total</span><strong>{money(order.total_payable)}</strong></div></div>
          {!order.pickup_fee_locked ? <p className="mt-2 text-xs text-slate-500">Current total does not yet include the final Driver Approach Fee. That fee is locked only after an eligible driver is assigned.</p> : null}
          {order.cash_collection_required ? <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm">Product cash-first order: {money(order.cash_collection_amount)} is collected before farmer pickup. Remaining Delivery, Heavy Load, Special Handling, and Driver Approach charges are settled at final delivery as applicable.</div> : null}
          <p className="mt-5 text-xs text-slate-500">Farmer personal contact details and the exact pickup location are protected by JRide.</p>
          </>}
        </section> : null}
      </div>
    </main>
  );
}
