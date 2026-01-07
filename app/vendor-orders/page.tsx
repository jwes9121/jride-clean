"use client";

import React, { useEffect, useMemo, useState, Suspense } from "react";

import { useSearchParams } from "next/navigation";

import OfflineIndicator from "@/components/OfflineIndicator";

type VendorOrderStatus =
  | "preparing"
  | "driver_arrived"
  | "picked_up"
  | "completed";

type VendorOrder = {
  id: string;
  bookingCode: string;
  customerName: string;
  totalBill: number;
  status: VendorOrderStatus;
  createdAt: string;
};

function formatAmount(n: number | null | undefined) {
  const v = Number(n || 0);
  if (!isFinite(v)) return "PHP 0.00";
  return "PHP " + v.toFixed(2);
}
type ApiOrder = {
  id: string;
  booking_code: string;
  customer_name: string;
  total_bill: number;
  vendor_status: VendorOrderStatus | null;
  created_at: string;
};

type UpdateAction = "driver_arrived" | "picked_up" | "completed";
function VendorOrdersInner() {
const searchParams = useSearchParams();
  const vendorIdFromQuery = String(searchParams?.get("vendor_id") || "").trim();
  console.log("VendorOrders vendor_id =", vendorIdFromQuery);
  const [orders, setOrders] = useState<VendorOrder[]>([]);

  const activeOrders = useMemo(() => {
    return orders.filter((o) => o.status !== "completed");
  }, [orders]);

  const completedOrders = useMemo(() => {
    return orders.filter((o) => o.status === "completed");
  }, [orders]);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);


  // PHASE13_VENDOR_ACTION_GEO_GATE


  // PHASE14_VENDOR_CORE_HARDEN
  // UI-only vendor transition gating (fails open on unknown status to avoid regressions).
  const VENDOR_FLOW_UI = ["preparing","driver_arrived","picked_up","completed"] as const;
  type VendorFlowStatus = typeof VENDOR_FLOW_UI[number];

  function normVendorFlowStatus(s: any): VendorFlowStatus | null {
    const v = String(s || "").trim();
    return (VENDOR_FLOW_UI as readonly string[]).includes(v) ? (v as VendorFlowStatus) : null;
  }

  function nextVendorFlowStatus(cur: VendorFlowStatus): VendorFlowStatus | null {
    const i = VENDOR_FLOW_UI.indexOf(cur);
    if (i < 0) return null;
    return i + 1 < VENDOR_FLOW_UI.length ? VENDOR_FLOW_UI[i + 1] : null;
  }

  function vendorCanTransitionUI(order: any, target: any): boolean {
    const cur = normVendorFlowStatus(order?.status);
    const tgt = normVendorFlowStatus(target);
    if (!cur || !tgt) return true; // fails open if unknown
    if (cur === tgt) return false; // no-op clicks disabled
    const next = nextVendorFlowStatus(cur);
    return next === tgt;
  }
  // UI-only: vendor can view page anywhere, but ACTIONS require location permission + inside Ifugao.
  // Dev/test bypass (OFF by default). Set NEXT_PUBLIC_VENDOR_GEO_BYPASS=1 to enable actions anywhere.
  const DEV_VENDOR_GEO_BYPASS = process.env.NEXT_PUBLIC_VENDOR_GEO_BYPASS === "1";
  const [vGeoPermission, setVGeoPermission] = useState<"unknown" | "granted" | "denied">("unknown");
  const [vGeoInsideIfugao, setVGeoInsideIfugao] = useState<boolean>(false);
  const [vGeoErr, setVGeoErr] = useState<string | null>(null);
  const [vGeoLast, setVGeoLast] = useState<{ lat: number; lng: number } | null>(null);

  // Generous bbox to avoid false "outside" for Ifugao towns (includes Lamut/Kiangan edges)
  const IFUGAO_BBOX = { minLat: 16.40, maxLat: 17.80, minLng: 120.80, maxLng: 121.70 };

  function inIfugaoBBox(lat: number, lng: number) {
    return (
      lat >= IFUGAO_BBOX.minLat &&
      lat <= IFUGAO_BBOX.maxLat &&
      lng >= IFUGAO_BBOX.minLng &&
      lng <= IFUGAO_BBOX.maxLng
    );
  }

  async function refreshVendorGeoGate(opts?: { prompt?: boolean }) {
    try {
      setVGeoErr(null);

      if (typeof window === "undefined" || typeof navigator === "undefined") {
        setVGeoPermission("unknown");
        setVGeoInsideIfugao(false);
        return;
      }

      if (!("geolocation" in navigator)) {
        setVGeoPermission("denied");
        setVGeoInsideIfugao(false);
        setVGeoErr("Geolocation not supported on this device/browser.");
        return;
      }

      const permApi: any = (navigator as any).permissions;
      if (permApi && permApi.query) {
        try {
          const st = await permApi.query({ name: "geolocation" });
          if (st?.state === "granted") setVGeoPermission("granted");
          else if (st?.state === "denied") setVGeoPermission("denied");
          else setVGeoPermission("unknown");
        } catch {
          // ignore
        }
      }

      const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: opts?.prompt ? 0 : 30000,
        });
      });

      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;

      setVGeoLast({ lat, lng });
      setVGeoPermission("granted");

      const inside = inIfugaoBBox(lat, lng);
      setVGeoInsideIfugao(inside);
      if (!inside) {
        setVGeoErr("Action blocked: you appear outside Ifugao.");
      }
    } catch (e: any) {
      const code = e?.code;
      const msg =
        code === 1
          ? "Location permission denied. Actions are disabled."
          : code === 2
          ? "Location unavailable. Actions are disabled."
          : code === 3
          ? "Location request timed out. Actions are disabled."
          : e?.message || "Location check failed. Actions are disabled.";

      setVGeoPermission(code === 1 ? "denied" : "unknown");
      setVGeoInsideIfugao(false);
      setVGeoErr(msg);
    }
  }

  useEffect(() => {
    refreshVendorGeoGate({ prompt: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const vendorActionBlocked = !DEV_VENDOR_GEO_BYPASS && !(vGeoPermission === "granted" && vGeoInsideIfugao);
  // VENDOR_CORE_V1_REFINEMENTS
  // Prevent poll flicker while a status update is in-flight
  const updatingIdRef = React.useRef<string | null>(null);
  useEffect(() => {
    updatingIdRef.current = updatingId;
  }, [updatingId]);

    const loadOrders = async () => {
    try {
      setIsLoading(true);
      setError(null);

      

      if (!vendorIdFromQuery) {
        throw new Error('vendor_id_required (append ?vendor_id=YOUR_VENDOR_UUID): open /vendor-orders?vendor_id=YOUR_VENDOR_UUID');
      }
const res = await fetch("/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorIdFromQuery), {
        method: "GET",
        headers: { "Accept": "application/json" },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load orders (status ${res.status})`);
      }

      const data: { orders: ApiOrder[] } = await res.json();

      const mapped: VendorOrder[] = (data.orders || []).map((o) => ({
        id: o.id,
        bookingCode: o.booking_code,
        customerName: o.customer_name ?? "",
        totalBill: o.total_bill ?? 0,
        status: (o.vendor_status ?? "preparing") as VendorOrderStatus,
        createdAt: o.created_at,
      }));

      // Prevent poll flicker while a status update is in-flight
      if (updatingIdRef.current) return;

      setOrders(mapped);
    } catch (err: any) {
      console.error("[VendorOrders] loadOrders error:", err);
      setError(err?.message || "Failed to load orders.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders().catch(() => undefined);
    const t = setInterval(() => {
      // Poll every 10s (skips replace while updatingIdRef is set)
      loadOrders().catch(() => undefined);
    }, 10000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderStatusBadge = (status: VendorOrderStatus) => {
    const base =
      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border";
    switch (status) {
      case "preparing":


  return (
          <span
            className={`${base} bg-amber-50 text-amber-700 border-amber-200`}
          >
            preparing
          </span>
        );
      case "driver_arrived":


  return (
          <span className={`${base} bg-sky-50 text-sky-700 border-sky-200`}>
            ready
          </span>
        );
      case "picked_up":


  return (
          <span
            className={`${base} bg-emerald-50 text-emerald-700 border-emerald-200`}
          >
            picked up
          </span>
        );
      case "completed":
      default:


  return (
          <span className={`${base} bg-slate-100 text-slate-600 border-slate-200`}>
            completed
          </span>
        );
    }
  };

  async function handleStatusUpdate(order: VendorOrder, nextStatus: any) {
    try {
      setError(null);
      

      if (!vendorIdFromQuery) {
        throw new Error('vendor_id_required (append ?vendor_id=YOUR_VENDOR_UUID): open /vendor-orders?vendor_id=YOUR_VENDOR_UUID');
      }
setUpdatingId(order.id);

      // Instant UI feedback (safe): update only this row locally
      setOrders((prev) =>
        prev.map((o) => (o.id === order.id ? { ...o, status: nextStatus } : o))
      );

            const vendor_id =
        (order as any).vendorId ||
        (order as any).vendor_id ||
        (order as any).vendorID ||
        vendorIdFromQuery ||
        "";

      const res = await fetch("/api/vendor-orders?vendor_id=" + encodeURIComponent(vendorIdFromQuery), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          order_id: order.id,
          vendor_id,
          vendor_status: String(nextStatus),
        }),
      });

      const j = await res.json().catch(() => ({} as any));
      if (!res.ok || j?.ok === false) {
        const msg =
          j?.message ||
          j?.error ||
          `Failed to update status (HTTP ${res.status})`;
        throw new Error(msg);
      }

      // Re-sync from backend truth (prevents drift / handles idempotency / transitions)
      await loadOrders();
    } catch (err: any) {
      console.error("[VendorOrders] handleStatusUpdate error:", err);
      setError(err?.message || "Failed to update order status.");
      // If something failed, refresh to get back to truth
      try { await loadOrders(); } catch {}
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* PHASE13_VENDOR_ACTION_GEO_GATE: Action gating banner (page still accessible) */}
      <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        <div className="flex items-center justify-between gap-2">
          <div className="font-medium">Vendor action location check</div>
          <button
            type="button"
            className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] hover:bg-amber-100"
            onClick={() => refreshVendorGeoGate({ prompt: true })}
          >
            Refresh location
          </button>
        </div>
        <div className="mt-1 opacity-90">
            Permission: <span className="font-semibold">{vGeoPermission}</span> | Inside Ifugao: <span className="font-semibold">{String(vGeoInsideIfugao)}</span> | Last: {vGeoLast ? `${vGeoLast.lat.toFixed(5)},${vGeoLast.lng.toFixed(5)}` : "n/a"}
          <span className="font-semibold">{String(vGeoInsideIfugao)}</span>
          {vGeoLast ? (
            <span className="opacity-80">Last: {vGeoLast.lat.toFixed(5)},{vGeoLast.lng.toFixed(5)}</span>
          ) : null}
        </div>
        {vendorActionBlocked ? (
          <div className="mt-1 text-red-700">
            Actions disabled until location permission is granted and you are inside Ifugao.
            {vGeoErr ? <span className="opacity-90"> ({vGeoErr})</span> : null}
          </div>
        ) : (
          <div className="mt-1 text-emerald-700">Actions enabled.</div>
        )}
      </div>

      {/* PHASE15_VENDOR_CONTEXT: Vendor id required */}
      {!vendorIdFromQuery ? (
        <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          <div className="font-medium">Vendor context not set</div>
          <div className="mt-1 opacity-90">
            Add <span className="font-semibold">?vendor_id=&lt;vendor_uuid&gt;</span> to the URL to view and manage orders.
          </div>
        </div>
      ) : (
        <div className="mb-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
          Vendor ID: <span className="font-semibold">{vendorIdFromQuery}</span>
        </div>
      )}

      <OfflineIndicator />

      {/* Header */}
      <header className="sticky top-0 z-10 bg-white shadow-sm border-b">
        <div className="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">
              JRide Vendor Orders
            </h1>
            <p className="text-xs text-slate-500">
              Manage takeout orders, update statuses, and track payouts.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Active:{" "}
              <span className="font-semibold">{activeOrders.length}</span>
            </div>
            <div className="px-3 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
              Completed orders:{" "}
              <span className="font-semibold">{completedOrders.length}</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-4 space-y-6">
        {/* Error / loading */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">{error}</div>
              <button
                type="button"
                className="shrink-0 rounded border border-red-300 bg-white px-2 py-1 text-[11px] text-red-700 hover:bg-red-50"
                onClick={() => { if (vendorIdFromQuery) loadOrders().catch(() => undefined); }}
                disabled={isLoading}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            Loading orders...
          </div>
        )}

        {/* Active orders */}
        <section>
          <h2 className="text-sm font-semibold text-slate-800 mb-2">
            Active orders
          </h2>

          {activeOrders.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-500">
              No active takeout orders right now.
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead className="bg-slate-50 text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Code</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Customer
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">Bill</th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Status
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {activeOrders.map((o) => (
                    <tr key={o.id} className="hover:bg-slate-50/60">
                      <td className="px-3 py-2 font-semibold text-slate-900">
                        {o.bookingCode}
                      </td>
                      <td className="px-3 py-2 text-slate-700">{o.customerName}</td>
                      <td className="px-3 py-2 text-slate-900">
                        {formatAmount(o.totalBill)}
                      </td>
                      <td className="px-3 py-2">{renderStatusBadge(o.status)}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {o.status === "preparing" && (
                            <button
                              type="button"
                              disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o,"driver_arrived")}
                              onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"driver_arrived") ? null : handleStatusUpdate(o, "driver_arrived"))}
                              className="rounded-full border border-sky-500 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Mark ready
                            </button>
                          )}
                          {o.status === "driver_arrived" && (
                            <button
                              type="button"
                              disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o,"picked_up")}
                              onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"picked_up") ? null : handleStatusUpdate(o, "picked_up"))}
                              className="rounded-full border border-emerald-500 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Order picked up
                            </button>
                          )}
                          {o.status === "picked_up" && (
                            <button
                              type="button"
                              disabled={vendorActionBlocked || updatingId === o.id || !vendorCanTransitionUI(o,"completed")}
                              onClick={() => (vendorActionBlocked || !vendorCanTransitionUI(o,"completed") ? null : handleStatusUpdate(o, "completed"))}
                              className="rounded-full border border-slate-500 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Mark completed
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Completed today */}
        <section>
          <h2 className="text-sm font-semibold text-slate-800 mb-2">
            Completed orders
          </h2>
          {completedOrders.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">
              No completed orders yet for today.
            </div>
          ) : (
            <ul className="space-y-1 text-xs">
              {completedOrders.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900">
                      {o.bookingCode}
                    </span>
                    <span className="text-slate-500">{o.customerName}</span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900">
                      {formatAmount(o.totalBill)}
                    </div>
                    <div className="text-[11px] text-slate-400">Completed</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
export default function VendorOrdersPage() {
  return (
      <Suspense fallback={<div className="p-4 text-xs text-slate-500">Loading vendor orders...</div>}>
      <VendorOrdersInner />
    </Suspense>
  );
}