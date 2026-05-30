"use client";

import React, { useEffect, useMemo, useState } from "react";

type PeriodKey = "today" | "week" | "month" | "all";

type Summary = {
  total_orders?: number;
  active_orders?: number;
  completed_orders?: number;
  cancelled_orders?: number;
  vendor_timeout_count?: number;
  manual_vendor_rejections?: number;
  gross_food_sales?: number;
  gross_payable?: number;
  delivery_fees?: number;
  service_fees?: number;
  packaging_revenue?: number;
  receipt_requests?: number;
  average_order_value?: number;
  cancellation_rate?: number;
  vendor_timeout_rate?: number;
  acceptance_rate?: number;
  completion_rate?: number;
};

type TopItem = {
  name: string;
  quantity: number;
  sales: number;
};

type CancelReason = {
  reason: string;
  count: number;
};

type SalesTrend = {
  date: string;
  sales: number;
};

type HourlyDemand = {
  hour: string;
  count: number;
};

type AnalyticsPayload = {
  ok?: boolean;
  error?: string;
  message?: string;
  period?: PeriodKey;
  generated_at?: string;
  vendor_id?: string;
  summary?: Summary;
  top_items?: TopItem[];
  cancellation_reasons?: CancelReason[];
  sales_trend?: SalesTrend[];
  hourly_demand?: HourlyDemand[];
};

const LS_VENDOR_ID = "JRIDE_TAKEOUT_VENDOR_ID";

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "PHP 0.00";
  return "PHP " + n.toFixed(2);
}

function pct(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.00%";
  return n.toFixed(2) + "%";
}

async function readJson(url: string): Promise<AnalyticsPayload> {
  const res = await fetch(url, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(text(body?.message || body?.error || "REQUEST_FAILED"));
  }
  return body as AnalyticsPayload;
}

function Card(props: { label: string; value: React.ReactNode; note?: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {props.label}
      </div>
      <div className="mt-2 text-2xl font-bold text-slate-900">
        {props.value}
      </div>
      {props.note ? <div className="mt-1 text-xs text-slate-500">{props.note}</div> : null}
    </div>
  );
}

function EmptyRow(props: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={props.colSpan} className="px-3 py-6 text-center text-sm text-slate-500">
        {props.text}
      </td>
    </tr>
  );
}

export default function VendorAnalyticsPage() {
  const [vendorId, setVendorId] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const fromUrl = text(params.get("vendor_id"));
      const stored = window.localStorage.getItem(LS_VENDOR_ID) || "";
      const nextVendorId = fromUrl || stored;
      if (nextVendorId) setVendorId(nextVendorId);
    } catch {
      // ignore local storage errors
    }
  }, []);

  useEffect(() => {
    try {
      if (text(vendorId)) window.localStorage.setItem(LS_VENDOR_ID, text(vendorId));
    } catch {
      // ignore local storage errors
    }
  }, [vendorId]);

  async function loadAnalytics() {
    const vid = text(vendorId);
    if (!vid) {
      setError("Enter vendor ID first.");
      setData(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        "/api/vendor-analytics/summary?vendor_id=" +
          encodeURIComponent(vid) +
          "&period=" +
          encodeURIComponent(period)
      );
      setData(payload);
    } catch (err: any) {
      setError(text(err?.message) || "Failed to load analytics.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!text(vendorId)) return;
    void loadAnalytics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, vendorId]);

  const summary = data?.summary || {};
  const topItems = Array.isArray(data?.top_items) ? data.top_items : [];
  const cancellationReasons = Array.isArray(data?.cancellation_reasons) ? data.cancellation_reasons : [];
  const salesTrend = Array.isArray(data?.sales_trend) ? data.sales_trend : [];
  const hourlyDemand = Array.isArray(data?.hourly_demand) ? data.hourly_demand : [];

  const periodLabel = useMemo(() => {
    if (period === "today") return "Today";
    if (period === "week") return "This Week";
    if (period === "month") return "This Month";
    return "All Time";
  }, [period]);

  const vendorQuery = text(vendorId) ? "?vendor_id=" + encodeURIComponent(text(vendorId)) : "";

  function handleLogout() {
    try {
      const keysToClear = [
        "JRIDE_TAKEOUT_VENDOR_ID",
        "jride_vendor_session",
        "jride_vendor_token",
        "jride_vendor_id",
        "JRIDE_VENDOR_ID",
        "vendor_id",
      ];

      for (const key of keysToClear) {
        window.localStorage.removeItem(key);
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // ignore storage cleanup failures
    }

    window.location.href = "/vendor-login";
  }

  return (
    <main className="min-h-screen bg-slate-50 p-4 text-slate-900 print:bg-white">
      <div className="mx-auto max-w-6xl">
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
          <div className="flex flex-col justify-between gap-3 md:flex-row md:items-start">
            <div>
              <h1 className="text-2xl font-bold">Vendor Analytics</h1>
              <p className="mt-1 text-sm text-slate-600">
                Read-only takeout analytics for vendor sales, cancellations, and item performance.
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Report period: {periodLabel}
                {data?.generated_at ? " | Generated: " + new Date(data.generated_at).toLocaleString() : ""}
              </p>
            </div>

            <div className="flex flex-wrap gap-2 print:hidden">
              <a
                href={"/vendor-portal" + vendorQuery}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Portal
              </a>
              <a
                href={"/vendor-orders" + vendorQuery}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Orders
              </a>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Print report
              </button>
              <button
                type="button"
                onClick={handleLogout}
                className="rounded-xl border border-rose-200 bg-white px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-50"
              >
                Logout
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto_auto] print:hidden">
            <input
              value={vendorId}
              onChange={(e) => setVendorId(e.target.value)}
              placeholder="Vendor ID"
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />

            <select
              value={period}
              onChange={(e) => setPeriod(e.target.value as PeriodKey)}
              className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="all">All Time</option>
            </select>

            <button
              type="button"
              onClick={() => loadAnalytics()}
              disabled={loading}
              className="rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {error ? (
            <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
              {error}
            </div>
          ) : null}
        </div>

        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Card label="Gross food sales" value={money(summary.gross_food_sales)} note="Completed orders only" />
          <Card label="Completed orders" value={summary.completed_orders || 0} note="Delivered/completed" />
          <Card label="Cancelled orders" value={summary.cancelled_orders || 0} note={"Rate " + pct(summary.cancellation_rate)} />
          <Card label="Vendor timeouts" value={summary.vendor_timeout_count || 0} note={"Rate " + pct(summary.vendor_timeout_rate)} />
          <Card label="Manual rejections" value={summary.manual_vendor_rejections || 0} note="Vendor declined/cancelled" />
          <Card label="Average order" value={money(summary.average_order_value)} note="Food sales / completed orders" />
        </section>

        <section className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-4">
          <Card label="Total orders" value={summary.total_orders || 0} />
          <Card label="Active orders" value={summary.active_orders || 0} />
          <Card label="Acceptance rate" value={pct(summary.acceptance_rate)} />
          <Card label="Delivery fees" value={money(summary.delivery_fees)} />
          <Card label="Receipt requests" value={summary.receipt_requests || 0} />
        </section>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
            <h2 className="text-lg font-bold">Top-selling items</h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-3 py-2">Item</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {topItems.length ? topItems.map((item) => (
                  <tr key={item.name} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{item.name}</td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">{money(item.sales)}</td>
                  </tr>
                )) : <EmptyRow colSpan={3} text="No item sales for this period." />}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
            <h2 className="text-lg font-bold">Cancellation reasons</h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2 text-right">Count</th>
                </tr>
              </thead>
              <tbody>
                {cancellationReasons.length ? cancellationReasons.map((reason) => (
                  <tr key={reason.reason} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{reason.reason}</td>
                    <td className="px-3 py-2 text-right">{reason.count}</td>
                  </tr>
                )) : <EmptyRow colSpan={2} text="No cancellations for this period." />}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
            <h2 className="text-lg font-bold">Sales by day</h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Sales</th>
                </tr>
              </thead>
              <tbody>
                {salesTrend.length ? salesTrend.map((row) => (
                  <tr key={row.date} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{row.date}</td>
                    <td className="px-3 py-2 text-right">{money(row.sales)}</td>
                  </tr>
                )) : <EmptyRow colSpan={2} text="No completed sales for this period." />}
              </tbody>
            </table>
          </section>

          <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:shadow-none">
            <h2 className="text-lg font-bold">Hourly demand</h2>
            <table className="mt-3 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b text-left text-slate-500">
                  <th className="px-3 py-2">Hour</th>
                  <th className="px-3 py-2 text-right">Orders</th>
                </tr>
              </thead>
              <tbody>
                {hourlyDemand.length ? hourlyDemand.map((row) => (
                  <tr key={row.hour} className="border-b last:border-0">
                    <td className="px-3 py-2 font-medium">{row.hour}</td>
                    <td className="px-3 py-2 text-right">{row.count}</td>
                  </tr>
                )) : <EmptyRow colSpan={2} text="No hourly demand for this period." />}
              </tbody>
            </table>
          </section>
        </div>
      </div>
    </main>
  );
}
