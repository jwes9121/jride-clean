"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type AgrimarketDispatchOrder = {
  order_id: string;
  order_code: string;
  status: string;
  fulfillment_mode: string;
  harvest_expected_start_at?: string | null;
  harvest_expected_end_at?: string | null;
  harvest_ready_at?: string | null;
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
  farmer_area?: { town?: string | null; barangay?: string | null } | null;
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
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/agrimarket/admin/dispatch", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.ok === false) {
        setError(payload?.message || payload?.error || "Unable to load Agrimarket dispatch.");
      } else {
        setEnabled(Boolean(payload?.enabled));
        setStaffRole(String(payload?.staff_role || ""));
        setOrders(Array.isArray(payload?.orders) ? payload.orders : []);
      }
    } catch (cause: any) {
      setError(String(cause?.message || "Unable to load Agrimarket dispatch."));
    }
    if (!quiet) setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (enabled !== true) return;
    const timer = window.setInterval(() => void load(true), 10000);
    return () => window.clearInterval(timer);
  }, [enabled, load]);

  const summary = useMemo(() => {
    const offered = orders.filter((order) => order.latest_offer?.status === "offered").length;
    const assigned = orders.filter((order) => Boolean(order.assigned_driver)).length;
    const harvest = orders.filter((order) => order.status === "awaiting_harvest").length;
    const settlement = orders.filter(
      (order) => order.status === "delivered" && order.wallet_settlement_status !== "settled"
    ).length;
    return { offered, assigned, harvest, settlement };
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
            Separate server-side dispatcher. It does not use the Haversine Smart Auto Assign ranking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-white px-2 py-1">{orders.length} active</span>
          <span className="rounded-full bg-white px-2 py-1">{summary.offered} offered</span>
          <span className="rounded-full bg-white px-2 py-1">{summary.assigned} assigned</span>
          {summary.harvest > 0 ? <span className="rounded-full bg-amber-100 px-2 py-1">{summary.harvest} harvest</span> : null}
          {summary.settlement > 0 ? <span className="rounded-full bg-rose-100 px-2 py-1">{summary.settlement} settlement</span> : null}
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
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
          {orders.length === 0 ? (
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
                    <p className="font-semibold">{order.ready_at ? formatDate(order.ready_at) : "Not ready"}</p>
                  </div>
                </div>

                {order.cash_collection_required ? (
                  <div className="mt-2 rounded-lg bg-blue-50 p-2 text-[11px] text-blue-900">
                    Cash-first: driver collects {money(order.cash_collection_amount)} from the customer before the farmer.
                  </div>
                ) : null}

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
