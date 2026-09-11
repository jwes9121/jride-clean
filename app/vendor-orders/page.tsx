"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VendorNavigation from "../components/VendorNavigation";
import { VendorOrderSoundControls } from "../components/VendorOrderSound";
import { useOrderClock, useVendorIdentity, useVendorOrders } from "../components/useVendorOrders";
import { acceptDeadline, canMarkReady, clean, countdown, isClosed, isPending, orderBadge, orderKey, orderStage, orderStatus, shortOrderCode, sortActive, type VendorOrder } from "@/lib/vendorOrderWorkflow";

const REASONS = ["Out of stock", "Store closed", "Item unavailable", "Too many active orders", "Outside delivery service coverage", "Vendor unavailable", "Other"];
function money(value: unknown) { const n = Number(value); return "PHP " + (Number.isFinite(n) ? n : 0).toFixed(2); }
function dateTime(value: unknown) {
  const date = new Date(typeof value === "number" ? value : clean(value));
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(date) : "";
}
function phoneHref(phone: unknown) { const value = clean(phone).replace(/[^+0-9]/g, ""); return value.replace(/\D/g, "").length >= 7 ? "tel:" + value : ""; }

export default function VendorOrdersPage() {
  const vendorId = useVendorIdentity();
  const feed = useVendorOrders(vendorId);
  const now = useOrderClock(feed.serverOffset);
  const [view, setView] = useState<"active" | "history">("active");
  const [savingId, setSavingId] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [rejectOrder, setRejectOrder] = useState<VendorOrder | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [focusId, setFocusId] = useState("");
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const actionLock = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const active = useMemo(() => sortActive(feed.orders, now), [feed.orders, now]);
  const history = useMemo(() => feed.orders.filter(isClosed).sort((a,b) => Date.parse(clean(b.created_at)) - Date.parse(clean(a.created_at))), [feed.orders]);
  const pending = active.filter(order => isPending(order, now));
  const visible = view === "active" ? active : history;

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("order_id");
    if (id) setFocusId(id);
    return () => actionController.current?.abort();
  }, []);
  useEffect(() => {
    if (!focusId || !feed.lastUpdated || feed.stale) return;
    const target = feed.orders.find(order => orderKey(order) === focusId);
    if (!target) return;
    const targetView = isClosed(target) ? "history" : "active";
    if (view !== targetView) { setView(targetView); return; }
    document.getElementById("order-" + focusId)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setFocusId("");
  }, [focusId, view, feed.lastUpdated, feed.stale, feed.orders]);
  useEffect(() => {
    const dialog = rejectDialog.current;
    if (rejectOrder && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [rejectOrder]);
  useEffect(() => {
    if (rejectOrder && feed.orders.some(order => orderKey(order) === orderKey(rejectOrder) && orderStatus(order) !== "vendor_pending")) setRejectOrder(null);
  }, [feed.orders, rejectOrder]);

  async function updateOrder(order: VendorOrder, next: string, cancelReason?: string) {
    if (actionLock.current || feed.stale || feed.authRequired || !vendorId) return;
    if (next === "vendor_accepted" && !isPending(order, Date.now() + feed.serverOffset)) { setActionError("The acceptance window has ended. Refresh Orders."); void feed.refresh(true); return; }
    const id = orderKey(order);
    actionLock.current = true;
    setSavingId(id); setActionError(""); setMessage("");
    const controller = new AbortController();
    actionController.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch("/api/vendor-orders", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ vendor_id: vendorId, order_id: id, vendor_status: next, ...(cancelReason ? { cancel_reason: cancelReason, vendor_cancel_reason: cancelReason } : {}) }), signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok || body?.ok === false) throw new Error(clean(body?.message) || "The update was not confirmed. Refresh Orders before trying again.");
      feed.acknowledge(id, clean(body.vendor_status) || next);
      setRejectOrder(null);
      setMessage(shortOrderCode(order) + (next === "vendor_accepted" ? " accepted. Wait for customer approval before preparing." : next === "pickup_ready" ? " marked ready for pickup." : " declined. The reason has been saved."));
    } catch (error: any) {
      setActionError(error?.name === "AbortError" ? "The response took too long. Checking the order before you try again." : clean(error?.message) || "The update could not be confirmed. Check the refreshed order.");
    } finally {
      window.clearTimeout(timeout);
      await feed.refresh(true);
      actionLock.current = false; setSavingId(""); actionController.current = null;
    }
  }

  return (
    <main className="vendor-workspace vendor-orders-workspace">
      <VendorNavigation active="orders" vendorId={vendorId} />
      <div className="vendor-workspace-content">
        <header className="vendor-orders-heading">
          <div><span className="vendor-eyebrow">YOUR STORE</span><h1>Orders</h1><p>{feed.lastUpdated ? "Updated " + dateTime(feed.lastUpdated) : "Connecting to your order list..."}</p></div>
          <button type="button" className="vendor-button" onClick={() => void feed.refresh(true)} disabled={!vendorId || feed.refreshing}>{feed.refreshing ? "Refreshing..." : "Refresh"}</button>
        </header>
        {!vendorId && now > 0 ? <div className="vendor-notice vendor-notice-error">Sign in to view your store's orders. <a href="/vendor-login">Sign in</a></div> : null}
        {feed.authRequired ? <div className="vendor-notice vendor-notice-error" role="alert">{feed.error} <a className="vendor-button" href="/vendor-login">Sign in again</a></div> : feed.stale && vendorId ? (
          <div className="vendor-order-connection" role="status"><strong>{feed.error ? "Order list needs a connection" : "Updating your orders"}</strong><p>{feed.error || "Checking the latest order status before enabling actions."}</p>{feed.error ? <button type="button" className="vendor-button" onClick={() => void feed.refresh(true)} disabled={feed.refreshing}>Retry now</button> : null}</div>
        ) : null}
        {actionError ? <div className="vendor-notice vendor-notice-error" role="alert">{actionError}</div> : null}
        {message ? <div className="vendor-order-feedback" role="status"><span>{message}</span><button type="button" onClick={() => setMessage("")} aria-label="Dismiss confirmation">Dismiss</button></div> : null}
        {feed.notices.map(notice => <div key={notice.id} className="vendor-order-feedback" role="status"><strong>{notice.title}</strong><button type="button" onClick={() => { setView(notice.closed ? "history" : "active"); setFocusId(notice.orderId); }}>View order</button><button type="button" onClick={() => feed.dismissNotice(notice.id)} aria-label={"Dismiss " + notice.title}>Dismiss</button></div>)}
        <div className="vendor-order-tabs" aria-label="Order list">
          <button type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>Active {feed.lastUpdated ? "(" + active.length + ")" : ""}</button>
          <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>History {feed.lastUpdated ? "(" + history.length + ")" : ""}</button>
        </div>
        {pending.length > 0 && !feed.stale ? <button type="button" className="vendor-waiting-orders" onClick={() => { setView("active"); setFocusId(orderKey(pending[0])); }}>{pending.length} new order{pending.length === 1 ? "" : "s"} waiting - review now</button> : null}
        <details className="vendor-sound-settings"><summary>Order sound settings</summary><VendorOrderSoundControls /></details>
        {!feed.lastUpdated && !feed.authRequired && vendorId ? <div className="vendor-loading-panel" role="status">Loading your orders...<span className="vendor-skeleton-line" /></div> : feed.lastUpdated && visible.length === 0 ? (
          <div className="vendor-orders-empty"><strong>{view === "active" ? "No active orders" : "No order history yet"}</strong><p>{view === "active" ? "New orders will appear here. Completed and cancelled orders are in History." : "Finished orders will stay here for reference."}</p></div>
        ) : <section className="vendor-order-list" aria-label={view === "active" ? "Active orders" : "Order history"} aria-busy={feed.refreshing}>
          {visible.map(order => {
            const id = orderKey(order), status = orderStatus(order), stage = orderStage(order);
            const expired = status === "vendor_pending" && acceptDeadline(order) <= now;
            const items = Array.isArray(order.items) ? order.items : [];
            const driverPhone = phoneHref(order.driver_phone);
            const customerPhone = phoneHref(order.customer_phone);
            const disabled = !!savingId || feed.stale || feed.authRequired;
            return (
              <article key={id} id={"order-" + id} className={"vendor-flow-card vendor-flow-" + (expired ? "danger" : stage.tone)}>
                <header><div><span className="vendor-flow-reference" title={clean(order.booking_code)}>{shortOrderCode(order)}</span><h2>{clean(order.customer_name || order.passenger_name) || "Customer"}</h2></div><span className={"vendor-flow-badge vendor-flow-badge-" + stage.tone}>{expired ? "Expired" : orderBadge(order)}</span></header>
                <p className="vendor-flow-date">{dateTime(order.created_at)}{feed.stale ? " | Last known status - updating" : ""}</p>
                {status === "vendor_pending" ? <div className="vendor-flow-deadline">{expired ? "The 5-minute window has ended. Waiting for the final status." : "Accept within " + countdown(order, now)}</div> : <div className={"vendor-flow-next vendor-flow-next-" + stage.tone}><strong>{stage.title}</strong><p>{stage.note}</p></div>}
                <div className="vendor-flow-items"><h3>Order items</h3>{items.length ? items.map((item,index) => <div className="vendor-flow-item" key={index}><strong><span>{Math.max(1, Number(item.quantity) || 1)}x</span> {clean(item.name) || "Item"}</strong><span>{money((Number(item.price) || 0) * Math.max(1, Number(item.quantity) || 1))}</span></div>) : <p className="vendor-notice-error">Item details are unavailable. Refresh before preparing.</p>}</div>
                {clean(order.customer_note || order.passenger_note || order.note) ? <div className="vendor-flow-instructions"><strong>Customer note</strong><p>{clean(order.customer_note || order.passenger_note || order.note)}</p></div> : null}
                {order.receipt_requested || order.request_vendor_receipt || clean(order.premium_packaging_label) ? <div className="vendor-flow-instructions"><strong>Include with the order</strong>{order.receipt_requested || order.request_vendor_receipt ? <p>Receipt requested</p> : null}{clean(order.premium_packaging_label) ? <p>Packaging: {clean(order.premium_packaging_label)}</p> : null}</div> : null}
                <div className="vendor-flow-subtotal"><span>Items subtotal</span><strong>{money(order.items_subtotal ?? order.total_bill)}</strong></div>
                {!isClosed(order) && (order.driver_id || order.driver_name) ? <div className="vendor-flow-driver"><div><span className="vendor-eyebrow">ASSIGNED DRIVER</span><strong>{clean(order.driver_name) || "Driver details updating"}</strong><span>{clean(order.driver_vehicle_type)}</span></div>{driverPhone ? <a className="vendor-button" href={driverPhone}>Call driver</a> : <span>Phone not available yet</span>}</div> : null}
                {status === "vendor_pending" ? <div className="vendor-flow-actions"><button type="button" className="vendor-button vendor-button-primary" disabled={disabled || expired || !items.length} onClick={() => void updateOrder(order,"vendor_accepted")}>{savingId === id ? "Confirming..." : "Accept order"}</button><button type="button" className="vendor-button vendor-button-danger" disabled={disabled || expired} onClick={() => { setRejectOrder(order); setReason(REASONS[0]); setOtherReason(""); }}>Decline</button></div> : canMarkReady(order) ? <button type="button" className="vendor-button vendor-button-primary vendor-flow-ready" disabled={disabled || !items.length} onClick={() => void updateOrder(order,"pickup_ready")}>{savingId === id ? "Confirming..." : "Mark order ready"}</button> : null}
                <details className="vendor-flow-details"><summary>Order details and contact</summary><p>Reference: {clean(order.booking_code) || id}</p><p>{clean(order.to_label || order.dropoff_label) || "Delivery pin saved for the driver"}</p>{customerPhone ? <a className="vendor-button" href={customerPhone}>Call customer</a> : null}{order.completed_at ? <p>Completed: {dateTime(order.completed_at)}</p> : null}</details>
              </article>
            );
          })}
        </section>}
      </div>
      {rejectOrder ? <dialog ref={rejectDialog} className="vendor-decline-dialog" onCancel={event => { event.preventDefault(); if (!savingId) setRejectOrder(null); }} aria-labelledby="vendor-decline-title"><h2 id="vendor-decline-title">Decline {shortOrderCode(rejectOrder)}?</h2><p>The customer will be informed. Choose the reason.</p><label htmlFor="vendor-decline-reason">Reason</label><select id="vendor-decline-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={!!savingId}>{REASONS.map(value => <option key={value}>{value}</option>)}</select>{reason === "Other" ? <label>Describe the reason<input value={otherReason} onChange={event => setOtherReason(event.target.value)} maxLength={300} disabled={!!savingId} /></label> : null}{actionError ? <p role="alert">{actionError}</p> : null}{feed.stale ? <p role="status">Updating the order. Please wait before confirming.</p> : null}<div className="vendor-flow-actions"><button type="button" className="vendor-button" disabled={!!savingId} onClick={() => setRejectOrder(null)}>Keep order</button><button type="button" className="vendor-button vendor-button-danger" disabled={!!savingId || feed.stale || (reason === "Other" && !clean(otherReason))} onClick={() => void updateOrder(rejectOrder,"cancelled",reason === "Other" ? clean(otherReason) : reason)}>{savingId ? "Confirming..." : "Confirm decline"}</button></div></dialog> : null}
    </main>
  );
}
