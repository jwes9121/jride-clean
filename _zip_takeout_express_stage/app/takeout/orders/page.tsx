"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type TakeoutOrder = {
  id: string;
  booking_code: string;
  service_type: string | null;
  status: string | null;
  customer_status: string | null;
  vendor_status: string | null;
  created_at: string | null;
  updated_at: string | null;
  base_fee?: number | string | null;
  distance_fare?: number | string | null;
  waiting_fee?: number | string | null;
  extra_stop_fee?: number | string | null;
  company_cut?: number | string | null;
  driver_payout?: number | string | null;
  total_bill?: number | string | null;
};

type OrdersListResponse = {
  orders: TakeoutOrder[];
};

function parseMoney(value: unknown): number {
  if (value === null || value === undefined) return 0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n;
}

function formatMoney(value: unknown): string {
  const n = parseMoney(value);
  return n.toFixed(2);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

function getDisplayStatus(order: TakeoutOrder): string {
  // Prefer customer_status → vendor_status → status
  return (
    order.customer_status ||
    order.vendor_status ||
    order.status ||
    "unknown"
  ).replace(/_/g, " ");
}

const ACTIVE_STATUSES = new Set([
  "pending",
  "pending_confirmation",
  "order_accepted",
  "preparing_order",
  "ready_for_pickup",
  "on_the_way",
  "picked_up",
  "driver_arrived",
]);

const PAST_STATUSES = new Set(["completed", "cancelled"]);

function isActive(order: TakeoutOrder): boolean {
  const s =
    (order.customer_status ||
      order.vendor_status ||
      order.status ||
      ""
    ).toLowerCase();
  if (ACTIVE_STATUSES.has(s)) return true;
  if (PAST_STATUSES.has(s)) return false;
  // Fallback: treat unknown as active so it doesn't disappear
  return true;
}

export default function TakeoutOrdersPage() {
  const [orders, setOrders] = useState<TakeoutOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/takeout/orders-list", {
          method: "GET",
          cache: "no-store",
        });

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Failed with status ${res.status}`);
        }

        const body = (await res.json()) as OrdersListResponse;

        if (!cancelled) {
          setOrders(body.orders ?? []);
        }
      } catch (err: any) {
        console.error("❌ Failed to load takeout orders:", err);
        if (!cancelled) {
          setError(err?.message || "Failed to load orders");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeOrders = orders.filter(isActive);
  const pastOrders = orders.filter((o) => !isActive(o));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
        {/* Header card */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">
            My takeout history
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            View the status and receipts of your recent takeout orders. Tap an
            order to open its status or receipt screen.
          </p>
        </section>

        {/* Active orders */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Active orders
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              {activeOrders.length} active
            </span>
          </div>

          {loading && (
            <p className="text-sm text-slate-500">Loading takeout orders…</p>
          )}

          {!loading && activeOrders.length === 0 && (
            <p className="text-sm text-slate-500">
              You have no active takeout orders right now.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {activeOrders.map((order) => (
              <Link
                key={order.id}
                href={`/takeout/orders/${encodeURIComponent(
                  order.booking_code
                )}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm transition hover:border-sky-200 hover:bg-sky-50"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-slate-900">
                    {order.booking_code}
                  </span>
                  <span className="text-xs text-slate-500">
                    Placed: {formatDate(order.created_at)}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700">
                    {getDisplayStatus(order)}
                  </span>
                  <span className="text-right text-sm font-semibold text-slate-900">
                    ₱{formatMoney(order.total_bill)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* Past orders */}
        <section className="rounded-2xl bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
              Past orders
            </h2>
            <span className="text-xs text-slate-400">
              {pastOrders.length} total
            </span>
          </div>

          {!loading && pastOrders.length === 0 && (
            <p className="text-sm text-slate-500">
              Your completed and cancelled takeout orders will appear here.
            </p>
          )}

          <div className="flex flex-col gap-3">
            {pastOrders.map((order) => (
              <Link
                key={order.id}
                href={`/takeout/orders/${encodeURIComponent(
                  order.booking_code
                )}`}
                className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm transition hover:border-sky-200 hover:bg-sky-50"
              >
                <div className="flex flex-col">
                  <span className="font-medium text-slate-900">
                    {order.booking_code}
                  </span>
                  <span className="text-xs text-slate-500">
                    Updated: {formatDate(order.updated_at || order.created_at)}
                  </span>
                </div>

                <div className="flex items-center gap-4">
                  <span className="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                    {getDisplayStatus(order)}
                  </span>
                  <span className="text-right text-sm font-semibold text-slate-900">
                    ₱{formatMoney(order.total_bill)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          {error && (
            <p className="mt-4 text-xs text-red-500">
              Error: Failed to load orders: {error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
