"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import VendorNavigation from "../components/VendorNavigation";
import VendorOrderFocus from "../components/VendorOrderFocus";
import { VendorOrderSoundControls } from "../components/VendorOrderSound";
import { useOrderClock, useVendorIdentity, useVendorOrders } from "../components/useVendorOrders";
import { acceptDeadline, canMarkReady, clean, countdown, isClosed, isPending, orderBadge, orderFreshness, orderKey, orderStage, orderStatus, selectedActiveOrder, shortOrderCode, sortActive, type VendorOrder } from "@/lib/vendorOrderWorkflow";

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
  const [selectedId, setSelectedId] = useState("");
  const [rejectOrder, setRejectOrder] = useState<VendorOrder | null>(null);
  const [reason, setReason] = useState(REASONS[0]);
  const [otherReason, setOtherReason] = useState("");
  const [focusId, setFocusId] = useState("");
  const rejectDialog = useRef<HTMLDialogElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const topPanel = useRef<HTMLDivElement>(null);
  const actionLock = useRef(false);
  const actionController = useRef<AbortController | null>(null);
  const active = useMemo(() => sortActive(feed.orders, now), [feed.orders, now]);
  const history = useMemo(() => feed.orders.filter(isClosed).sort((a,b) => Date.parse(clean(b.created_at)) - Date.parse(clean(a.created_at))), [feed.orders]);
  const pending = active.filter(order => isPending(order, now));
  const selected = selectedActiveOrder(active, selectedId);
  const selectedKey = selected ? orderKey(selected) : "";
  const visible = view === "active" ? (selected ? [selected] : []) : history;
  const otherPending = pending.filter(order => orderKey(order) !== selectedKey);
  const otherReady = active.filter(order => orderKey(order) !== selectedKey && canMarkReady(order));
  const closedNotices = feed.notices.filter(notice => notice.closed);
  const latestClosed = closedNotices[closedNotices.length - 1];
  const finishedOrder = latestClosed ? feed.orders.find(order => orderKey(order) === latestClosed.orderId) : null;
  const actionsDisabled = !!savingId || feed.stale || feed.authRequired;
  const freshness = orderFreshness(feed.lastUpdated, now - feed.serverOffset, feed.stale, feed.refreshing);

  function openOrder(id: string) { setSelectedId(id); setFocusId(id); }
  function showItems() {
    document.getElementById("order-" + selectedKey)?.scrollIntoView({ block: "start", behavior: "smooth" });
  }
  function beginDecline(order: VendorOrder) { setRejectOrder(order); setReason(REASONS[0]); setOtherReason(""); }

  useEffect(() => {
    const panel = topPanel.current;
    if (!panel) return;
    const measure = () => workspace.current?.style.setProperty("--vendor-orders-top-height", Math.ceil(panel.getBoundingClientRect().height) + "px");
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(panel);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

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
    if (!isClosed(target) && selectedKey !== focusId) { setSelectedId(focusId); return; }
    document.getElementById("order-" + focusId)?.scrollIntoView({ block: "start", behavior: "smooth" });
    setFocusId("");
  }, [focusId, view, selectedKey, feed.lastUpdated, feed.stale, feed.orders]);
  useEffect(() => {
    // Pin the initially chosen order too; a new arrival must not steal the controls.
    if (selectedKey && selectedKey !== selectedId) setSelectedId(selectedKey);
  }, [selectedKey, selectedId]);
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
    if (next === "vendor_accepted" && !isPending(order, Date.now() + feed.serverOffset)) { setActionError(shortOrderCode(order) + ": The acceptance window has ended. Refresh Orders."); void feed.refresh(true); return; }
    const id = orderKey(order);
    actionLock.current = true;
    setSavingId(id); setActionError("");
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
    } catch (error: any) {
      setActionError(shortOrderCode(order) + ": " + (error?.name === "AbortError" ? "The response took too long. Checking the order before you try again." : clean(error?.message) || "The update could not be confirmed. Check the refreshed order."));
    } finally {
      window.clearTimeout(timeout);
      await feed.refresh(true);
      actionLock.current = false; setSavingId(""); actionController.current = null;
    }
  }

  return (
    <main ref={workspace} className="vendor-workspace vendor-orders-workspace">
      <div ref={topPanel} className="vendor-orders-top">
        <VendorNavigation active="orders" vendorId={vendorId} />
        <div className="vendor-orders-top-content">
          <h1 className="vendor-visually-hidden">Orders</h1>
          <div className="vendor-orders-controls">
            <div className="vendor-order-tabs" aria-label="Order list">
              <button type="button" aria-pressed={view === "active"} onClick={() => setView("active")}>Active{feed.lastUpdated ? " (" + active.length + ")" : ""}</button>
              <button type="button" aria-pressed={view === "history"} onClick={() => setView("history")}>History{feed.lastUpdated ? " (" + history.length + ")" : ""}</button>
            </div>
            <button type="button" className="vendor-button vendor-orders-refresh" aria-label="Refresh orders" onClick={() => void feed.refresh(true)} disabled={!vendorId || feed.refreshing}>{feed.refreshing ? "Updating" : "Refresh"}</button>
          </div>
          <p className={"vendor-orders-freshness" + (feed.stale ? " is-stale" : "")} aria-live="off">{feed.stale && vendorId ? (feed.authRequired ? "Sign in required - actions paused" : feed.error ? "Connection lost - actions paused" : "Updating - actions paused") : freshness}</p>
          {view === "active" && selected ? <VendorOrderFocus order={selected} active={active} now={now} disabled={actionsDisabled} savingId={savingId} driverPhone={phoneHref(selected.driver_phone)} onSelect={openOrder} onAccept={() => void updateOrder(selected,"vendor_accepted")} onDecline={() => beginDecline(selected)} onReady={() => void updateOrder(selected,"pickup_ready")} onItems={showItems} /> : null}
          {view === "active" && !selected && finishedOrder && latestClosed ? <div className={"vendor-completion-summary vendor-focus-" + orderStage(finishedOrder).tone} role="status"><strong>{latestClosed.title}</strong><p>{orderStatus(finishedOrder) === "completed" ? "Delivery complete. This order is saved in History." : orderStage(finishedOrder).note}</p>{finishedOrder.completed_at ? <p>Completed {dateTime(finishedOrder.completed_at)}</p> : null}<div><button type="button" className="vendor-button" onClick={() => setFocusId(latestClosed.orderId)}>{orderStatus(finishedOrder) === "completed" ? "View completed order" : "View order"}</button><button type="button" className="vendor-button" aria-label={"Dismiss " + latestClosed.title} onClick={() => feed.dismissNotice(latestClosed.id)}>Dismiss</button></div></div> : null}
          {view === "history" && !feed.stale && pending.length > 0 ? <button type="button" className="vendor-focus-attention" disabled={!!savingId} onClick={() => openOrder(orderKey(pending[0]))}>{pending.length} new order{pending.length === 1 ? "" : "s"} - review now</button> : view === "active" && !feed.stale && otherPending.length > 0 ? <button type="button" className="vendor-focus-attention" disabled={!!savingId} onClick={() => openOrder(orderKey(otherPending[0]))}>{otherPending.length} other new order{otherPending.length === 1 ? "" : "s"} - review now</button> : view === "active" && !feed.stale && otherReady.length > 0 ? <button type="button" className="vendor-focus-attention" disabled={!!savingId} onClick={() => openOrder(orderKey(otherReady[0]))}>{shortOrderCode(otherReady[0])} approved - open to prepare</button> : null}
          {actionError ? <div className="vendor-focus-error" role="alert">{actionError}<button type="button" onClick={() => setActionError("")}>Dismiss</button></div> : null}
        </div>
      </div>
      <div className="vendor-workspace-content">
        {feed.stale && vendorId && !feed.authRequired && feed.error ? <p className="vendor-focus-connection" role="status">Connection lost. Order actions are paused until updates resume.</p> : null}
        {!vendorId && now > 0 ? <div className="vendor-notice vendor-notice-error">Sign in to view your store's orders. <a href="/vendor-login">Sign in</a></div> : null}
        {feed.authRequired ? <div className="vendor-notice vendor-notice-error" role="alert">{feed.error} <a className="vendor-button" href="/vendor-login">Sign in again</a></div> : null}
        {view === "active" && selected && latestClosed ? <div className="vendor-recent-completion" role="status"><strong>{latestClosed.title}</strong><button type="button" className="vendor-button" onClick={() => setFocusId(latestClosed.orderId)}>View order</button><button type="button" className="vendor-button" aria-label={"Dismiss " + latestClosed.title} onClick={() => feed.dismissNotice(latestClosed.id)}>Dismiss</button></div> : null}
        {!feed.lastUpdated && !feed.authRequired && vendorId ? <div className="vendor-loading-panel" role="status">Loading your orders...<span className="vendor-skeleton-line" /></div> : feed.lastUpdated && visible.length === 0 ? (
          <div className="vendor-orders-empty"><strong>{view === "active" ? "No active orders" : "No order history yet"}</strong><p>{view === "active" ? "New orders will appear here. Completed and cancelled orders are in History." : "Finished orders will stay here for reference."}</p></div>
        ) : <section className="vendor-order-list" aria-label={view === "active" ? "Active orders" : "Order history"} aria-busy={feed.refreshing}>
          {visible.map(order => {
            const id = orderKey(order), status = orderStatus(order), stage = orderStage(order);
            const expired = status === "vendor_pending" && acceptDeadline(order) <= now;
            const items = Array.isArray(order.items) ? order.items : [];
            const driverPhone = phoneHref(order.driver_phone);
            const customerPhone = phoneHref(order.customer_phone);
            const focused = view === "active" && id === selectedKey;
            return (
              <article key={id} id={"order-" + id} className={"vendor-flow-card vendor-flow-" + (expired ? "danger" : stage.tone)}>
                <header><div><span className="vendor-flow-reference" title={clean(order.booking_code)}>{shortOrderCode(order)}</span><h2>{focused ? "Items and handoff" : clean(order.customer_name || order.passenger_name) || "Customer"}</h2></div>{!focused ? <span className={"vendor-flow-badge vendor-flow-badge-" + stage.tone}>{expired ? "Expired" : orderBadge(order)}</span> : null}</header>
                <p className="vendor-flow-date">{dateTime(order.created_at)}{feed.stale ? " | Last known status - updating" : ""}</p>
                {!focused ? (status === "vendor_pending" ? <div className="vendor-flow-deadline">{expired ? "The 5-minute window has ended. Waiting for the final status." : "Accept within " + countdown(order, now)}</div> : <div className={"vendor-flow-next vendor-flow-next-" + stage.tone}><strong>{stage.title}</strong><p>{stage.note}</p></div>) : null}
                <div className="vendor-flow-items"><h3>Order items</h3>{items.length ? items.map((item,index) => <div className="vendor-flow-item" key={index}><strong><span>{Math.max(1, Number(item.quantity) || 1)}x</span> {clean(item.name) || "Item"}</strong><span>{money((Number(item.price) || 0) * Math.max(1, Number(item.quantity) || 1))}</span></div>) : <p className="vendor-notice-error">Item details are unavailable. Refresh before preparing.</p>}</div>
                {clean(order.customer_note || order.passenger_note || order.note) ? <div className="vendor-flow-instructions"><strong>Customer note</strong><p>{clean(order.customer_note || order.passenger_note || order.note)}</p></div> : null}
                {order.receipt_requested || order.request_vendor_receipt || clean(order.premium_packaging_label) ? <div className="vendor-flow-instructions"><strong>Include with the order</strong>{order.receipt_requested || order.request_vendor_receipt ? <p>Receipt requested</p> : null}{clean(order.premium_packaging_label) ? <p>Packaging: {clean(order.premium_packaging_label)}</p> : null}</div> : null}
                <div className="vendor-flow-subtotal"><span>Items subtotal</span><strong>{money(order.items_subtotal ?? order.total_bill)}</strong></div>
                {!isClosed(order) && (order.driver_id || order.driver_name) ? <div className="vendor-flow-driver"><div><span className="vendor-eyebrow">ASSIGNED DRIVER</span><strong>{clean(order.driver_name) || "Driver details updating"}</strong><span>{clean(order.driver_vehicle_type)}</span></div>{driverPhone ? <a className="vendor-button" href={driverPhone}>Call driver</a> : <span>Phone not available yet</span>}</div> : null}
                <details className="vendor-flow-details"><summary>Order details and contact</summary><p>Reference: {clean(order.booking_code) || id}</p><p>{clean(order.to_label || order.dropoff_label) || "Delivery pin saved for the driver"}</p>{customerPhone ? <a className="vendor-button" href={customerPhone}>Call customer</a> : null}{order.completed_at ? <p>Completed: {dateTime(order.completed_at)}</p> : null}</details>
              </article>
            );
          })}
        </section>}
        {view === "active" && active.length > 1 ? <section className="vendor-other-orders" aria-label="Other active orders"><h2>Other active orders</h2>{active.filter(order => orderKey(order) !== selectedKey).map(order => <button type="button" key={orderKey(order)} onClick={() => openOrder(orderKey(order))} disabled={!!savingId}><span><strong>{shortOrderCode(order)} - {clean(order.customer_name || order.passenger_name) || "Customer"}</strong><span>{orderBadge(order)}{isPending(order, now) ? " - accept within " + countdown(order, now) : ""}</span></span><span>Open order</span></button>)}</section> : null}
        <details className="vendor-sound-settings"><summary>Order sound settings</summary><VendorOrderSoundControls /></details>
      </div>
      {rejectOrder ? <dialog ref={rejectDialog} className="vendor-decline-dialog" onCancel={event => { event.preventDefault(); if (!savingId) setRejectOrder(null); }} aria-labelledby="vendor-decline-title"><h2 id="vendor-decline-title">Decline {shortOrderCode(rejectOrder)}?</h2><p>The customer will be informed. Choose the reason.</p><label htmlFor="vendor-decline-reason">Reason</label><select id="vendor-decline-reason" value={reason} onChange={event => setReason(event.target.value)} disabled={!!savingId}>{REASONS.map(value => <option key={value}>{value}</option>)}</select>{reason === "Other" ? <label>Describe the reason<input value={otherReason} onChange={event => setOtherReason(event.target.value)} maxLength={300} disabled={!!savingId} /></label> : null}{actionError ? <p role="alert">{actionError}</p> : null}{feed.stale ? <p role="status">Updating the order. Please wait before confirming.</p> : null}<div className="vendor-flow-actions"><button type="button" className="vendor-button" disabled={!!savingId} onClick={() => setRejectOrder(null)}>Keep order</button><button type="button" className="vendor-button vendor-button-danger" disabled={!!savingId || feed.stale || (reason === "Other" && !clean(otherReason))} onClick={() => void updateOrder(rejectOrder,"cancelled",reason === "Other" ? clean(otherReason) : reason)}>{savingId ? "Confirming..." : "Confirm decline"}</button></div></dialog> : null}
    </main>
  );
}
