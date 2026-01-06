"use client";

import React, { useEffect, useMemo, useState } from "react";
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

type ApiOrder = {
  id: string;
  booking_code: string;
  customer_name: string;
  total_bill: number;
  vendor_status: VendorOrderStatus | null;
  created_at: string;
};

type UpdateAction = "driver_arrived" | "picked_up" | "completed";

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

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

      const res = await fetch("/api/vendor-orders", {
        method: "GET",
        headers: {
          "Accept": "application/json",
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to load orders (status ${res.status})`);
      }

      const data: { orders: ApiOrder[] } = await res.json();

      const mapped: VendorOrder[] = data.orders.map((o) => ({
        id: o.id,
        bookingCode: o.booking_code,
        customerName: o.customer_name ?? "",
        totalBill: o.total_bill ?? 0,
        status: (o.vendor_status ?? "preparing") as VendorOrderStatus,
        createdAt: o.created_at,
      }));
            // VENDOR_CORE_V3_UI_SYNC (safe local update, backend-confirmed by reload)
      setOrders((prev) =>
        prev.map((o) => (o.id === id ? { ...o, status: (nextStatus as any) } : o))
      );} catch (err: any) {
      console.error("[VendorOrders] handleStatusUpdate error:", err);
      setError(err.message || "Failed to update order status.");
    } finally {
      setUpdatingId(null);
    }
  };

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
            Mark ready
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

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
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
                onClick={() => loadOrders().catch(() => undefined)}
                disabled={isLoading}
              >
                Retry
              </button>
            </div>
          </div>
        )}
        {isLoading && (
          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">
            Loading orders…
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
                              disabled={updatingId === o.id}
                              onClick={() =>
                                handleStatusUpdate(o, "driver_arrived")
                              }
                              className="rounded-full border border-sky-500 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Mark ready
                            </button>
                          )}
                          {o.status === "driver_arrived" && (
                            <button
                              type="button"
                              disabled={updatingId === o.id}
                              onClick={() => handleStatusUpdate(o, "picked_up")}
                              className="rounded-full border border-emerald-500 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              Order picked up
                            </button>
                          )}
                          {o.status === "picked_up" && (
                            <button
                              type="button"
                              disabled={updatingId === o.id}
                              onClick={() => handleStatusUpdate(o, "completed")}
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





