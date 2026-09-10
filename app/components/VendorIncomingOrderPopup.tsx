"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const ROUTES = new Set(["/vendor-portal", "/vendor-orders", "/vendor-analytics"]);
const VENDOR_KEYS = ["JRIDE_VENDOR_PORTAL_VENDOR_ID", "jride_vendor_id", "JRIDE_VENDOR_ID", "vendor_id", "JRIDE_TAKEOUT_VENDOR_ID"];
const ACCEPT_WINDOW_MS = 5 * 60 * 1000;
const POLL_MS = 8000;
const REMIND_MS = 30000;
const REVIEW_KEY = "JRIDE_VENDOR_POPUP_REVIEW_UNTIL_V1";

type IncomingOrder = {
  id?: string | null;
  order_id?: string | null;
  booking_id?: string | null;
  booking_code?: string | null;
  vendor_id?: string | null;
  vendor_status?: string | null;
  status?: string | null;
  created_at?: string | null;
  customer_name?: string | null;
  items?: Array<{ name?: string; quantity?: number | string }> | null;
};

type Snapshot = { vendorId: string; orders: IncomingOrder[] };
const clean = (value: unknown) => String(value ?? "").trim();
const orderKey = (order: IncomingOrder) => clean(order.id || order.order_id || order.booking_id || order.booking_code);

function readVendorId(): string {
  const query = clean(new URLSearchParams(window.location.search).get("vendor_id"));
  if (query) return query;
  try {
    for (const key of VENDOR_KEYS) {
      const value = clean(window.sessionStorage.getItem(key) || window.localStorage.getItem(key));
      if (value) return value;
    }
  } catch {
    // The authenticated API remains authoritative; do not guess an identity.
  }
  return "";
}

function deadline(order: IncomingOrder): number {
  const created = Date.parse(clean(order.created_at));
  // Do not restart a five-minute timer on each poll when a timestamp is missing.
  return Number.isFinite(created) ? created + ACCEPT_WINDOW_MS : 0;
}

function pendingOrders(snapshot: Snapshot, now: number): IncomingOrder[] {
  return snapshot.orders.filter((order) => {
    const state = clean(order.vendor_status).toLowerCase();
    const terminal = clean(order.status).toLowerCase();
    return Boolean(orderKey(order)) && (!order.vendor_id || order.vendor_id === snapshot.vendorId) &&
      ["", "requested", "vendor_pending"].includes(state) &&
      !["cancelled", "canceled", "completed", "vendor_timeout", "expired"].includes(terminal) &&
      deadline(order) > now;
  }).sort((a, b) => deadline(a) - deadline(b));
}

function countdown(order: IncomingOrder, now: number): string {
  const seconds = Math.max(0, Math.ceil((deadline(order) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function readReviewed(vendorId: string): Record<string, number> {
  try {
    const value = JSON.parse(window.sessionStorage.getItem(REVIEW_KEY) || "null");
    if (value?.vendorId === vendorId && value.until && typeof value.until === "object") {
      return Object.fromEntries(Object.entries(value.until).filter((entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]) && entry[1] > Date.now(),
      ));
    }
  } catch {
    // Session storage is optional. The popup still works without it.
  }
  return {};
}

function PopupSession() {
  const [snapshot, setSnapshot] = useState<Snapshot>({ vendorId: "", orders: [] });
  const [now, setNow] = useState(0);
  const [reviewedUntil, setReviewedUntil] = useState<Record<string, number>>({});
  const [loadError, setLoadError] = useState("");
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    let currentVendor = "";
    let controller: AbortController | null = null;

    async function refresh() {
      if (stopped || document.visibilityState === "hidden" || inFlight) return;
      const vendorId = readVendorId();
      if (vendorId !== currentVendor) {
        currentVendor = vendorId;
        setSnapshot({ vendorId, orders: [] });
        setReviewedUntil(readReviewed(vendorId));
        setLoadError("");
      }
      if (!vendorId) return;
      inFlight = true;
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch(`/api/vendor-orders?vendor_id=${encodeURIComponent(vendorId)}`, {
          cache: "no-store", credentials: "same-origin", headers: { Accept: "application/json" }, signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok || body?.ok === false || !Array.isArray(body?.orders)) throw new Error("Orders unavailable");
        if (!stopped && vendorId === readVendorId()) {
          setSnapshot({ vendorId, orders: body.orders });
          setLoadError("");
          setNow(Date.now());
        }
      } catch {
        if (!stopped && vendorId === readVendorId()) setLoadError("Order alerts cannot refresh. Check your connection and open Orders.");
      } finally {
        window.clearTimeout(timeout);
        inFlight = false;
      }
    }

    const onVisible = () => { void refresh(); };
    setNow(Date.now());
    void refresh();
    const poll = window.setInterval(onVisible, POLL_MS);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    window.addEventListener("focus", onVisible);
    window.addEventListener("storage", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      controller?.abort();
      window.clearInterval(poll);
      window.clearInterval(clock);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("storage", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const pending = useMemo(() => pendingOrders(snapshot, now), [snapshot, now]);
  const unseen = pending.filter((order) => (reviewedUntil[orderKey(order)] || 0) <= now);
  const showPopup = unseen.length > 0;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !showPopup) return;
    // showModal promotes the dialog to the browser top layer. Card transforms,
    // backdrop-filter, sticky headers and high z-index values cannot cover it.
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, [showPopup]);

  function reviewLater() {
    const until = Object.fromEntries(pending.map((order) => [orderKey(order), Math.min(deadline(order), Date.now() + REMIND_MS)]));
    setReviewedUntil(until);
    try {
      window.sessionStorage.setItem(REVIEW_KEY, JSON.stringify({ vendorId: snapshot.vendorId, until }));
    } catch {
      // Keep the in-memory reminder when session storage is unavailable.
    }
  }

  if (!now || !snapshot.vendorId) return null;
  const ordersHref = `/vendor-orders?vendor_id=${encodeURIComponent(snapshot.vendorId)}`;
  const content = (
    <>
      <style>{`
        .jride-incoming-dialog {
          position: fixed; inset: 0 0 auto; margin: max(52px, calc(env(safe-area-inset-top, 0px) + 12px)) auto 0;
          width: min(480px, calc(100% - 24px)); box-sizing: border-box; padding: 0;
          max-height: calc(100vh - 76px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
          max-height: calc(100dvh - 76px - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px));
          overflow: auto; overscroll-behavior: contain; border: 2px solid #fbbf24; border-radius: 18px;
          background: #07151f; color: #f0fdf4; box-shadow: 0 24px 80px #000a; z-index: 2147483000;
          font-family: inherit;
        }
        .jride-incoming-dialog::backdrop { background: #020617b8; }
        .jride-incoming-dialog header, .jride-incoming-dialog footer { position: sticky; background: #07151f; padding: 16px; z-index: 1; }
        .jride-incoming-dialog header { top: 0; border-bottom: 1px solid #334155; }
        .jride-incoming-dialog h2 { margin: 0; color: #fde68a; font-size: 21px; font-weight: 800; }
        .jride-incoming-dialog p { margin: 8px 0 0; font-size: 14px; line-height: 1.5; }
        .jride-incoming-list { padding: 12px 16px; }
        .jride-incoming-list article { border: 1px solid #475569; border-radius: 12px; padding: 12px; margin-bottom: 10px; overflow-wrap: anywhere; }
        .jride-incoming-list ul { padding-left: 20px; margin: 8px 0 0; }
        .jride-incoming-list li { margin: 4px 0; }
        .jride-incoming-deadline { color: #fde68a; font-weight: 800; }
        .jride-incoming-dialog footer { bottom: 0; display: grid; gap: 8px; border-top: 1px solid #334155; }
        .jride-incoming-dialog footer a, .jride-incoming-dialog footer button, .jride-incoming-reminder {
          display: block; box-sizing: border-box; border: 1px solid #475569; border-radius: 12px; padding: 12px;
          background: #132532; color: #f0fdf4; font: inherit; font-weight: 700; text-align: center; text-decoration: none; cursor: pointer;
        }
        .jride-incoming-dialog footer a { background: #22c55e; color: #04110a; border-color: #22c55e; }
        .jride-incoming-dialog :focus-visible { outline: 3px solid #fbbf24; outline-offset: 2px; }
        .jride-incoming-reminder { position: fixed; top: max(52px, calc(env(safe-area-inset-top, 0px) + 12px)); left: 12px; right: 12px; z-index: 2147482999; border-color: #fbbf24; background: #422006; }
        .jride-incoming-error { color: #fecdd3; }
      `}</style>
      {showPopup ? (
        <dialog ref={dialogRef} className="jride-incoming-dialog" aria-labelledby="jride-incoming-title"
          onCancel={(event) => { event.preventDefault(); reviewLater(); }}>
          <header>
            <h2 id="jride-incoming-title">New order - action required</h2>
            <p>{pending.length} order{pending.length === 1 ? "" : "s"} waiting. Open Orders to accept or decline.</p>
          </header>
          <div className="jride-incoming-list">
            {pending.map((order) => (
              <article key={orderKey(order)}>
                <strong>{clean(order.booking_code) || orderKey(order)}</strong>
                <p>{clean(order.customer_name) || "Customer"}</p>
                <p className="jride-incoming-deadline">Accept within: {countdown(order, now)}</p>
                {Array.isArray(order.items) && order.items.length > 0 ? (
                  <ul>{order.items.map((item, index) => <li key={index}>{Math.max(1, Number(item.quantity) || 1)} x {clean(item.name) || "Menu item"}</li>)}</ul>
                ) : <p>See order details in Orders.</p>}
              </article>
            ))}
            {loadError ? <p role="status" className="jride-incoming-error">{loadError}</p> : null}
          </div>
          <footer>
            <a href={ordersHref} onClick={reviewLater}>Open orders</a>
            <button type="button" onClick={reviewLater}>Remind me in 30 seconds</button>
          </footer>
        </dialog>
      ) : pending.length > 0 ? (
        <button className="jride-incoming-reminder" type="button" onClick={() => setReviewedUntil({})}>
          {pending.length} order{pending.length === 1 ? "" : "s"} waiting - tap to review
        </button>
      ) : loadError ? <a className="jride-incoming-reminder" role="status" href={ordersHref}>{loadError}</a> : null}
    </>
  );
  return createPortal(content, document.body);
}

export default function VendorIncomingOrderPopup() {
  const pathname = usePathname();
  return ROUTES.has(pathname) ? <PopupSession key={pathname} /> : null;
}
