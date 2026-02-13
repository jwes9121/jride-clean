"use client";

import { useEffect, useMemo, useState } from "react";

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

type WeekBucket = {
  key: string;
  start: Date;
  end: Date;
  orders: TakeoutOrder[];
  grossBillings: number;
  platformFees: number;
  vendorEarnings: number;
  averageRating: number | null;
  orderCount: number;
  ratedCount: number;
};

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function formatMoney(value: number): string {
  if (!Number.isFinite(value)) return "₱0.00";
  return `₱${value.toFixed(2)}`;
}

function formatWeekRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
  };
  const yearOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };
  const sameYear = start.getFullYear() === end.getFullYear();

  const startStr = start.toLocaleDateString(undefined, sameYear ? opts : yearOpts);
  const endStr = end.toLocaleDateString(undefined, yearOpts);

  return `${startStr} – ${endStr}`;
}

// Normalize to Monday as start-of-week (ISO-like)
function getWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay(); // 0 (Sun) - 6 (Sat)
  const diff = day === 0 ? -6 : 1 - day; // shift so Monday=1
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d;
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

function buildWeekBuckets(orders: TakeoutOrder[]): WeekBucket[] {
  const buckets = new Map<string, WeekBucket>();

  for (const order of orders) {
    const created = parseDate(order.created_at);
    if (!created) continue;

    const start = getWeekStart(created);
    const end = addDays(start, 6);

    const key = `${start.getFullYear()}-${start.getMonth() + 1}-${start.getDate()}`;

    if (!buckets.has(key)) {
      buckets.set(key, {
        key,
        start,
        end,
        orders: [],
        grossBillings: 0,
        platformFees: 0,
        vendorEarnings: 0,
        averageRating: null,
        orderCount: 0,
        ratedCount: 0,
      });
    }

    const bucket = buckets.get(key)!;
    bucket.orders.push(order);
  }

  // Compute aggregates
  for (const bucket of buckets.values()) {
    let gross = 0;
    let platform = 0;
    let vendorEarn = 0;
    let rated = 0;

    for (const o of bucket.orders) {
      const bill = Number.isFinite(o.total_bill) ? o.total_bill : 0;
      const pf = Number.isFinite(o.platform_fee) ? o.platform_fee : 0;
      gross += bill;
      platform += pf;
      vendorEarn += bill - pf;
      if (o.rating_avg && o.rating_count > 0) {
        rated += 1;
      }
    }

    bucket.grossBillings = gross;
    bucket.platformFees = platform;
    bucket.vendorEarnings = vendorEarn;
    bucket.orderCount = bucket.orders.length;
    bucket.ratedCount = rated;
    bucket.averageRating = computeWeightedAverageRating(bucket.orders);
  }

  // Sort by start date desc (latest week first)
  const list = Array.from(buckets.values());
  list.sort((a, b) => b.start.getTime() - a.start.getTime());

  // Limit to last 12 weeks for now
  return list.slice(0, 12);
}

export default function VendorPayoutsPage() {
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
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
        console.error("Failed to load payouts:", err);
        setError(err?.message || "Failed to load payout data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const buckets = useMemo(() => buildWeekBuckets(orders), [orders]);

  const totalVendorEarnings = useMemo(
    () => buckets.reduce((sum, b) => sum + b.vendorEarnings, 0),
    [buckets]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="rounded-2xl bg-white px-6 py-4 text-sm text-slate-600 shadow-sm">
          Loading payout summary…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="max-w-md rounded-2xl bg-white px-6 py-5 text-sm text-slate-700 shadow-sm">
          <div className="text-base font-semibold text-slate-900">
            Unable to load payout summary
          </div>
          <p className="mt-2 text-xs text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        {/* Header & summary */}
        <section>
          <h1 className="text-lg font-semibold text-slate-900">
            Payout summary
          </h1>
          <p className="mt-1 text-xs text-slate-500 max-w-xl">
            Weekly breakdown of your takeout orders – grouped by cut-off week,
            with gross billings, JRide platform fees, and your net vendor earnings.
          </p>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Weeks shown
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {buckets.length}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Most recent payout weeks
              </div>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Total vendor earnings
              </div>
              <div className="mt-2 text-xl font-semibold text-slate-900">
                {formatMoney(totalVendorEarnings)}
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Across all weeks listed
              </div>
            </div>
            <div className="rounded-2xl bg-white px-4 py-3 shadow-sm">
              <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                Data source
              </div>
              <div className="mt-2 text-sm font-semibold text-slate-900">
                Takeout vendor ratings
              </div>
              <div className="mt-1 text-[11px] text-slate-400">
                Based on completed & billed orders
              </div>
            </div>
          </div>
        </section>

        {/* Weekly table */}
        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Weekly payout breakdown
              </h2>
              <p className="mt-1 text-[11px] text-slate-500">
                Each row is one payout week (Monday–Sunday). Use this when reconciling
                your JRide statements or doing manual payouts.
              </p>
            </div>
          </div>

          {buckets.length === 0 ? (
            <div className="mt-6 text-center text-xs text-slate-400">
              No orders found yet for payout summary.
            </div>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-[10px] uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-2">Week</th>
                    <th className="px-2 py-2 text-right">Orders</th>
                    <th className="px-2 py-2 text-right">Rated</th>
                    <th className="px-2 py-2 text-right">Gross billings</th>
                    <th className="px-2 py-2 text-right">Platform fees</th>
                    <th className="px-2 py-2 text-right">Vendor earnings</th>
                    <th className="px-2 py-2 text-right">Avg rating</th>
                  </tr>
                </thead>
                <tbody>
                  {buckets.map((b) => (
                    <tr
                      key={b.key}
                      className="border-b border-slate-50 text-[11px] text-slate-700 hover:bg-slate-50/60"
                    >
                      <td className="px-2 py-2">
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">
                            {formatWeekRange(b.start, b.end)}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            Mon–Sun cut-off
                          </span>
                        </div>
                      </td>
                      <td className="px-2 py-2 text-right">
                        {b.orderCount}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {b.ratedCount}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatMoney(b.grossBillings)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {formatMoney(b.platformFees)}
                      </td>
                      <td className="px-2 py-2 text-right font-semibold text-slate-900">
                        {formatMoney(b.vendorEarnings)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        {b.averageRating !== null ? (
                          <span className="inline-flex items-center justify-end gap-1">
                            {b.averageRating.toFixed(1)}
                            <span className="text-amber-400 text-sm">★</span>
                          </span>
                        ) : (
                          <span className="text-[10px] text-slate-400">
                            No ratings
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}