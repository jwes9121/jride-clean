"use client";

import React, { useEffect, useState } from "react";
import OfflineIndicator from "@/components/OfflineIndicator";

type VendorOrderStatus =
  | "pending"
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

export default function VendorOrdersPage() {
  const [orders, setOrders] = useState<VendorOrder[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // TODO: Replace with real fetch to Supabase/API
  useEffect(() => {
    setIsLoading(true);
    setError(null);

    // Temporary mock data so UI works while we wire the API
    const mock: VendorOrder[] = [
      {
        id: "1",
        bookingCode: "TEST-TAKEOUT-1",
        customerName: "Demo Customer",
        totalBill: 320,
        status: "preparing",
        createdAt: new Date().toISOString(),
      },
      {
        id: "2",
        bookingCode: "TEST-TAKEOUT-2",
        customerName: "Juan Dela Cruz",
        totalBill: 580,
        status: "driver_arrived",
        createdAt: new Date().toISOString(),
      },
    ];

    setOrders(mock);
    setIsLoading(false);
  }, []);

  const activeOrders = orders.filter(
    (o) => o.status !== "completed"
  );
  const completedToday = orders.filter(
    (o) => o.status === "completed"
  );

  const updateStatus = (id: string, status: VendorOrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => (o.id === id ? { ...o, status } : o))
    );
    // TODO: later -> call API to persist status change
  };

  const formatAmount = (value: number) =>
    `₱${value.toFixed(2)}`;

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
              Manage takeout orders, update statuses, and track
              payouts.
            </p>
          </div>

          <div className="flex items-center gap-3 text-xs">
            <div className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
              Active:{" "}
              <span className="font-semibold">
                {activeOrders.length}
              </span>
            </div>
            <div className="px-3 py-1 rounded-full bg-slate-50 text-slate-600 border border-slate-200">
              Completed today:{" "}
              <span className="font-semibold">
                {completedToday.length}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-4 space-y-6">
        {/* Error / loading states */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
            Failed to load orders: {error}
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
                    <th className="px-3 py-2 text-left font-semibold">
                      Code
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Customer
                    </th>
                    <th className="px-3 py-2 text-left font-semibold">
                      Bill
                    </th>
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
                      <td className="px-3 py-2 text-slate-700">
                        {o.customerName}
                      </td>
                      <td className="px-3 py-2 text-slate-900">
                        {formatAmount(o.totalBill)}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                            o.status === "preparing"
                              ? "bg-amber-50 text-amber-700 border border-amber-200"
                              : o.status === "driver_arrived"
                              ? "bg-sky-50 text-sky-700 border border-sky-200"
                              : o.status === "picked_up"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : "bg-slate-100 text-slate-600 border border-slate-200",
                          ].join(" ")}
                        >
                          {o.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {o.status === "preparing" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateStatus(o.id, "driver_arrived")
                              }
                              className="rounded-full border border-sky-500 px-2 py-1 text-[11px] text-sky-700 hover:bg-sky-50"
                            >
                              Driver arrived
                            </button>
                          )}
                          {o.status === "driver_arrived" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateStatus(o.id, "picked_up")
                              }
                              className="rounded-full border border-emerald-500 px-2 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50"
                            >
                              Order picked up
                            </button>
                          )}
                          {o.status === "picked_up" && (
                            <button
                              type="button"
                              onClick={() =>
                                updateStatus(o.id, "completed")
                              }
                              className="rounded-full border border-slate-500 px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-50"
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
            Completed today
          </h2>
          {completedToday.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-xs text-slate-500">
              No completed orders yet for today.
            </div>
          ) : (
            <ul className="space-y-1 text-xs">
              {completedToday.map((o) => (
                <li
                  key={o.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2"
                >
                  <div className="flex flex-col">
                    <span className="font-semibold text-slate-900">
                      {o.bookingCode}
                    </span>
                    <span className="text-slate-500">
                      {o.customerName}
                    </span>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold text-slate-900">
                      {formatAmount(o.totalBill)}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Completed
                    </div>
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
