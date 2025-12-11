"use client";

import { useEffect, useState, useMemo } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

type FareBreakdown = {
  base_fee: number;
  distance_fare: number;
  waiting_fee: number;
  extra_stop_fee: number;
  company_cut: number;
  items_total: number;
  delivery_fee: number;
  platform_fee: number;
  other_fees: number;
  grand_total: number;
};

type Order = {
  id: string;
  booking_code: string;
  service_type?: string | null;
  status?: string | null;
  customer_status?: string | null;
  vendor_status?: string | null;
  vendor_name?: string | null;
  customer_name?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  vendor_driver_arrived_at?: string | null;
  vendor_order_picked_at?: string | null;
  base_fee?: number | null;
  distance_fare?: number | null;
  waiting_fee?: number | null;
  extra_stop_fee?: number | null;
  company_cut?: number | null;
  driver_payout?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  fare_breakdown?: FareBreakdown | null;
  [key: string]: any;
};

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseAnonKey);

type PageProps = {
  params: { bookingCode: string };
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending confirmation",
  accepted: "Order accepted",
  preparing: "Preparing your order",
  ready_for_pickup: "Ready for pickup",
  picked_up: "On the way",
  completed: "Completed",
  cancelled: "Cancelled",
};

const STATUS_ORDER: string[] = [
  "pending",
  "accepted",
  "preparing",
  "ready_for_pickup",
  "picked_up",
  "completed",
];

function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `₱${value.toFixed(2)}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString();
}

function normalizeStatus(order: Order | null): string {
  if (!order) return "pending";

  const raw =
    (order.customer_status ??
      order.vendor_status ??
      order.status ??
      ""
    ).toString()
      .toLowerCase()
      .trim();

  switch (raw) {
    case "new":
    case "pending":
    case "created":
      return "pending";

    case "assigned":
    case "accepted":
    case "order_accepted":
      return "accepted";

    case "preparing":
    case "preparing_order":
      return "preparing";

    case "driver_arrived":
    case "ready_for_pickup":
      return "ready_for_pickup";

    case "on_the_way":
    case "on_the_way_to_customer":
    case "order_picked_up":
    case "picked_up":
    case "on_trip":
      return "picked_up";

    case "completed":
    case "done":
      return "completed";

    case "cancelled":
    case "canceled":
    case "cancelled_by_vendor":
    case "cancelled_by_customer":
      return "cancelled";

    default:
      return "pending";
  }
}

export default function TakeoutOrderStatusPage({ params }: PageProps) {
  const bookingCode = decodeURIComponent(params.bookingCode);
  const router = useRouter();

  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  const normalizedStatus = useMemo(
    () => normalizeStatus(order),
    [order?.status, order?.customer_status, order?.vendor_status]
  );

  const statusLabel = useMemo(() => {
    const key = normalizedStatus || "pending";
    return STATUS_LABELS[key] ?? `Status: ${order?.status ?? "Unknown"}`;
  }, [normalizedStatus, order?.status]);

  const breakdown = useMemo(() => {
    const fb = order?.fare_breakdown;

    if (fb) {
      return fb;
    }

    const base_fee = Number(order?.base_fee ?? 0);
    const distance_fare = Number(order?.distance_fare ?? 0);
    const waiting_fee = Number(order?.waiting_fee ?? 0);
    const extra_stop_fee = Number(order?.extra_stop_fee ?? 0);
    const company_cut = Number(order?.company_cut ?? 0);

    const items_total = base_fee;
    const delivery_fee = distance_fare + waiting_fee + extra_stop_fee;
    const platform_fee = company_cut;
    const other_fees = 0;
    const grand_total = items_total + delivery_fee + platform_fee + other_fees;

    return {
      base_fee,
      distance_fare,
      waiting_fee,
      extra_stop_fee,
      company_cut,
      items_total,
      delivery_fee,
      platform_fee,
      other_fees,
      grand_total,
    };
  }, [order]);

  async function fetchOrder(showSpinner: boolean = false) {
    try {
      if (showSpinner) setLoading(true);
      setError(null);

      const res = await fetch(`/api/orders/${encodeURIComponent(bookingCode)}`);
      if (!res.ok) {
        throw new Error(`Failed to load order: ${res.status}`);
      }

      const data = await res.json();
      const newOrder: Order = (data.booking ?? data.order ?? data) as Order;

      setOrder((prev) => {
        if (!prev) return newOrder;
        if (prev.status !== newOrder.status) return newOrder;
        if (prev.customer_status !== newOrder.customer_status)
          return newOrder;
        if (JSON.stringify(prev) !== JSON.stringify(newOrder)) return newOrder;
        return prev;
      });
    } catch (err: any) {
      console.error("Error fetching order", err);
      setError(err?.message ?? "Error loading order");
    } finally {
      if (showSpinner) setLoading(false);
    }
  }

  useEffect(() => {
    fetchOrder(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCode]);

  useEffect(() => {
    if (!bookingCode) return;

    let channel: RealtimeChannel | null = null;
    setRealtimeConnected(false);

    try {
      channel = supabase
        .channel(`takeout-order-${bookingCode}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "bookings",
            filter: `booking_code=eq.${bookingCode}`,
          },
          () => {
            fetchOrder(false);
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setRealtimeConnected(true);
          }
        });
    } catch (err) {
      console.error("Error setting up realtime subscription", err);
    }

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCode]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchOrder(false);
    }, 30000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookingCode]);

  // Auto redirect to receipt when completed
  useEffect(() => {
    if (normalizedStatus !== "completed") return;

    const timeout = setTimeout(() => {
      router.push(
        `/takeout/orders/${encodeURIComponent(bookingCode)}/receipt`
      );
    }, 4000);

    return () => clearTimeout(timeout);
  }, [normalizedStatus, bookingCode, router]);

  const currentStepIndex = useMemo(() => {
    const idx = STATUS_ORDER.indexOf(normalizedStatus);
    if (idx === -1) return 0;
    return idx;
  }, [normalizedStatus]);

  const canTrack =
    normalizedStatus === "ready_for_pickup" ||
    normalizedStatus === "picked_up" ||
    normalizedStatus === "completed";

  function buildUrl(path: string) {
    if (typeof window === "undefined") return path;
    const base = window.location.origin;
    return `${base}${path}`;
  }

  async function copyLink(type: "track" | "receipt") {
    try {
      const path =
        type === "track"
          ? `/takeout/orders/${encodeURIComponent(bookingCode)}/track`
          : `/takeout/orders/${encodeURIComponent(bookingCode)}/receipt`;

      const url = buildUrl(path);

      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      }

      setCopyMessage(
        type === "track"
          ? "Tracking link copied."
          : "Receipt link copied."
      );
      setTimeout(() => setCopyMessage(null), 2500);
    } catch {
      setCopyMessage("Could not copy link on this device.");
      setTimeout(() => setCopyMessage(null), 2500);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-6">
        <div className="bg-white rounded-2xl shadow-md px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 uppercase tracking-wide">
              Order Code
            </p>
            <p className="font-semibold text-slate-900 text-lg">
              {bookingCode}
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {canTrack && (
                <button
                  type="button"
                  onClick={() =>
                    router.push(
                      `/takeout/orders/${encodeURIComponent(
                        bookingCode
                      )}/track`
                    )
                  }
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-slate-900 text-white"
                >
                  Track order on map
                </button>
              )}
              {canTrack && (
                <button
                  type="button"
                  onClick={() => copyLink("track")}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                >
                  Copy tracking link
                </button>
              )}
              {normalizedStatus === "completed" && (
                <button
                  type="button"
                  onClick={() => copyLink("receipt")}
                  className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200"
                >
                  Copy receipt link
                </button>
              )}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500 mb-1">
              {order?.vendor_name ?? "Takeout vendor"}
            </p>
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium
              ${
                normalizedStatus === "completed"
                  ? "bg-emerald-100 text-emerald-700"
                  : normalizedStatus === "cancelled"
                  ? "bg-rose-100 text-rose-700"
                  : "bg-blue-100 text-blue-700"
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-current mr-2" />
              {statusLabel}
            </span>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-md px-5 py-4">
          <p className="text-xs text-slate-500 mb-3 uppercase tracking-wide">
            Order progress
          </p>
          <div className="relative flex items-center justify-between">
            {STATUS_ORDER.map((step, index) => {
              const done = index <= currentStepIndex;
              const label = STATUS_LABELS[step] ?? step;

              return (
                <div
                  key={step}
                  className="flex-1 flex flex-col items-center text-center"
                >
                  <div className="relative flex items-center w-full">
                    <div className="w-full h-1 bg-slate-200 rounded-full">
                      <div
                        className={`h-1 rounded-full transition-all duration-300
                          ${done ? "bg-blue-500" : "bg-slate-200"}`}
                        style={{
                          width:
                            index === 0 && !done
                              ? "0%"
                              : done
                              ? "100%"
                              : "0%",
                        }}
                      />
                    </div>
                    <div className="absolute left-1/2 -translate-x-1/2 -top-2">
                      <div
                        className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px]
                          ${
                            done
                              ? "bg-blue-500 border-blue-500 text-white"
                              : "bg-white border-slate-300 text-slate-500"
                          }`}
                      >
                        {index + 1}
                      </div>
                    </div>
                  </div>
                  <p className="mt-6 text-[11px] leading-tight text-slate-600">
                    {label}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Placed: {formatDateTime(order?.created_at)}</span>
            <span>Updated: {formatDateTime(order?.updated_at)}</span>
          </div>

          {normalizedStatus === "completed" && (
            <p className="mt-3 text-[11px] text-emerald-600">
              Order completed ✓ Redirecting to your receipt…
            </p>
          )}
          {copyMessage && (
            <p className="mt-2 text-[11px] text-slate-600">{copyMessage}</p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-md px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500 mb-1 uppercase tracking-wide">
            Fare breakdown
          </p>

          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Items total</span>
            <span className="font-medium text-slate-900">
              {formatMoney(breakdown.items_total)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Delivery fee</span>
            <span className="font-medium text-slate-900">
              {formatMoney(breakdown.delivery_fee)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Platform fee</span>
            <span className="font-medium text-slate-900">
              {formatMoney(breakdown.platform_fee)}
            </span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-slate-600">Other fees</span>
            <span className="font-medium text-slate-900">
              {formatMoney(breakdown.other_fees)}
            </span>
          </div>

          <div className="border-t border-slate-200 pt-3 mt-1 flex justify-between text-base">
            <span className="font-semibold text-slate-900">Total</span>
            <span className="font-bold text-emerald-600">
              {formatMoney(breakdown.grand_total)}
            </span>
          </div>
        </div>

        <div className="text-xs text-slate-500 flex flex-col gap-1 items-start">
          {loading && <span>Loading latest order status…</span>}
          {error && (
            <span className="text-rose-600">
              Error: {error} (you can pull to refresh / reload app)
            </span>
          )}
          <span>
            Realtime:{" "}
            <span
              className={
                realtimeConnected ? "text-emerald-600" : "text-slate-400"
              }
            >
              {realtimeConnected ? "Connected" : "Waiting for updates…"}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
