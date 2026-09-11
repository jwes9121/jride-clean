"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVendorOrderSoundQueue } from "./VendorOrderSound";
import { useOrderClock, useVendorIdentity, useVendorOrders } from "./useVendorOrders";
import { acceptDeadline, clean, countdown, isPending, orderKey, shortOrderCode } from "@/lib/vendorOrderWorkflow";

const ROUTES = new Set(["/vendor-portal", "/vendor-orders", "/vendor-analytics"]);
const REVIEW_KEY = "JRIDE_VENDOR_POPUP_REVIEW_UNTIL_V1";
const REMIND_MS = 30000;

function PopupSession({ onOrders }: { onOrders: boolean }) {
  const vendorId = useVendorIdentity();
  const feed = useVendorOrders(vendorId);
  const now = useOrderClock(feed.serverOffset);
  const [reviewedUntil, setReviewedUntil] = useState<Record<string, number>>({});
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    try {
      const saved = JSON.parse(window.sessionStorage.getItem(REVIEW_KEY) || "null");
      setReviewedUntil(saved?.vendorId === vendorId && saved.until ? saved.until : {});
    } catch { setReviewedUntil({}); }
  }, [vendorId]);
  const pending = useMemo(() => feed.orders.filter(order => isPending(order, now)).sort((a,b) => acceptDeadline(a) - acceptDeadline(b)), [feed.orders, now]);
  // Keep the existing sound controller as the only foreground sound owner.
  useVendorOrderSoundQueue(vendorId, pending.map(order => ({ id: orderKey(order), deadline: acceptDeadline(order) - feed.serverOffset })));
  const showPopup = !onOrders && !feed.stale && pending.some(order => (Number(reviewedUntil[orderKey(order)]) || 0) <= now);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (showPopup && dialog && !dialog.open) dialog.showModal();
    return () => { if (dialog?.open) dialog.close(); };
  }, [showPopup]);
  function reviewLater() {
    const until = Object.fromEntries(pending.map(order => [orderKey(order), Math.min(acceptDeadline(order), now + REMIND_MS)]));
    setReviewedUntil(until);
    try { window.sessionStorage.setItem(REVIEW_KEY, JSON.stringify({ vendorId, until })); } catch { /* In-memory reminder remains active. */ }
  }
  if (!now || !vendorId) return null;
  const ordersHref = "/vendor-orders?vendor_id=" + encodeURIComponent(vendorId) + (pending[0] ? "&order_id=" + encodeURIComponent(orderKey(pending[0])) : "");
  return createPortal(<>
    <style>{`
      .jride-incoming-dialog { position:fixed; inset:0 0 auto; margin:max(12px,env(safe-area-inset-top,0px)) auto 0; width:min(480px,calc(100% - 24px)); max-height:calc(100dvh - 24px - env(safe-area-inset-bottom,0px)); padding:0; box-sizing:border-box; border:2px solid #eac45e; border-radius:20px; background:#0c1b24; color:#edf9f5; box-shadow:0 24px 80px #000a; font-family:inherit; overflow:hidden; }
      .jride-incoming-dialog[open] { display:flex; flex-direction:column; }
      .jride-incoming-dialog::backdrop { background:#020c14bd; }
      .jride-incoming-dialog header,.jride-incoming-dialog footer { flex:none; padding:16px; }
      .jride-incoming-dialog header { border-bottom:1px solid #2e444d; }
      .jride-incoming-dialog h2 { margin:0; color:#f9db83; font-size:22px; font-weight:800; }
      .jride-incoming-dialog p { margin:8px 0 0; font-size:14px; line-height:1.5; }
      .jride-incoming-list { overflow-y:auto; min-height:0; padding:12px 16px; overscroll-behavior:contain; }
      .jride-incoming-list article { padding:12px; border:1px solid #34515b; border-radius:12px; margin-bottom:10px; overflow-wrap:anywhere; }
      .jride-incoming-list article>strong { font-size:18px; }
      .jride-incoming-list ul { padding:0; margin:12px 0; list-style:none; }
      .jride-incoming-list li { padding:5px 0; font-size:18px; font-weight:700; }
      .jride-incoming-deadline { color:#f9db83; font-weight:800; }
      .jride-incoming-dialog footer { border-top:1px solid #2e444d; display:grid; gap:8px; }
      .jride-incoming-dialog footer a,.jride-incoming-dialog footer button,.jride-order-strip { display:block; box-sizing:border-box; border:1px solid #42616b; border-radius:12px; padding:12px; background:#162d38; color:#eefbf6; font:inherit; font-weight:700; text-align:center; text-decoration:none; cursor:pointer; min-height:44px; }
      .jride-incoming-dialog footer a { background:#87f4c3; color:#08291d; border-color:#87f4c3; }
      .jride-incoming-dialog :focus-visible,.jride-order-strip :focus-visible { outline:3px solid #f9db83; outline-offset:2px; }
      .jride-order-strip { position:fixed; top:8px; left:12px; right:12px; z-index:2147482999; background:#33280f; border-color:#eac45e; font-size:14px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
      .jride-order-strip a,.jride-order-strip button { color:#f9db83; text-decoration:underline; padding:8px; min-height:44px; }
      @media(max-height:520px) { .jride-incoming-dialog header,.jride-incoming-dialog footer { padding:10px; } .jride-incoming-dialog h2 { font-size:18px; } }
    `}</style>
    {showPopup ? <dialog ref={dialogRef} className="jride-incoming-dialog" aria-labelledby="incoming-order-title" onCancel={event => { event.preventDefault(); reviewLater(); }}>
      <header><h2 id="incoming-order-title">New order</h2><p>{pending.length} order{pending.length === 1 ? "" : "s"} waiting for your response.</p></header>
      <div className="jride-incoming-list">{pending.map(order => <article key={orderKey(order)}>
        <strong>{shortOrderCode(order)} - {clean(order.customer_name) || "Customer"}</strong>
        <p className="jride-incoming-deadline">Accept within {countdown(order, now)}</p>
        {order.items?.length ? <ul>{order.items.map((item,index) => <li key={index}>{Math.max(1,Number(item.quantity) || 1)}x {clean(item.name) || "Item"}</li>)}</ul> : <p>Open Orders to check the item details.</p>}
        {clean(order.customer_note || order.note) ? <p><strong>Note:</strong> {clean(order.customer_note || order.note)}</p> : null}
      </article>)}</div>
      <footer><a href={ordersHref} onClick={reviewLater}>Review and respond</a><button type="button" onClick={reviewLater}>Remind me in 30 seconds</button></footer>
    </dialog> : !onOrders && feed.authRequired ? <div className="jride-order-strip" role="alert"><span>Sign in again to manage orders.</span><a href="/vendor-login">Sign in</a></div> : !onOrders && feed.error ? <div className="jride-order-strip" role="status"><span>Order list is offline or reconnecting.</span><button type="button" disabled={feed.refreshing} onClick={() => void feed.refresh(true)}>Retry</button></div> : !onOrders && pending.length > 0 && !feed.stale ? <a className="jride-order-strip" href={ordersHref}>{pending.length} new order{pending.length === 1 ? "" : "s"} waiting - review now</a> : null}
  </>, document.body);
}

export default function VendorIncomingOrderPopup() {
  const pathname = usePathname();
  return ROUTES.has(pathname) ? <PopupSession key={pathname} onOrders={pathname === "/vendor-orders"} /> : null;
}
