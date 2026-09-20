"use client";

import { useFarmerSession } from "./useFarmerSession";
import { farmerSessionHeaders } from "@/lib/agrimarket/farmerSessionClient";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, BadgePercent, CheckCheck, Clock3, PackageCheck, Sprout, Truck } from "lucide-react";
import { FarmerFeedback, FarmerLogin, FarmerUnavailable, FarmerWorkspace } from "./FarmerWorkspace";
import styles from "./farmer.module.css";
import { manilaDateTimeToIso, scheduledActivity, scheduledTitle } from "@/lib/agrimarket/schedule";

type OrderItem = {
  product_id: string;
  product_name: string;
  product_group?: string;
  selling_unit: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  condition_required?: string | null;
  species?: string | null;
  breed?: string | null;
  meat_cut?: string | null;
  processing_form?: string | null;
  cargo_class?: string | null;
};

type HarvestProposal = {
  proposal_type: string;
  proposed_items: any[];
  proposed_harvest_start_at?: string | null;
  proposed_harvest_end_at?: string | null;
  producer_reason?: string | null;
};

type ProducerOrder = {
  customer?: { name: string | null; delivery_label: string | null };
  route_plan?: string | null;
  assignment_anchor?: string | null;
  farmer_to_customer_distance_km?: number | null;
  farmer_to_customer_duration_seconds?: number | null;
  cash_collection_required?: boolean;
  selected_vehicle_type?: string | null;
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
  confirmed_cargo_weight_basis?: "exact" | "approximate" | null;
  confirmed_cargo_weight_kg?: number | null;
  confirmed_cargo_weight_band?: string | null;
  confirmed_handling_tier?: string | null;
  minimum_handling_tier: string;
  product_subtotal: number;
  customer_delivery_fee: number;
  customer_driver_approach_fee: number;
  customer_driver_approach_fee_locked: boolean;
  customer_heavy_load_fee: number;
  customer_special_handling_fee: number;
  customer_total_payable: number;
  customer_approved_total: number;
  customer_reapproval_required: boolean;
  customer_reapproval_proposed_total?: number | null;
  customer_reapproval_proposed_vehicle_type?: string | null;
  producer_paid_at?: string | null;
  producer_paid_amount: number;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  producer_rejected_at?: string | null;
  producer_timeout_at?: string | null;
  producer_confirm_expires_at?: string | null;
  created_at?: string | null;
  items: OrderItem[];
};

const HISTORY_STATUSES = ["completed", "cancelled", "producer_rejected", "producer_timeout"];

function historyOutcome(order: ProducerOrder) {
  if (order.status === "producer_timeout") return {
    label: "Expired",
    reason: "No farmer response was received before the confirmation deadline.",
    at: order.producer_confirm_expires_at || order.producer_timeout_at,
  };
  if (order.status === "producer_rejected") return {
    label: "Declined by farmer",
    reason: order.cancel_reason?.replace(/_/g, " ") || "The farmer could not fulfill this order.",
    at: order.producer_rejected_at,
  };
  if (order.status === "cancelled") return {
    label: "Cancelled",
    reason: order.cancel_reason?.replace(/_/g, " ") || "No cancellation reason was recorded.",
    at: order.cancelled_at,
  };
  return { label: "Completed", reason: "This order was completed.", at: order.completed_at };
}

const PREP_OPTIONS = [0, 10, 15, 20, 30, 45, 60, 90, 120];
const HANDLING_TIERS = ["standard", "bulky", "live_single", "live_difficult"] as const;
const WEIGHT_BANDS = [
  ["1_15", "1-15 kg"],
  ["16_25", "16-25 kg"],
  ["26_50", "26-50 kg"],
  ["51_100", "51-100 kg"],
  ["101_200", "101-200 kg - Kolong-Kolong"],
  ["over_200", "Above 200 kg - not supported"],
] as const;

function allowedHandlingTiers(minimum: string): string[] {
  const index = Math.max(0, HANDLING_TIERS.indexOf(minimum as (typeof HANDLING_TIERS)[number]));
  return HANDLING_TIERS.slice(index);
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
  return manilaDateTimeToIso(value);
}

function titleCase(value: unknown): string {
  const raw = String(value || "").trim();
  if (raw.toLowerCase() === "kolong_kolong") return "Kolong-Kolong";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function AgrimarketProducerPage() {
  const { accessCode, setAccessCode, pin, setPin, sessionCode, restoring, authError, signIn, signOut, invalidate } = useFarmerSession();
  const accountRef = useRef(sessionCode);
  accountRef.current = sessionCode;
  const loadFlight = useRef("");
  const revealedOrder = useRef("");
  const [orderToReveal, setOrderToReveal] = useState<{ id: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [orders, setOrders] = useState<ProducerOrder[]>([]);
  const [setupOnly, setSetupOnly] = useState(false);
  const [filter, setFilter] = useState("all");
  const [historyOrders, setHistoryOrders] = useState<ProducerOrder[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [prep, setPrep] = useState<Record<string, number>>({});
  const [weightBasis, setWeightBasis] = useState<Record<string, "exact" | "approximate">>({});
  const [cargoWeight, setCargoWeight] = useState<Record<string, string>>({});
  const [weightBand, setWeightBand] = useState<Record<string, string>>({});
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
    if (sessionCode) void loadOrders(sessionCode);
    else { setConnected(false); setOrders([]); }
  }, [sessionCode]);

  useEffect(() => {
    if (!connected || disabled || !sessionCode) return;
    const timer = window.setInterval(() => void loadOrders(sessionCode, true), 10000);
    return () => window.clearInterval(timer);
  }, [connected, disabled, sessionCode]);

  function reviewOrder(orderCode: string) {
    if (!/^AG-[A-Z0-9-]+$/i.test(orderCode)) return;
    revealedOrder.current = "";
    setFilter("all");
    setOrderToReveal({ id: `agri-order-${orderCode}` });
  }

  useEffect(() => {
    const readOrderLink = () => {
      const prefix = "#agri-order-";
      if (window.location.hash.startsWith(prefix)) reviewOrder(window.location.hash.slice(prefix.length));
    };
    readOrderLink();
    window.addEventListener("hashchange", readOrderLink);
    return () => window.removeEventListener("hashchange", readOrderLink);
  }, []);

  useEffect(() => {
    const id = orderToReveal?.id;
    if (!id || revealedOrder.current === id || !orders.some(order => `agri-order-${order.order_code}` === id)) return;
    const frame = window.requestAnimationFrame(() => {
      const card = document.getElementById(id);
      if (card) {
        card.scrollIntoView({ block: "start" });
        revealedOrder.current = id;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [orders, orderToReveal]);

  useEffect(() => {
    setHistoryPage(0);
    setHistoryOrders([]);
    setHistoryHasMore(false);
    setHistoryError("");
    setFilter("all");
  }, [sessionCode]);

  useEffect(() => {
    if (filter !== "history" || !sessionCode) return;
    let cancelled = false;
    let pending = false;
    const controller = new AbortController();
    setHistoryOrders([]);
    setHistoryHasMore(false);
    setHistoryLoading(true);
    setHistoryError("");
    async function refreshHistory() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch(`/api/agrimarket/producer/orders?view=history&page=${historyPage}`, {
          cache: "no-store", headers: farmerSessionHeaders(sessionCode), signal: controller.signal,
        });
        const payload = await response.json();
        if (cancelled || accountRef.current !== sessionCode) return;
        if (response.status === 401 || response.status === 403) {
          invalidate();
          setHistoryOrders([]);
          throw new Error("Sign in again to view order history.");
        }
        if (!response.ok || payload?.ok !== true || !Array.isArray(payload.orders)) {
          throw new Error(payload?.message || "Unable to load order history.");
        }
        setHistoryOrders(payload.orders);
        setHistoryHasMore(payload.has_more === true);
        setHistoryError("");
      } catch (cause: any) {
        if (!cancelled) setHistoryError(cause?.message || "Unable to load order history.");
      } finally {
        pending = false;
        if (!cancelled) setHistoryLoading(false);
      }
    }
    void refreshHistory();
    const timer = window.setInterval(() => void refreshHistory(), 10000);
    return () => { cancelled = true; controller.abort(); window.clearInterval(timer); };
  }, [filter, sessionCode, historyPage, historyRefresh]);

  function refreshOrders() {
    void loadOrders();
    setHistoryRefresh((value) => value + 1);
  }

  async function loadOrders(code = sessionCode, quiet = false) {
    if (!code || loadFlight.current === code) return;
    loadFlight.current = code;
    if (!quiet) setLoading(true);
    setError("");
    try {
    const response = await fetch("/api/agrimarket/producer/orders?view=active", { cache: "no-store", headers: farmerSessionHeaders(code) });
    const payload = await response.json().catch(() => ({}));
    if (accountRef.current !== code) return;
    if (["AGRIMARKET_DISABLED", "AGRIMARKET_FARMER_PORTAL_DISABLED"].includes(payload?.error)) {
      setDisabled(true);
      setConnected(false);
    } else if (response.status === 401 || response.status === 403) {
      invalidate();
      setConnected(false);
      setError(payload?.message || "Farmer credentials were not accepted.");
    } else if (!response.ok || payload?.ok === false) {
      setError(payload?.message || payload?.error || "Unable to load farmer orders.");
    } else {
      const rows: ProducerOrder[] = Array.isArray(payload?.orders) ? payload.orders : [];
      setOrders(rows);
      setSetupOnly(payload.setup_only === true);
      setConnected(true);
      setPrep((current) => {
        const next = { ...current };
        rows.forEach((order) => { if (next[order.order_code] == null) next[order.order_code] = order.preparation_minutes ?? 15; });
        return next;
      });
      setWeightBasis((current) => {
        const next = { ...current };
        rows.forEach((order) => {
          if (next[order.order_code] == null) {
            next[order.order_code] = order.confirmed_cargo_weight_basis || "approximate";
          }
        });
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
      setWeightBand((current) => {
        const next = { ...current };
        rows.forEach((order) => {
          if (next[order.order_code] == null) {
            next[order.order_code] = order.confirmed_cargo_weight_band || "";
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
    }
    } catch {
      setError("We couldn’t refresh your orders. Check your connection and try again.");
    } finally {
      if (loadFlight.current === code) loadFlight.current = "";
      if (!quiet) setLoading(false);
    }
  }

  async function post(path: string, body: any, key: string) {
    setBusy(key);
    setError("");
    setMessage("");
    try {
    const response = await fetch(path, { method: "POST", headers: farmerSessionHeaders(sessionCode, true), body: JSON.stringify(body) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload?.ok === false) setError(payload?.message || payload?.error || "Unable to update this order.");
    else {
      setMessage("Order updated.");
      await loadOrders(sessionCode, true);
    }
    } catch {
      setError("The update was interrupted. Refresh the order to check its latest status before trying again.");
    } finally {
      setBusy("");
    }
  }

  async function decide(order: ProducerOrder, decision: "accept" | "reject") {
    const scheduled = order.fulfillment_mode === "scheduled_harvest";
    await post("/api/agrimarket/producer/orders/decision", {
      order_code: order.order_code,
      decision,
      preparation_minutes: decision === "accept" && !scheduled ? prep[order.order_code] ?? 15 : null,
      confirmed_cargo_weight_basis:
        decision === "accept" && !scheduled ? weightBasis[order.order_code] || "approximate" : null,
      confirmed_cargo_weight_kg:
        decision === "accept" && !scheduled && cargoWeight[order.order_code]
          ? Number(cargoWeight[order.order_code])
          : null,
      confirmed_cargo_weight_band:
        decision === "accept" && !scheduled && (weightBasis[order.order_code] || "approximate") === "approximate"
          ? weightBand[order.order_code] || null
          : null,
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
      confirmed_cargo_weight_basis: weightBasis[order.order_code] || "approximate",
      confirmed_cargo_weight_kg: cargoWeight[order.order_code] ? Number(cargoWeight[order.order_code]) : null,
      confirmed_cargo_weight_band:
        (weightBasis[order.order_code] || "approximate") === "approximate"
          ? weightBand[order.order_code] || null
          : null,
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
    return <FarmerUnavailable section="orders" />;
  }

  if (sessionCode && !connected) {
    return <FarmerWorkspace section="orders" accountCode={sessionCode} onSignOut={() => void signOut()} onRefresh={refreshOrders} onReviewOrder={reviewOrder} loading={loading || restoring}>
      <p role="status">{loading ? "Loading your orders..." : "Your orders could not be loaded. Tap Refresh to try again."}</p>
      <FarmerFeedback error={error || authError} />
    </FarmerWorkspace>;
  }

  if (!connected) {
    return <FarmerLogin section="orders" accessCode={accessCode} pin={pin} onCodeChange={setAccessCode} onPinChange={setPin} onSubmit={() => { setError(""); void signIn(); }} loading={loading || restoring} error={error || authError} />;
  }

  const needsReply = orders.filter((order) => order.status === "awaiting_producer");
  const harvest = orders.filter((order) => order.status === "awaiting_harvest");
  const inProgress = orders.filter((order) => !["awaiting_producer", "awaiting_harvest", "completed", "delivered"].includes(order.status));
  const viewingHistory = filter === "history";
  const visibleOrders = viewingHistory ? historyOrders : filter === "new" ? needsReply : filter === "harvest" ? harvest : filter === "progress" ? inProgress : orders;
  const filters = [{ id: "all", label: "Active orders", count: orders.length }, { id: "new", label: "Needs reply", count: needsReply.length }, { id: "progress", label: "In progress", count: inProgress.length }, { id: "harvest", label: "Scheduled", count: harvest.length }, { id: "history", label: "History", count: null }];

  return (
    <FarmerWorkspace section="orders" accountCode={sessionCode} onSignOut={() => void signOut()} onRefresh={refreshOrders} onReviewOrder={reviewOrder} loading={loading || restoring}>
      <section className={styles.ordersHeading} aria-labelledby="farmer-orders-title">
        <div><h1 id="farmer-orders-title">Your orders</h1><p>{setupOnly ? "Farm setup is open. Ordering has not launched yet." : needsReply.length ? "New orders are waiting for your reply." : "Manage active orders and view your history."}</p></div>
        <span>{loading ? "Refreshing..." : "Updates every 10 sec"}</span>
      </section>
      <div className={styles.stats} aria-label="Order overview">
        <div className={styles.stat}><strong>{needsReply.length}</strong><span>Need your reply</span></div>
        <div className={styles.stat}><strong>{inProgress.length}</strong><span>In progress</span></div>
        <div className={styles.stat}><strong>{harvest.length}</strong><span>Scheduled</span></div>
      </div>
      <FarmerFeedback error={error || authError} message={message} />
      <div className={`${styles.filters} ${styles.orderFilters}`} aria-label="Filter orders">{filters.map((item) => <button type="button" key={item.id} onClick={() => setFilter(item.id)} aria-pressed={filter === item.id} className={`${styles.filter} ${filter === item.id ? styles.filterActive : ""}`}>{item.label}{item.count !== null && <span className={styles.filterCount}>{item.count}</span>}</button>)}</div>
      {viewingHistory && <div className="mb-4 text-sm text-slate-600">
        <p>Completed, cancelled, declined and expired orders. Newest bookings first.</p>
        <FarmerFeedback error={historyError} />
        <div className="mt-3 flex items-center gap-3" aria-label="History pages">
          <button type="button" disabled={historyLoading || historyPage === 0} onClick={() => setHistoryPage((value) => value - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Previous</button>
          <span>Page {historyPage + 1}</span>
          <button type="button" disabled={historyLoading || !historyHasMore} onClick={() => setHistoryPage((value) => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Next</button>
        </div>
      </div>}
      <div className={!orders.length && !viewingHistory ? styles.dashboardGrid : undefined}>
        <section className={styles.orderList} aria-label={viewingHistory ? "Order history" : "Farmer orders"} aria-busy={viewingHistory ? historyLoading : loading}>
          {viewingHistory && !visibleOrders.length && <p role="status" className="rounded-xl border bg-white p-5 text-sm text-slate-600">
            {historyLoading ? "Loading order history..." : historyError ? "History could not be refreshed. Tap Refresh to retry." : historyPage > 0 ? "No more orders on this page. Choose Previous." : "No completed, cancelled, declined or expired orders yet."}
          </p>}
          {!viewingHistory && !visibleOrders.length && <div>
            <div className={styles.emptyCard}>
              <span className={styles.emptyIcon}><PackageCheck size={43} /></span>
              <h2>{orders.length ? "You’re all caught up here." : "Room for something good."}</h2>
              <p>{orders.length ? "There are no orders in this view. Choose another filter to see the rest." : "New orders will appear here. For now, give your products a little care and keep your stock up to date."}</p>
              {orders.length ? <button className={styles.primaryButton} onClick={() => setFilter("all")}>See all orders <ArrowUpRight size={17} /></button> : <Link href="/agrimarket/producer/products" className={styles.primaryButton}>Manage my products <ArrowUpRight size={17} /></Link>}
            </div>
            {setupOnly && <div className={styles.setupNotice}><Clock3 size={18} /><div><strong>Your farm setup is open.</strong>You can manage products now. Customer ordering is not open yet.</div></div>}
          </div>}
          {visibleOrders.map((order) => {
            const isHistory = HISTORY_STATUSES.includes(order.status);
            const unfulfilled = isHistory && order.status !== "completed";
            const outcome = historyOutcome(order);
            const scheduled = order.fulfillment_mode === "scheduled_harvest";
            const pendingProposal = order.pending_harvest_proposal;
            const activity = scheduledActivity(order.items);
            return (
              <article id={`agri-order-${order.order_code}`} key={order.order_code} className={styles.orderCard}>
                <div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-emerald-700">{order.order_code}</p><h2 className="mt-1 text-xl font-bold">{scheduled ? scheduledTitle(order.items) : "Agrimarket Order"}</h2></div><span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold">{isHistory ? outcome.label : order.status === "awaiting_harvest" ? "Reservation confirmed" : titleCase(order.status)}</span></div>
                {isHistory && <div className={`mt-3 rounded-xl p-3 text-sm ${unfulfilled ? "bg-amber-50 text-amber-950" : "bg-emerald-50 text-emerald-950"}`}>
                  <p className="font-semibold">{outcome.label}{outcome.at ? ` - ${formatDate(outcome.at)}` : ""}</p>
                  <p>{outcome.reason}</p>
                  {order.created_at && <p className="mt-1 text-xs">Placed {formatDate(order.created_at)}</p>}
                </div>}
                {scheduled ? <div className="mt-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>{scheduledTitle(order.items)} window</strong><br/>{formatDate(order.harvest_expected_start_at)}{order.harvest_expected_end_at ? ` to ${formatDate(order.harvest_expected_end_at)}` : ""}</div> : null}
                <div className="mt-3 space-y-1 break-words text-sm">
                  <p>Customer: <strong>{order.customer?.name || "Name unavailable"}</strong></p>
                  <p>Deliver to: <strong>{order.customer?.delivery_label || "Destination unavailable"}</strong></p>
                  <p className="text-xs text-slate-600">Farm to customer: {order.farmer_to_customer_distance_km == null ? "Distance unavailable" : `${order.farmer_to_customer_distance_km.toFixed(1)} km`}{order.farmer_to_customer_duration_seconds == null ? "" : ` / about ${Math.ceil(order.farmer_to_customer_duration_seconds / 60)} min driving`}</p>
                </div>
                <div className="mt-4 divide-y rounded-xl border">{order.items.map((item) => <div key={item.product_id} className="flex flex-wrap justify-between gap-3 p-3"><div className="min-w-0 break-words"><strong>{item.product_name}</strong><p className="text-xs text-slate-500">{item.quantity} {item.selling_unit} x {money(item.unit_price)}</p><p className="text-xs text-slate-600">{[item.species, item.breed, item.meat_cut, item.processing_form, item.condition_required, item.cargo_class].filter(Boolean).map(titleCase).join(" / ")}</p></div><strong>{money(item.line_total)}</strong></div>)}</div>
                <div className="mt-3 flex justify-between"><span>{unfulfilled ? "Product subtotal (order not fulfilled)" : "Farmer product payment"}</span><strong>{money(order.product_subtotal)}</strong></div>
                <details className="mt-3 rounded-xl border p-3 text-sm">
                  <summary className="cursor-pointer font-semibold">Pickup and order details</summary>
                  <div className="mt-2 space-y-2">
                    <p>Placed: {formatDate(order.created_at)} (Philippine time)</p>
                    <p>Pickup plan: {order.assignment_anchor === "customer" ? "Driver visits customer first to collect cash, then your farm." : order.assignment_anchor === "farmer" ? "Driver visits your farm first, then delivers to the customer." : "Not available"}</p>
                    <p>Required vehicle: <strong>{order.required_vehicle_type === "either" ? "Any eligible vehicle" : titleCase(order.required_vehicle_type) || "Not available"}</strong>{order.selected_vehicle_type ? ` / Selected: ${titleCase(order.selected_vehicle_type)}` : ""}</p>
                    <p>Estimated load: {order.estimated_cargo_weight_kg == null ? "Not available" : `${order.estimated_cargo_weight_kg} kg`}. Minimum handling: {titleCase(order.minimum_handling_tier)}.</p>
                    <p>Farmer payment: {order.producer_paid_at ? `${money(order.producer_paid_amount)} recorded at ${formatDate(order.producer_paid_at)}` : unfulfilled ? "No payment recorded" : `${money(order.product_subtotal)} at pickup; payment not yet recorded.`}</p>
                    {order.cash_collection_required && <p>Cash-first order: the driver collects the customer's cash before coming to your farm.</p>}
                    <p className="text-xs text-slate-600">Driving time is a route estimate, not the driver's arrival time.</p>
                  </div>
                </details>

                {order.status === "awaiting_producer" ? (
                  <div className="mt-4 rounded-2xl bg-blue-50 p-4">
                    <p className="font-bold">Respond within {order.confirmation_seconds_remaining}s</p>
                    {scheduled ? (
                      <p className="mt-1 text-sm">Accept reserves the expected quantity. Actual cargo weight and handling are confirmed later, when the products are ready.</p>
                    ) : (
                      <>
                        <label className="mt-3 block text-sm font-semibold">Preparation time<select value={prep[order.order_code] ?? 15} onChange={(e) => setPrep((current) => ({ ...current, [order.order_code]: Number(e.target.value) }))} className="ml-2 rounded-lg border bg-white px-2 py-2">{PREP_OPTIONS.map((value) => <option key={value} value={value}>{value} min</option>)}</select></label>
                        <div className="mt-3 grid gap-3 rounded-xl border border-blue-200 bg-white p-3 md:grid-cols-2">
                          <p className="text-xs text-slate-600 md:col-span-2">Checkout estimated cargo weight: <strong>{order.estimated_cargo_weight_kg == null ? "Not available" : `${order.estimated_cargo_weight_kg} kg`}</strong></p>
                          <label className="text-sm font-semibold">How are you confirming transport weight?<select value={weightBasis[order.order_code] || "approximate"} onChange={(e) => setWeightBasis((current) => ({ ...current, [order.order_code]: e.target.value as "exact" | "approximate" }))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2"><option value="approximate">Approximate - no weighing scale</option><option value="exact">Exact - weighed</option></select></label>
                          {(weightBasis[order.order_code] || "approximate") === "exact" ? <label className="text-sm font-semibold">Exact total weight (kg)<input type="number" min="0.001" max="200" step="0.001" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label> : <label className="text-sm font-semibold">Approximate total load<select value={weightBand[order.order_code] || ""} onChange={(e) => setWeightBand((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2"><option value="">Choose weight range</option>{WEIGHT_BANDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">You may optionally enter a rough kg estimate below; the selected band remains authoritative.</span><input type="number" min="0.001" step="0.001" placeholder="Optional rough kg estimate" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border px-3 py-2" /></label>}
                          <label className="text-sm font-semibold">Handling classification<select value={handlingTier[order.order_code] || order.minimum_handling_tier || "standard"} onChange={(e) => setHandlingTier((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 w-full rounded-lg border bg-white px-3 py-2">{allowedHandlingTiers(order.minimum_handling_tier).map((tier) => <option key={tier} value={tier}>{titleCase(tier)}</option>)}</select><span className="mt-1 block text-xs font-normal text-slate-500">Minimum from the ordered cargo: {titleCase(order.minimum_handling_tier)}</span></label>
                          <p className="text-xs text-blue-900 md:col-span-2">JRide calculates the Heavy Load Fee and Special Handling Fee from this confirmation. If the customer total increases or a higher-capacity vehicle (Tricycle or Kolong-Kolong) becomes required, driver dispatch waits for the customer to accept the revised charges.</p>
                        </div>
                      </>
                    )}
                    <div className="mt-3 flex gap-2"><button disabled={busy.includes(order.order_code) || (!scheduled && ((weightBasis[order.order_code] || "approximate") === "exact" ? !(Number(cargoWeight[order.order_code]) > 0) : !weightBand[order.order_code] || weightBand[order.order_code] === "over_200"))} onClick={() => decide(order, "accept")} className="rounded-xl bg-emerald-700 px-4 py-2 font-bold text-white disabled:bg-slate-400">{scheduled ? "Accept reservation" : "Accept"}</button><button disabled={busy.includes(order.order_code)} onClick={() => decide(order, "reject")} className="rounded-xl bg-red-700 px-4 py-2 font-bold text-white">Cannot fulfill</button></div>
                  </div>
                ) : null}

                {scheduled && order.status === "awaiting_harvest" ? <div className="mt-4 rounded-2xl border p-4">
                  {pendingProposal ? <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong>Waiting for customer decision</strong><br/>{pendingProposal.proposal_type === "delay" ? `New proposed window: ${formatDate(pendingProposal.proposed_harvest_start_at)}${pendingProposal.proposed_harvest_end_at ? ` to ${formatDate(pendingProposal.proposed_harvest_end_at)}` : ""}` : "A lower quantity has been proposed."}<br/>{pendingProposal.producer_reason || ""}</div> : <>
                    <h3 className="font-bold">{scheduledTitle(order.items)} update</h3>
                    <p className="mt-1 text-xs text-slate-600">Schedule dates use Philippine time.</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-emerald-50 p-3"><p className="text-sm font-semibold">{activity === "butchering" ? "Meat cuts are ready" : "Products are ready"}</p><p className="mt-1 text-xs text-emerald-900">Checkout estimate: {order.estimated_cargo_weight_kg == null ? "Estimated cargo weight unavailable - farmer will confirm the load before dispatch." : `${order.estimated_cargo_weight_kg} kg`}</p><select value={prep[order.order_code] ?? 15} onChange={(e) => setPrep((current) => ({ ...current, [order.order_code]: Number(e.target.value) }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2">{PREP_OPTIONS.map((value) => <option key={value} value={value}>{value} min prep</option>)}</select><select value={weightBasis[order.order_code] || "approximate"} onChange={(e) => setWeightBasis((current) => ({ ...current, [order.order_code]: e.target.value as "exact" | "approximate" }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2"><option value="approximate">Approximate - no weighing scale</option><option value="exact">Exact - weighed</option></select>{(weightBasis[order.order_code] || "approximate") === "exact" ? <input type="number" min="0.001" max="200" step="0.001" placeholder="Exact total weight (kg)" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2"/> : <><select value={weightBand[order.order_code] || ""} onChange={(e) => setWeightBand((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2"><option value="">Choose approximate range</option>{WEIGHT_BANDS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><input type="number" min="0.001" step="0.001" placeholder="Optional rough kg estimate" value={cargoWeight[order.order_code] ?? ""} onChange={(e) => setCargoWeight((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2"/></>}<select value={handlingTier[order.order_code] || order.minimum_handling_tier || "standard"} onChange={(e) => setHandlingTier((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border bg-white px-2 py-2">{allowedHandlingTiers(order.minimum_handling_tier).map((tier) => <option key={tier} value={tier}>{titleCase(tier)}</option>)}</select><p className="mt-1 text-xs text-emerald-900">Minimum handling: {titleCase(order.minimum_handling_tier)}</p><p className="mt-2 text-xs text-emerald-900">These confirmed values set Heavy Load and Special Handling charges before dispatch. Any increase or vehicle escalation to Tricycle or Kolong-Kolong is sent to the customer for approval first.</p><button disabled={(weightBasis[order.order_code] || "approximate") === "exact" ? !(Number(cargoWeight[order.order_code]) > 0) : !weightBand[order.order_code] || weightBand[order.order_code] === "over_200"} onClick={() => harvestReady(order)} className="mt-2 w-full rounded-lg bg-emerald-700 px-3 py-2 font-bold text-white disabled:bg-slate-400">Mark ready</button></div>
                      <div className="rounded-xl bg-blue-50 p-3"><p className="text-sm font-semibold">{scheduledTitle(order.items)} delayed</p><input type="datetime-local" value={delayStart[order.order_code] || ""} onChange={(e) => setDelayStart((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border px-2 py-2"/><input type="datetime-local" value={delayEnd[order.order_code] || ""} onChange={(e) => setDelayEnd((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-2 w-full rounded-lg border px-2 py-2"/><button onClick={() => proposeDelay(order)} className="mt-2 w-full rounded-lg bg-blue-800 px-3 py-2 font-bold text-white">Propose new date</button></div>
                      <div className="rounded-xl bg-amber-50 p-3"><p className="text-sm font-semibold">Quantity is short</p>{order.items.map((item) => <label key={item.product_id} className="mt-2 block text-xs">{item.product_name}<input type="number" min="0" max={item.quantity} step="0.01" value={shortfall[order.order_code]?.[item.product_id] ?? String(item.quantity)} onChange={(e) => setShortfall((current) => ({ ...current, [order.order_code]: { ...(current[order.order_code] || {}), [item.product_id]: e.target.value } }))} className="mt-1 w-full rounded-lg border px-2 py-2"/></label>)}<button onClick={() => proposeShortfall(order)} className="mt-2 w-full rounded-lg bg-amber-700 px-3 py-2 font-bold text-white">Propose lower quantity</button></div>
                    </div>
                    <label className="mt-3 block text-sm font-semibold">Reason / note<textarea value={reason[order.order_code] || ""} onChange={(e) => setReason((current) => ({ ...current, [order.order_code]: e.target.value }))} className="mt-1 min-h-16 w-full rounded-xl border px-3 py-2" /></label>
                  </>}
                </div> : null}

                {["preparing", "awaiting_customer_reapproval", "ready_for_dispatch", "dispatching", "driver_assigned", "picked_up", "delivering", "delivered", "completed"].includes(order.status) ? <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm"><strong>{order.status === "preparing" ? "Preparing for driver pickup" : order.status === "awaiting_customer_reapproval" ? "Waiting for customer to approve revised charges" : titleCase(order.status)}</strong>{order.ready_at ? <><br/>Ready target: {formatDate(order.ready_at)}</> : null}{order.confirmed_cargo_weight_basis ? <><br/>Confirmed cargo: {order.confirmed_cargo_weight_basis === "exact" ? `${order.confirmed_cargo_weight_kg ?? "?"} kg exact` : `${String(order.confirmed_cargo_weight_band || "").replace(/_/g, "-")} kg approximate`} - {titleCase(order.confirmed_handling_tier || "")}</> : null}{order.producer_paid_at ? <><br/>Farmer paid: {money(order.producer_paid_amount)}</> : null}</div> : null}

                {!unfulfilled && order.confirmed_cargo_weight_basis ? <div className="mt-3 rounded-xl border bg-white p-3 text-sm"><p className="font-semibold">Customer charge impact after your confirmation</p><div className="mt-2 grid gap-1 sm:grid-cols-2"><p>Delivery: <strong>{money(order.customer_delivery_fee)}</strong></p><p>Heavy Load Fee: <strong>{money(order.customer_heavy_load_fee)}</strong></p><p>Special Handling Fee: <strong>{money(order.customer_special_handling_fee)}</strong></p><p>Driver Approach Fee: <strong>{order.customer_driver_approach_fee_locked ? money(order.customer_driver_approach_fee) : "Pending driver assignment"}</strong></p></div><p className="mt-2">Current customer total: <strong>{money(order.customer_total_payable)}</strong>{!order.customer_driver_approach_fee_locked ? " before final Driver Approach Fee" : ""}</p>{order.customer_reapproval_required ? <p className="mt-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">Waiting for customer approval: {money(order.customer_approved_total)} to {money(order.customer_reapproval_proposed_total ?? order.customer_total_payable)}{order.customer_reapproval_proposed_vehicle_type === "tricycle"
  ? " and Tricycle required"
  : order.customer_reapproval_proposed_vehicle_type === "kolong_kolong"
    ? " and Kolong-Kolong required"
    : ""}. No driver dispatch until the customer responds.</p> : null}</div> : null}
              </article>
            );
          })}
        </section>
        {!orders.length && !viewingHistory && <aside className={styles.stepsCard}>
          <h2>A little guide for your first order</h2>
          <div className={styles.step}><span className={styles.stepIcon}><CheckCheck size={18} /></span><div><h3>Confirm what you can supply</h3><p>Review the items and let your customer know you’re ready to prepare.</p></div></div>
          <div className={styles.step}><span className={styles.stepIcon}><Sprout size={18} /></span><div><h3>Prepare your products</h3><p>Confirm the load and pack everything for a smooth pickup.</p></div></div>
          <div className={styles.step}><span className={styles.stepIcon}><Truck size={18} /></span><div><h3>Hand over to the driver</h3><p>Receive your product payment at pickup. JRide takes care of the delivery.</p></div></div>
          <div className={styles.benefit}><BadgePercent size={25} /><div><strong>Your hard work. Your full product subtotal.</strong><p>Free listing and 0% farmer deduction during the free launch period.</p></div></div>
        </aside>}
      </div>
    </FarmerWorkspace>
  );
}
