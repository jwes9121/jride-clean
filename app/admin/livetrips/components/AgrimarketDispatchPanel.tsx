"use client";

import ReapprovalCountdown from "@/components/agrimarket/ReapprovalCountdown";
import type { ScheduledHarvestAttention } from "@/lib/agrimarket/harvestAttention";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AgrimarketOrderDetails, type DispatchItem } from "./AgrimarketOrderDetails";

export type AgrimarketDispatchOrder = {
  customer?: { name: string | null; phone: string | null; delivery_label: string | null; address_text: string | null; landmark: string | null } | null;
  items?: DispatchItem[];
  details?: Record<string, string | number | null>;
  customer_reapproval_expires_at?: string | null;
  server_now?: string;
  admin_actions?: { can_cancel: boolean; can_reassign: boolean; recovery_required: boolean; active_offer_id: string | null };
  created_at?: string | null;
  updated_at?: string | null;
  pickup_issue?: { status: string; reason: string; confirm_farmer_refund?: unknown; confirm_customer_refund?: unknown } | null;
  order_id: string;
  order_code: string;
  status: string;
  fulfillment_mode: string;
  harvest_expected_start_at?: string | null;
  harvest_expected_end_at?: string | null;
  harvest_ready_at?: string | null;
  harvest_attention?: ScheduledHarvestAttention;
  producer_confirm_expires_at?: string | null;
  preparation_minutes?: number | null;
  ready_at?: string | null;
  product_subtotal: number;
  cash_collection_required: boolean;
  cash_collection_amount: number;
  route_plan: string;
  assignment_anchor: string;
  preferred_vehicle_type: string;
  required_vehicle_type: string;
  route_distance_km: number;
  delivery_fee: number;
  pickup_distance_fee: number;
  handling_fee: number;
  total_payable: number;
  farmer_area?: { name?: string | null; town?: string | null; barangay?: string | null } | null;
  assigned_driver?: {
    driver_id: string;
    name: string;
    municipality?: string | null;
    vehicle_type?: string | null;
  } | null;
  latest_offer?: {
    offer_id: string;
    status: string;
    driver_id: string;
    driver_name: string;
    offer_rank: number;
    assignment_anchor: string;
    pickup_road_distance_km: number;
    pickup_distance_fee: number;
    eta_seconds_to_first_pickup: number;
    eta_seconds_to_farmer: number;
    offered_at?: string | null;
    expires_at?: string | null;
    seconds_remaining: number;
    reason_code?: string | null;
  } | null;
  wallet_settlement_status?: string | null;
  wallet_settlement_amount?: number | null;
  wallet_settlement_error?: string | null;
};

function money(value: unknown): string {
  const amount = Number(value || 0);
  return `PHP ${Number.isFinite(amount) ? amount.toFixed(2) : "0.00"}`;
}

function titleCase(value: unknown): string {
  if (value === "kolong_kolong") return "Kolong-Kolong";
  if (value === "either") return "Any eligible vehicle";
  return String(value || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: unknown): string {
  if (!value) return "-";
  const date = new Date(String(value));
  if (!Number.isFinite(date.getTime())) return "-";
  return date.toLocaleString("en-PH", {
    timeZone: "Asia/Manila",
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function minutes(value: unknown): string {
  const seconds = Number(value || 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 min";
  if (seconds < 60) return `${Math.ceil(seconds)} sec`;
  return `${Math.ceil(seconds / 60)} min`;
}

function dispatchable(order: AgrimarketDispatchOrder): boolean {
  return (
    !order.assigned_driver &&
    ["preparing", "ready_for_dispatch", "dispatching"].includes(order.status)
  );
}

export default function AgrimarketDispatchPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [staffRole, setStaffRole] = useState("");
  const [orders, setOrders] = useState<AgrimarketDispatchOrder[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasLoaded, setHasLoaded] = useState(false);
  const loadFlight = useRef(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (loadFlight.current) return;
    loadFlight.current = true;
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agrimarket/admin/dispatch", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to load Agrimarket dispatch.");
      } else if (payload?.ok !== true || typeof payload.enabled !== "boolean" || !Array.isArray(payload.orders)) {
        setError("The order list could not be read. Tap Refresh to try again.");
      } else {
        setHasLoaded(true);
        setEnabled(payload.enabled);
        setStaffRole(String(payload?.staff_role || ""));
        setOrders(Array.isArray(payload?.orders) ? payload.orders : []);
      }
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to load Agrimarket dispatch."));
    } finally {
      loadFlight.current = false;
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (enabled !== true) return;
    const timer = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  async function adminAction(order: AgrimarketDispatchOrder, action: "cancel" | "reassign") {
    const note = window.prompt(action === "cancel" ? "Cancel this order and release its reserved stock. Enter the reason (at least 5 characters):" : "Release this driver/offer and find the next eligible driver. The driver approach fee will be recalculated. Enter the reason (at least 5 characters):");
    if (note == null) return;
    if (note.trim().length < 5 || note.trim().length > 1000) { setError("Enter a reason of 5 to 1000 characters."); return; }
    setBusy(order.order_id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/agrimarket/admin/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        action, order_code: order.order_code, note: note.trim(), expected_status: order.status,
        expected_driver_id: order.assigned_driver?.driver_id || null, expected_offer_id: order.admin_actions?.active_offer_id || null,
      }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.message || payload.error || "Unable to update the order.");
      setMessage(action === "cancel" ? `${order.order_code}: cancelled and reserved stock released.` : `${order.order_code}: previous driver/offer released. ${payload.dispatch?.offered ? "Offered to the next eligible driver." : payload.dispatch?.assigned ? "A driver is assigned." : "Waiting for an eligible driver; automatic matching will retry."}`);
      await load(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to update the order. Refresh before trying again."); }
    finally { setBusy(""); }
  }

  async function resolveIssue(order: AgrimarketDispatchOrder, resolution: string) {
    const note = window.prompt(resolution === "cancel" ? "Why is this order being cancelled? Required cash returns must be confirmed by the driver." : "Confirm the ORIGINAL booked load, price and vehicle have been restored. Describe the correction. Material changes require cancellation and a new booking.");
    if (!note?.trim()) return;
    setBusy(order.order_code); setError("");
    try {
      const response = await fetch("/api/agrimarket/admin/dispatch", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "resolve_pickup_issue", order_code: order.order_code, resolution, note: note.trim() }) });
      const payload = await response.json();
      if (!response.ok || !payload.ok) setError(payload.message || payload.error || "Unable to resolve pickup issue.");
      else await load(true);
    } catch { setError("Unable to resolve pickup issue. Retry after checking the order."); }
    finally { setBusy(""); }
  }

  const summary = useMemo(() => {
    const offered = orders.filter((order) => order.latest_offer?.status === "offered").length;
    const assigned = orders.filter((order) => Boolean(order.assigned_driver)).length;
    const harvest = orders.filter((order) => order.status === "awaiting_harvest").length;
    const overdue = orders.filter((order) => order.harvest_attention === "overdue").length;
    const dueSoon = orders.filter((order) => order.harvest_attention === "due_soon").length;
    const settlement = orders.filter(
      (order) => order.status === "delivered" && order.wallet_settlement_status !== "settled"
    ).length;
    return { offered, assigned, harvest, overdue, dueSoon, settlement };
  }, [orders]);

  async function runDispatch(order: AgrimarketDispatchOrder) {
    setBusy(order.order_id);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/agrimarket/admin/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ action: "offer_next", order_id: order.order_id }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        const code = String(payload?.error || "");
        if (code === "AGRIMARKET_DISPATCH_TOO_EARLY") {
          setMessage(`${order.order_code}: waiting for preparation/road ETA alignment.`);
        } else {
          setError(payload?.message || code || "Unable to run Agrimarket dispatch.");
        }
      } else if (payload?.assigned) {
        setMessage(`${order.order_code}: already assigned to a driver.`);
      } else if (payload?.offered) {
        setMessage(
          `${order.order_code}: offered to the nearest eligible driver at ${Number(payload.pickup_road_distance_km || 0).toFixed(1)} km road distance.`
        );
      } else {
        setMessage(`${order.order_code}: ${titleCase(payload?.error || "no eligible driver available yet")}.`);
      }
      await load(true);
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to run Agrimarket dispatch."));
    }
    setBusy("");
  }

  if (enabled === false) return null;

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-3 text-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">Agrimarket Dispatch</h2>
            <span className="rounded-full bg-emerald-700 px-2 py-0.5 text-[10px] font-bold text-white">
              ROAD ROUTE
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-600">
            Orders appear while waiting for the farmer. Driver matching starts after acceptance and any required customer approval.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-white px-2 py-1">{hasLoaded ? `${orders.length} active` : "Loading orders..."}</span>
          <span className="rounded-full bg-white px-2 py-1">{summary.offered} offered</span>
          <span className="rounded-full bg-white px-2 py-1">{summary.assigned} assigned</span>
          {summary.harvest > 0 ? <span className="rounded-full bg-amber-100 px-2 py-1">{summary.harvest} harvest</span> : null}
          {summary.dueSoon > 0 ? <span className="rounded-full bg-amber-100 px-2 py-1">{summary.dueSoon} starting soon</span> : null}
          {summary.overdue > 0 ? <span role="alert" className="rounded-full bg-rose-700 px-2 py-1 font-bold text-white">{summary.overdue} farmer updates overdue - open to follow up</span> : null}
          {summary.settlement > 0 ? <span className="rounded-full bg-rose-100 px-2 py-1">{summary.settlement} settlement</span> : null}
          <button
            type="button"
            onClick={() => {
              setExpanded((value) => !value);
              if (!expanded) void load();
            }}
            className="rounded-lg border bg-white px-3 py-1.5 font-semibold"
          >
            {expanded ? "Hide" : "Open"}
          </button>
          <button
            type="button"
            onClick={() => load()}
            disabled={loading}
            className="rounded-lg border bg-white px-3 py-1.5 font-semibold disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error ? <div className="mt-2 rounded-xl bg-rose-100 p-2 text-xs text-rose-800">{error}</div> : null}
      {message ? <div className="mt-2 rounded-xl bg-white p-2 text-xs text-emerald-900">{message}</div> : null}

      {expanded ? (
        <div className="mt-3 max-h-[42vh] space-y-2 overflow-y-auto pr-1">
          {!hasLoaded && !error ? (
            <div role="status" className="rounded-xl border bg-white p-4 text-center text-xs text-slate-500">
              Loading Agrimarket orders...
            </div>
          ) : null}
          {hasLoaded && !loading && !error && orders.length === 0 ? (
            <div className="rounded-xl border bg-white p-4 text-center text-xs text-slate-500">
              No active Agrimarket orders.
            </div>
          ) : null}

          {orders.map((order) => {
            const offer = order.latest_offer;
            const canDispatch = dispatchable(order) && staffRole === "admin";
            return (
              <article key={order.order_id} className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">{order.order_code}</p>
                    <p className="font-semibold">{titleCase(order.status)}</p>
                    <p className="text-[11px] text-slate-500">
                      {titleCase(order.fulfillment_mode)} - {titleCase(order.route_plan)}
                    </p>
                  </div>
                  <div className="text-right text-xs">
                    <p className="font-semibold">{money(order.product_subtotal)} products</p>
                    <p className="text-slate-500">{money(order.total_payable)} customer total</p>
                  </div>
                </div>

                <div className="mt-2 space-y-1 break-words text-xs">
                  <p>Customer: <strong>{order.customer?.name || "Name unavailable"}</strong> - Farmer: <strong>{order.farmer_area?.name || "Name unavailable"}</strong></p>
                  <p>Placed {formatDate(order.created_at)} (Philippine time)</p>
                  <p className="text-slate-600">{order.items?.length ? order.items.slice(0, 2).map(item => `${item.quantity ?? "?"} ${item.selling_unit || ""} ${item.product_name || "Unnamed product"}`).join("; ") + (order.items.length > 2 ? `; +${order.items.length - 2} more` : "") : "Item details unavailable"}</p>
                </div>
                <div className="mt-2 grid gap-2 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-500">First pickup</span>
                    <p className="font-semibold">{titleCase(order.assignment_anchor)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-500">Vehicle</span>
                    <p className="font-semibold">{titleCase(order.required_vehicle_type || order.preferred_vehicle_type)}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-500">Farmer area</span>
                    <p className="font-semibold">{order.farmer_area?.barangay ? `${order.farmer_area.barangay}, ` : ""}{order.farmer_area?.town || "-"}</p>
                  </div>
                  <div className="rounded-lg bg-slate-50 p-2">
                    <span className="text-slate-500">Ready</span>
                    <p className="font-semibold">{order.status === "awaiting_customer_reapproval" ? "Paused for customer approval" : order.ready_at ? formatDate(order.ready_at) : "Not ready"}</p>
                  </div>
                </div>

                {order.status === "awaiting_producer" ? (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                    Waiting for farmer acceptance. No driver will be offered this order yet.
                    {order.producer_confirm_expires_at ? ` Farmer reply deadline: ${formatDate(order.producer_confirm_expires_at)}.` : ""}
                  </div>
                ) : null}
                {order.status === "awaiting_customer_reapproval" ? (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                    Waiting for the customer to approve revised charges or vehicle requirements. Driver matching is paused.
                    <ReapprovalCountdown expiresAt={order.customer_reapproval_expires_at} serverNow={order.server_now} />
                    <p>No response within five minutes cancels this order and releases reserved stock.</p>
                  </div>
                ) : null}
                {order.cash_collection_required ? (
                  <div className="mt-2 rounded-lg bg-blue-50 p-2 text-[11px] text-blue-900">
                    Cash-first: driver collects {money(order.cash_collection_amount)} from the customer before the farmer.
                  </div>
                ) : null}

                {order.pickup_issue?.status === "open" ? <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-950">
                  <p className="font-bold">Pickup paused: {order.pickup_issue.reason}</p>
                  <p>Farmer refund: {order.pickup_issue.confirm_farmer_refund ? "Confirmed" : "Not recorded"}. Customer refund: {order.pickup_issue.confirm_customer_refund ? "Confirmed" : "Not recorded"}.</p>
                  <div className="mt-3 flex gap-2"><button type="button" disabled={Boolean(busy)} onClick={() => resolveIssue(order, "restored_to_booking")} className="rounded bg-emerald-700 p-2 text-white disabled:opacity-50">Original booked load restored</button><button type="button" disabled={Boolean(busy)} onClick={() => resolveIssue(order, "cancel")} className="rounded bg-rose-700 p-2 text-white disabled:opacity-50">Cancel after cash returns</button></div>
                </div> : null}
                {order.harvest_attention === "overdue" ? <div role="alert" className="mt-2 rounded-lg border border-rose-400 bg-rose-50 p-3 text-xs font-semibold text-rose-950">Farmer update overdue since {formatDate(order.harvest_expected_end_at)}. Contact the farmer and arrange a confirmed delay or cancellation with the customer. The reservation is still unassigned; do not mark it ready for the farmer.</div> : null}
                {order.harvest_attention === "due_soon" ? <div className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Preparation starts within 30 minutes. Check that the farmer can update this reservation.</div> : null}
                {order.status === "awaiting_harvest" ? (
                  <div className="mt-2 rounded-lg bg-amber-50 p-2 text-[11px] text-amber-900">
                    Harvest reservation confirmed. Expected {formatDate(order.harvest_expected_start_at)}{order.harvest_expected_end_at ? ` to ${formatDate(order.harvest_expected_end_at)}` : ""}. No driver dispatch until farmer marks harvest ready.
                  </div>
                ) : null}

                {offer ? (
                  <div className={`mt-2 rounded-lg p-2 text-[11px] ${offer.status === "offered" ? "bg-indigo-50 text-indigo-900" : "bg-slate-50 text-slate-700"}`}>
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>
                        Latest offer: <strong>{offer.driver_name}</strong> - {titleCase(offer.status)}
                      </span>
                      {offer.status === "offered" ? <strong>{minutes(offer.seconds_remaining)} left</strong> : null}
                    </div>
                    <p className="mt-1">
                      Road pickup {offer.pickup_road_distance_km.toFixed(1)} km - pickup fee {money(offer.pickup_distance_fee)} - ETA {minutes(offer.eta_seconds_to_first_pickup)}
                    </p>
                  </div>
                ) : null}

                {order.assigned_driver ? (
                  <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-[11px] text-emerald-900">
                    Assigned: <strong>{order.assigned_driver.name}</strong>{order.assigned_driver.vehicle_type ? ` - ${titleCase(order.assigned_driver.vehicle_type)}` : ""}
                  </div>
                ) : null}

                {order.status === "delivered" && order.wallet_settlement_status !== "settled" ? (
                  <div className="mt-2 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-900">
                    Delivery complete, settlement {titleCase(order.wallet_settlement_status || "pending")} - {money(order.wallet_settlement_amount)} due from driver wallet.
                    {order.wallet_settlement_error ? ` ${order.wallet_settlement_error}` : ""}
                  </div>
                ) : null}

                <AgrimarketOrderDetails order={order} />
                {staffRole === "admin" ? <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" disabled={Boolean(busy) || !order.admin_actions?.can_cancel} onClick={() => void adminAction(order, "cancel")} className="rounded-lg border border-red-700 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-40">Cancel order</button>
                  <button type="button" disabled={Boolean(busy) || !order.admin_actions?.can_reassign} onClick={() => void adminAction(order, "reassign")} className="rounded-lg border border-indigo-700 px-3 py-2 text-xs font-bold text-indigo-700 disabled:opacity-40">Reassign driver</button>
                  {order.admin_actions?.recovery_required ? <p className="w-full text-xs text-amber-900">Cash or goods have moved, or a pickup issue is open. Resolve the recovery before cancellation or reassignment.</p> : !order.admin_actions?.can_reassign ? <p className="w-full text-xs text-slate-500">Reassignment is available after a driver offer or assignment, before cash collection or pickup.</p> : null}
                </div> : null}

                {canDispatch ? (
                  <button
                    type="button"
                    disabled={busy === order.order_id}
                    onClick={() => runDispatch(order)}
                    className="mt-3 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                  >
                    {busy === order.order_id ? "Checking road-route drivers..." : offer?.status === "offered" ? "Check current offer" : "Run / Retry auto-dispatch"}
                  </button>
                ) : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
