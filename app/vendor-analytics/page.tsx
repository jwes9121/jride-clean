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
  test_data_excluded?: boolean;
  excluded_test_orders?: number;
  summary?: Summary;
  top_items?: TopItem[];
  cancellation_reasons?: CancelReason[];
  sales_trend?: SalesTrend[];
  hourly_demand?: HourlyDemand[];
};

const VENDOR_ID_KEYS = [
  "JRIDE_VENDOR_PORTAL_VENDOR_ID",
  "JRIDE_TAKEOUT_VENDOR_ID",
  "jride_vendor_id",
  "JRIDE_VENDOR_ID",
  "vendor_id",
] as const;

function text(v: unknown): string {
  return String(v ?? "").trim();
}

function money(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "PHP 0.00";
  return "PHP " + n.toFixed(2);
}

function integer(v: unknown): string {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? String(Math.max(0, Math.round(n))) : "0";
}

function pct(v: unknown): string {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n)) return "0.0%";
  return n.toFixed(1) + "%";
}

function formatGeneratedAt(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(d);
}

function readStoredVendorId(): string {
  if (typeof window === "undefined") return "";

  const params = new URLSearchParams(window.location.search);
  const fromUrl = text(params.get("vendor_id"));
  if (fromUrl) return fromUrl;

  for (const key of VENDOR_ID_KEYS) {
    const candidates = [window.sessionStorage.getItem(key), window.localStorage.getItem(key)];
    for (const value of candidates) {
      const id = text(value);
      if (id) return id;
    }
  }

  return "";
}

function persistVendorId(vendorId: string) {
  if (typeof window === "undefined") return;
  const id = text(vendorId);
  if (!id) return;

  for (const key of VENDOR_ID_KEYS) {
    try {
      window.localStorage.setItem(key, id);
      window.sessionStorage.setItem(key, id);
    } catch {
      // Storage may be unavailable in a restricted WebView.
    }
  }
}

async function readJson(url: string): Promise<AnalyticsPayload> {
  const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body?.ok === false) {
    throw new Error(text(body?.message || body?.error || "REQUEST_FAILED"));
  }
  return body as AnalyticsPayload;
}

function MetricCard(props: { label: string; value: React.ReactNode; note?: string; strong?: boolean }) {
  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-slate-900/80 p-4 shadow-lg">
      <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">{props.label}</div>
      <div className={"mt-1 font-black tracking-tight text-white " + (props.strong ? "text-2xl" : "text-xl")}>
        {props.value}
      </div>
      {props.note ? <div className="mt-1 text-[11px] leading-4 text-slate-400">{props.note}</div> : null}
    </div>
  );
}

function SmallStat(props: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-3">
      <div className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{props.label}</div>
      <div className="mt-1 text-lg font-black text-slate-100">{props.value}</div>
    </div>
  );
}

function EmptyState({ text: value }: { text: string }) {
  return <div className="rounded-xl border border-slate-700 bg-slate-950/50 p-4 text-sm text-slate-400">{value}</div>;
}

export default function VendorAnalyticsPage() {
  const [vendorId, setVendorId] = useState("");
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = readStoredVendorId();
    if (id) {
      setVendorId(id);
      persistVendorId(id);
    }
  }, []);

  async function loadAnalytics() {
    const vid = text(vendorId);
    if (!vid) {
      setError("Vendor session was not found. Return to the Vendor Portal and open Analytics again.");
      setData(null);
      return;
    }

    setLoading(true);
    setError("");
    try {
      persistVendorId(vid);
      const payload = await readJson(
        "/api/vendor-analytics/summary?vendor_id=" +
          encodeURIComponent(vid) +
          "&period=" +
          encodeURIComponent(period),
      );
      setData(payload);
    } catch (err: any) {
      setError(text(err?.message) || "Failed to load vendor analytics.");
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
    if (period === "week") return "This week";
    if (period === "month") return "This month";
    return "All time";
  }, [period]);

  const maxSalesDay = useMemo(
    () => Math.max(1, ...salesTrend.map((row) => Number(row.sales || 0))),
    [salesTrend],
  );
  const maxHourly = useMemo(
    () => Math.max(1, ...hourlyDemand.map((row) => Number(row.count || 0))),
    [hourlyDemand],
  );

  const vendorQuery = text(vendorId) ? "?vendor_id=" + encodeURIComponent(text(vendorId)) : "";

  return (
    <main
      className="min-h-screen bg-[#031016] px-3 pb-24 text-slate-100 sm:px-4"
      style={{ paddingTop: "max(56px, calc(env(safe-area-inset-top, 0px) + 12px))" }}
    >
      <div className="mx-auto max-w-6xl space-y-4">
        <section className="rounded-3xl border border-emerald-500/25 bg-[#071820] p-4 shadow-2xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-emerald-300">JRide Takeout</div>
              <h1 className="mt-1 text-2xl font-black tracking-tight text-white">Vendor Analytics</h1>
              <div className="mt-1 text-sm text-slate-400">{periodLabel} performance from real vendor activity.</div>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <a href={"/vendor-portal" + vendorQuery} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-black text-slate-200">
                Portal
              </a>
              <a href={"/vendor-orders" + vendorQuery} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-black text-slate-200">
                Orders
              </a>
              <button type="button" onClick={() => void loadAnalytics()} disabled={loading} className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-black text-emerald-100 disabled:opacity-50">
                {loading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-4 gap-2 print:hidden">
            {(["today", "week", "month", "all"] as PeriodKey[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => setPeriod(key)}
                className={
                  "rounded-xl border px-2 py-2 text-[11px] font-black " +
                  (period === key
                    ? "border-emerald-300 bg-emerald-400 text-slate-950"
                    : "border-slate-700 bg-slate-950 text-slate-300")
                }
              >
                {key === "today" ? "Today" : key === "week" ? "Week" : key === "month" ? "Month" : "All"}
              </button>
            ))}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
            <div>
              {data?.generated_at ? "Updated " + formatGeneratedAt(data.generated_at) : loading ? "Loading analytics..." : ""}
            </div>
            {data?.test_data_excluded ? (
              <div className="rounded-full border border-blue-400/30 bg-blue-500/10 px-2.5 py-1 font-bold text-blue-200">
                Test activity excluded{Number(data.excluded_test_orders || 0) > 0 ? ": " + integer(data.excluded_test_orders) + " orders" : ""}
              </div>
            ) : null}
          </div>

          {error ? <div className="mt-3 rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 text-sm font-semibold text-rose-100">{error}</div> : null}
        </section>

        {!data && !loading ? null : (
          <>
            <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="Food sales" value={money(summary.gross_food_sales)} note="Completed orders only" strong />
              <MetricCard label="Completed" value={integer(summary.completed_orders)} note="Successfully completed" strong />
              <MetricCard label="Avg order" value={money(summary.average_order_value)} note="Food sales per completed order" />
              <MetricCard label="Cancellation rate" value={pct(summary.cancellation_rate)} note={integer(summary.cancelled_orders) + " cancelled/timeout"} />
            </section>

            <section className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-black text-white">Order performance</h2>
                  <p className="mt-1 text-xs text-slate-400">Operational health for this report period.</p>
                </div>
                <button type="button" onClick={() => window.print()} className="rounded-xl border border-slate-600 bg-slate-950 px-3 py-2 text-xs font-black text-slate-200 print:hidden">
                  Print report
                </button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <SmallStat label="Total orders" value={integer(summary.total_orders)} />
                <SmallStat label="Active" value={integer(summary.active_orders)} />
                <SmallStat label="Acceptance" value={pct(summary.acceptance_rate)} />
                <SmallStat label="Completion" value={pct(summary.completion_rate)} />
                <SmallStat label="Timeouts" value={integer(summary.vendor_timeout_count)} />
                <SmallStat label="Manual rejects" value={integer(summary.manual_vendor_rejections)} />
                <SmallStat label="Receipt requests" value={integer(summary.receipt_requests)} />
                <SmallStat label="Timeout rate" value={pct(summary.vendor_timeout_rate)} />
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
                <h2 className="text-lg font-black text-white">Top-selling items</h2>
                <p className="mt-1 text-xs text-slate-400">Ranked by completed quantity.</p>
                <div className="mt-3 space-y-2">
                  {topItems.length === 0 ? <EmptyState text="No completed item sales in this period." /> : topItems.map((item, index) => (
                    <div key={item.name} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-xs font-black text-emerald-200">
                        {index + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-white">{item.name}</div>
                        <div className="mt-0.5 text-[11px] text-slate-400">{integer(item.quantity)} sold</div>
                      </div>
                      <div className="shrink-0 text-sm font-black text-slate-100">{money(item.sales)}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
                <h2 className="text-lg font-black text-white">Sales breakdown</h2>
                <p className="mt-1 text-xs text-slate-400">Vendor revenue and order charges are kept separate.</p>
                <div className="mt-3 space-y-2 text-sm">
                  <div className="flex justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3"><span className="text-slate-400">Food/item sales</span><span className="font-black text-white">{money(summary.gross_food_sales)}</span></div>
                  <div className="flex justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3"><span className="text-slate-400">Packaging revenue</span><span className="font-black text-white">{money(summary.packaging_revenue)}</span></div>
                  <div className="flex justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3"><span className="text-slate-400">Delivery fees</span><span className="font-black text-slate-200">{money(summary.delivery_fees)}</span></div>
                  <div className="flex justify-between gap-4 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3"><span className="text-slate-400">Service fees</span><span className="font-black text-slate-200">{money(summary.service_fees)}</span></div>
                </div>
                <div className="mt-3 rounded-xl border border-blue-400/30 bg-blue-500/10 p-3 text-[11px] leading-5 text-blue-100">
                  Driver delivery fees are not vendor sales. Analytics uses completed orders for vendor food/item sales.
                </div>
              </div>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
                <h2 className="text-lg font-black text-white">Sales by day</h2>
                <div className="mt-3 space-y-2">
                  {salesTrend.length === 0 ? <EmptyState text="No completed sales in this period." /> : salesTrend.map((row) => {
                    const width = Math.max(3, Math.round((Number(row.sales || 0) / maxSalesDay) * 100));
                    return (
                      <div key={row.date} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-300">{row.date}</span><span className="font-black text-white">{money(row.sales)}</span></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: width + "%" }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
                <h2 className="text-lg font-black text-white">Hourly demand</h2>
                <div className="mt-3 space-y-2">
                  {hourlyDemand.length === 0 ? <EmptyState text="No hourly demand in this period." /> : hourlyDemand.map((row) => {
                    const width = Math.max(3, Math.round((Number(row.count || 0) / maxHourly) * 100));
                    return (
                      <div key={row.hour} className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
                        <div className="flex items-center justify-between gap-3 text-xs"><span className="font-bold text-slate-300">{row.hour}</span><span className="font-black text-white">{integer(row.count)} orders</span></div>
                        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-blue-400" style={{ width: width + "%" }} /></div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-emerald-500/20 bg-[#071820] p-4 shadow-xl">
              <h2 className="text-lg font-black text-white">Cancellation reasons</h2>
              <p className="mt-1 text-xs text-slate-400">Use this to identify recurring fulfillment problems.</p>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {cancellationReasons.length === 0 ? <EmptyState text="No cancellations in this period." /> : cancellationReasons.map((reason) => (
                  <div key={reason.reason} className="flex items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-3 text-sm">
                    <span className="min-w-0 text-slate-300">{reason.reason}</span>
                    <span className="shrink-0 rounded-full border border-rose-400/30 bg-rose-500/10 px-2.5 py-1 text-xs font-black text-rose-100">{integer(reason.count)}</span>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
