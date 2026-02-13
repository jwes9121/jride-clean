"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type DateFilter = "all" | "7d" | "30d";
type ViewFilter = "all" | "rated";

type TakeoutOrder = {
  id: string;
  booking_code: string;
  status: string | null;
  vendor_status: string | null;
  customer_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  items_total: number;
  platform_fee: number;
  total_bill: number;
  driver_payout: number;
  rating_avg: number | null;
  rating_count: number;
  rating_comment: string | null;
};

type ApiResponse = {
  orders: TakeoutOrder[];
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDateTime(value: string | null): string {
  const d = parseDate(value);
  if (!d) return "-";
  return d.toLocaleString();
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "₱0.00";
  return `₱${value.toFixed(2)}`;
}

function computeWeightedAverageRating(orders: TakeoutOrder[]): number | null {
  let sumWeighted = 0;
  let sumCount = 0;

  for (const order of orders) {
    if (order.rating_avg && order.rating_count > 0) {
      sumWeighted += order.rating_avg * order.rating_count;
      sumCount += order.rating_count;
    }
  }

  if (sumCount === 0) return null;
  const avg = sumWeighted / sumCount;
  return Math.round(avg * 10) / 10;
}

function applyDateFilter(orders: TakeoutOrder[], filter: DateFilter): TakeoutOrder[] {
  if (filter === "all") return orders;

  const now = new Date();
  const days = filter === "7d" ? 7 : 30;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  return orders.filter((o) => {
    const created = parseDate(o.created_at);
    if (!created) return false;
    return created >= cutoff;
  });
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1) + "…";
}

export default function VendorRatingsPage() {
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [viewFilter, setViewFilter] = useState<ViewFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  async function loadData() {
    try {
      setLoading(true);
      setError(null);

      const res = await fetch("/api/takeout/vendor-ratings", {
        method: "GET",
        cache: "no-store",
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Failed with status ${res.status}`);
      }

      const body = (await res.json()) as ApiResponse;
      setOrders(body.orders || []);
    } catch (err: any) {
      console.error("Failed to load vendor ratings:", err);
      setError(err?.message || "Failed to load vendor ratings.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const dateFilteredOrders = useMemo(
    () => applyDateFilter(orders, dateFilter),
    [orders, dateFilter]
  );

  const filteredOrders = useMemo(() => {
    if (viewFilter === "rated") {
      return dateFilteredOrders.filter(
        (o) => o.rating_avg !== null && o.rating_count > 0
      );
    }
    return dateFilteredOrders;
  }, [dateFilteredOrders, viewFilter]);

  const totalOrders = filteredOrders.length;

  const grossBillings = useMemo(
    () =>
      filteredOrders.reduce((sum, o) => {
        return sum + (Number.isFinite(o.total_bill) ? o.total_bill : 0);
      }, 0),
    [filteredOrders]
  );

  const platformFees = useMemo(
    () =>
      filteredOrders.reduce((sum, o) => {
        return sum + (Number.isFinite(o.platform_fee) ? o.platform_fee : 0);
      }, 0),
    [filteredOrders]
  );

  const vendorEarnings = useMemo(
    () =>
      filteredOrders.reduce((sum, o) => {
        const bill = Number.isFinite(o.total_bill) ? o.total_bill : 0;
        const platform = Number.isFinite(o.platform_fee) ? o.platform_fee : 0;
        return sum + (bill - platform);
      }, 0),
    [filteredOrders]
  );

  const averageRating = useMemo(
    () => computeWeightedAverageRating(filteredOrders),
    [filteredOrders]
  );

  const isEmptyState = !loading && filteredOrders.length === 0;

  function renderRatingCell(order: TakeoutOrder) {
    if (!order.rating_avg || order.rating_count === 0) {
      return <span className="text-xs text-slate-400">Not yet rated</span>;
    }

    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-800">
        {order.rating_avg.toFixed(1)}{" "}
        <span className="text-amber-400">★</span>
        <span className="text-[11px] text-slate-400">
          ({order.rating_count})
        </span>
      </span>
    );
  }

  function renderFeedbackCell(order: TakeoutOrder) {
    if (!order.rating_comment) {
      return <span className="text-[11px] text-slate-400">—</span>;
    }
    return (
      <span
        className="text-[11px] text-slate-700"
        title={order.rating_comment}
      >
        {truncate(order.rating_comment, 40)}
      </span>
    );
  }

  function handleRefresh() {
    setRefreshing(true);
    loadData();
  }

  function escapeCsvField(value: string): string {
    if (value === "") return "";
    const needsQuotes =
      value.includes(",") || value.includes('"') || value.includes("\n");
    let v = value.replace(/"/g, '""');
    return needsQuotes ? `"${v}"` : v;
  }

  function handleExportCsv() {
    try {
      if (filteredOrders.length === 0) return;
      setExporting(true);

      const header = [
        "booking_code",
        "created_at",
        "status",
        "total_bill",
        "platform_fee",
        "vendor_earnings",
        "rating_avg",
        "rating_count",
        "rating_comment",
      ];

      const lines: string[] = [];
      lines.push(header.join(","));

      for (const o of filteredOrders) {
        const createdAt = o.created_at || "";
        const status = o.vendor_status || o.status || "";
        const totalBill = Number.isFinite(o.total_bill) ? o.total_bill.toFixed(2) : "0.00";
        const platformFee = Number.isFinite(o.platform_fee)
          ? o.platform_fee.toFixed(2)
          : "0.00";
        const vendorEarn = (() => {
          const bill = Number.isFinite(o.total_bill) ? o.total_bill : 0;
          const platform = Number.isFinite(o.platform_fee) ? o.platform_fee : 0;
          return (bill - platform).toFixed(2);
        })();
        const ratingAvg =
          o.rating_avg && o.rating_count > 0
            ? o.rating_avg.toFixed(1)
            : "";
        const ratingCount =
          o.rating_count && o.rating_count > 0
            ? String(o.rating_count)
            : "";
        const comment = o.rating_comment || "";

        const row = [
          escapeCsvField(o.booking_code || ""),
          escapeCsvField(createdAt),
          escapeCsvField(status),
          totalBill,
          platformFee,
          vendorEarn,
          ratingAvg,
          ratingCount,
          escapeCsvField(comment),
        ];

        lines.push(row.join(","));
      }

      const csv = lines.join("\r\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = "jride-takeout-vendor-ratings.csv";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export CSV:", err);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8">
        {/* Header & summary cards */}
        <section>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-slate-900">
                Ratings &amp; payment summary
              </h1>
              <p className="mt-1 text-xs text-slate-500 max-w-xl">
                See how your recent takeout orders performed – including total
                earnings, platform fees, and customer feedback.
              </p>
            </div>

            <div className="flex flex-col items-end gap-2 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  Date range
                </span>
                <div className="inline-flex rounded-full bg-slate-100 p-1">
                  {[
                    { key: "all", label: "All time" },
                    { key: "7d", label: "Last 7 days" },
                    { key: "30d", label: "Last 30 days" },
                  ].map((item) => {
                    const key = item.key as DateFilter;
                    const active = dateFilter === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setDateFilter(key)}
                        className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                          active
                            ? "bg-emerald-600 text-white shadow-sm"
                            : "text-slate-600 hover:bg-white"
                        }`}
                      >
                        {item.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={refreshing || loading}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {refreshing ? "Refreshing..." : "Refresh data"}
                </button>
                <button
                  type="button"
                  onClick={handleExportCsv}
                  disabled={exporting || loading || filteredOrders.length === 0}
                  className="rounded-full bg-slate-900 px-3 py-1.5 text-[11px] font-medium text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {exporting ? "Exporting…" : "Download CSV"}
                </button>
              </div>
            </div>
          </div>

          {/* Summary cards */}
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Total orders
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {totalOrders}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                {dateFilter === "all" ? "All time" : "Filtered range only"}
                {viewFilter === "rated" ? " • Rated only" : ""}
              </div>
            </div>

            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Gross billings
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {formatMoney(grossBillings)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Sum of all customer bills
              </div>
            </div>

            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Vendor earnings
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {formatMoney(vendorEarnings)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Gross billings minus JRide platform fees
              </div>
            </div>

            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Average rating
              </div>
              <div className="mt-2 flex items-center gap-1 text-xl font-semibold text-slate-900">
                {averageRating !== null ? (
                  <>
                    {averageRating.toFixed(1)}
                    <span className="text-amber-400 text-base">★</span>
                  </>
                ) : (
                  <span className="text-sm text-slate-400">No ratings yet</span>
                )}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Weighted by all rated orders in the selected range
              </div>
            </div>
          </div>
        </section>

        {/* Orders list */}
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Orders list
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Detailed breakdown of each takeout order, its rating, and customer feedback.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                View
              </span>
              <div className="inline-flex rounded-full bg-slate-100 p-1">
                {[
                  { key: "all", label: "All orders" },
                  { key: "rated", label: "Rated only" },
                ].map((item) => {
                  const key = item.key as ViewFilter;
                  const active = viewFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setViewFilter(key)}
                      className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${
                        active
                          ? "bg-slate-900 text-white shadow-sm"
                          : "text-slate-600 hover:bg-white"
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs text-red-500">
              Error: {error}
            </p>
          )}

          {loading ? (
            <div className="mt-6 text-center text-xs text-slate-400">
              Loading orders…
            </div>
          ) : isEmptyState ? (
            <div className="mt-6 text-center text-xs text-slate-400">
              No orders found for the selected filters.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Order code</th>
                    <th className="px-2 py-2">Placed</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2 text-right">Total bill</th>
                    <th className="px-2 py-2 text-right">Platform fee</th>
                    <th className="px-2 py-2 text-right">Vendor earnings</th>
                    <th className="px-2 py-2">Rating</th>
                    <th className="px-2 py-2">Feedback</th>
                    <th className="px-2 py-2 text-right">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((order) => {
                    const bill = Number.isFinite(order.total_bill)
                      ? order.total_bill
                      : 0;
                    const platform = Number.isFinite(order.platform_fee)
                      ? order.platform_fee
                      : 0;
                    const vendorEarn = bill - platform;

                    return (
                      <tr
                        key={order.id}
                        className="border-b border-slate-50 text-[11px] text-slate-700 hover:bg-slate-50/60"
                      >
                        <td className="px-2 py-2 font-mono text-[11px] text-slate-900">
                          {order.booking_code}
                        </td>
                        <td className="px-2 py-2">
                          {formatDateTime(order.created_at)}
                        </td>
                        <td className="px-2 py-2">
                          <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium capitalize text-slate-700">
                            {order.vendor_status || order.status || "—"}
                          </span>
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatMoney(bill)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatMoney(platform)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          {formatMoney(vendorEarn)}
                        </td>
                        <td className="px-2 py-2">{renderRatingCell(order)}</td>
                        <td className="px-2 py-2">
                          {renderFeedbackCell(order)}
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Link
                            href={`/takeout/orders/${encodeURIComponent(
                              order.booking_code
                            )}/receipt`}
                            className="text-[11px] font-medium text-emerald-600 hover:text-emerald-700"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}