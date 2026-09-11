import { isClosed, orderKey, orderStatus, shortOrderCode, type VendorOrder } from "./vendorOrderWorkflow";

export type OrderNotice = { id: string; title: string; orderId: string; closed: boolean };
export type OrderFeedSnapshot = {
  orders: VendorOrder[]; lastUpdated: number; serverOffset: number; refreshing: boolean;
  stale: boolean; error: string; authRequired: boolean; notices: OrderNotice[];
};
export const EMPTY_FEED: OrderFeedSnapshot = { orders: [], lastUpdated: 0, serverOffset: 0, refreshing: false, stale: true, error: "", authRequired: false, notices: [] };

// One request stream per vendor, shared by Orders, the portal, and the popup.
// No persisted order cache: returning from the background requires fresh data.
export function createVendorOrderFeed(vendorId: string) {
  let snapshot: OrderFeedSnapshot = EMPTY_FEED;
  const listeners = new Set<() => void>();
  let controller: AbortController | null = null;
  let requestId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let running = false;
  let pending: Promise<void> | null = null;
  function publish(change: Partial<OrderFeedSnapshot>) {
    snapshot = { ...snapshot, ...change };
    listeners.forEach(listener => listener());
  }
  function schedule(delay: number) {
    clearTimeout(timer);
    if (running && !snapshot.authRequired && document.visibilityState !== "hidden") timer = setTimeout(() => { void refresh(); }, delay);
  }
  function refresh(force = false): Promise<void> {
    if (!vendorId || document.visibilityState === "hidden") return Promise.resolve();
    if (pending && !force) return pending;
    const id = ++requestId;
    controller?.abort();
    const request = new AbortController();
    controller = request;
    clearTimeout(timer);
    const started = Date.now();
    publish({ refreshing: true, stale: snapshot.stale || !snapshot.lastUpdated || started - snapshot.lastUpdated > 15000 });
    pending = (async () => {
      const timeout = setTimeout(() => request.abort(), 12000);
      try {
        const response = await fetch("/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorId), {
          credentials: "same-origin", cache: "no-store", headers: { Accept: "application/json" }, signal: request.signal,
        });
        const body = await response.json();
        if (id !== requestId) return;
        if (response.status === 401 || response.status === 403) {
          publish({ orders: [], notices: [], lastUpdated: 0, stale: true, authRequired: true, error: "Your vendor session ended. Sign in again to receive and manage orders." });
          return;
        }
        if (!response.ok || body?.ok === false || !Array.isArray(body.orders) || body.vendor_id !== vendorId) throw new Error("Order refresh failed");
        const received = Date.now();
        const old = new Map(snapshot.orders.map(order => [orderKey(order), order]));
        const notices = [...snapshot.notices];
        for (const order of body.orders as VendorOrder[]) {
          const previous = old.get(orderKey(order));
          if (!previous || isClosed(previous)) continue;
          const closed = isClosed(order);
          const confirmed = !previous.takeout_customer_confirmed_at && Boolean(order.takeout_customer_confirmed_at);
          if (closed || confirmed) {
            const noticeId = orderKey(order) + ":" + (closed ? orderStatus(order) : "confirmed");
            if (!notices.some(n => n.id === noticeId)) notices.push({ id: noticeId, orderId: orderKey(order), closed, title: shortOrderCode(order) + " " + (closed ? (orderStatus(order) === "completed" ? "completed" : orderStatus(order) === "vendor_timeout" ? "acceptance expired" : "cancelled") : "customer confirmed - prepare now") });
          }
        }
        const server = Date.parse(String(body.server_now || ""));
        failures = 0;
        publish({ orders: body.orders, lastUpdated: received, serverOffset: Number.isFinite(server) ? server - received : 0, stale: false, authRequired: false, error: "", notices: notices.slice(-5) });
      } catch {
        if (id !== requestId) return;
        failures++;
        publish({ stale: true, error: "Orders are reconnecting. The list may be out of date. Retry when your connection returns." });
      } finally {
        clearTimeout(timeout);
        if (id === requestId) {
          pending = null;
          controller = null;
          publish({ refreshing: false });
          schedule(failures ? Math.min(8000, failures * 2000) : 8000);
        }
      }
    })();
    return pending;
  }
  function onResume() { if (document.visibilityState !== "hidden") { publish({ stale: true }); void refresh(true); } }
  function onVisibility() {
    if (document.visibilityState === "hidden") {
      ++requestId; controller?.abort(); controller = null; pending = null; clearTimeout(timer);
      publish({ stale: true, refreshing: false });
    } else onResume();
  }
  function onOffline() { ++requestId; controller?.abort(); pending = null; clearTimeout(timer); publish({ stale: true, refreshing: false, error: "You are offline. Reconnect to update Orders." }); }
  function start() {
    running = true;
    window.addEventListener("focus", onResume);
    window.addEventListener("pageshow", onResume);
    window.addEventListener("online", onResume);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisibility);
    void refresh();
  }
  function stop() {
    running = false; ++requestId; controller?.abort(); controller = null; pending = null; clearTimeout(timer);
    window.removeEventListener("focus", onResume);
    window.removeEventListener("pageshow", onResume);
    window.removeEventListener("online", onResume);
    window.removeEventListener("offline", onOffline);
    document.removeEventListener("visibilitychange", onVisibility);
    snapshot = { ...snapshot, stale: true, refreshing: false };
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); if (!running) start(); return () => { listeners.delete(listener); if (!listeners.size) stop(); }; },
    refresh,
    acknowledge(orderId: string, status: string) {
      ++requestId; controller?.abort(); controller = null; pending = null; clearTimeout(timer);
      publish({ stale: true, refreshing: false, orders: snapshot.orders.map(order => orderKey(order) === orderId ? { ...order, vendor_status: status, ...(status === "cancelled" ? { status: "cancelled" } : {}) } : order) });
    },
    dismissNotice(id: string) { publish({ notices: snapshot.notices.filter(notice => notice.id !== id) }); },
  };
}
