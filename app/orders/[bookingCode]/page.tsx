"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

type Booking = {
  id: string;
  booking_code: string;
  passenger_name: string | null;
  service_type: string | null;
  customer_status: string | null;
  vendor_status: string | null;
  base_fee: number;
  distance_fare: number;
  waiting_fee: number;
  extra_stop_fee: number;
  company_cut: number;
  driver_payout: number;
  total_bill: number;
  created_at: string;
  vendor_driver_arrived_at: string | null;
  vendor_order_picked_at: string | null;
};

type ApiState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; booking: Booking };

export default function OrderStatusPage() {
  const params = useParams();
  const router = useRouter();
  const bookingCode = (params?.bookingCode as string) ?? "";

  const [state, setState] = useState<ApiState>({ status: "loading" });

  useEffect(() => {
    if (!bookingCode) return;

    let cancelled = false;

    async function load() {
      setState({ status: "loading" });
      try {
        const res = await fetch(
          `/api/orders/${encodeURIComponent(bookingCode)}`,
          { cache: "no-store" }
        );

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || `Request failed (${res.status})`);
        }

        const json = (await res.json()) as { booking: Booking };
        if (!cancelled) {
          setState({ status: "loaded", booking: json.booking });
        }
      } catch (err: any) {
        if (!cancelled) {
          setState({
            status: "error",
            message: err.message || "Unknown error",
          });
        }
      }
    }

    load();
    const timer = setInterval(load, 15000); // refresh every 15s

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [bookingCode]);

  const goBack = () => {
    router.back();
  };

  const renderStatusChip = (booking: Booking) => {
    const s = booking.customer_status || booking.vendor_status || "";
    const label = s.replace(/_/g, " ") || "on the way";

    let cls =
      "inline-flex items-center rounded-full px-3 py-1 text-xs font-medium border ";
    if (s === "vendor_preparing" || s === "preparing") {
      cls += "bg-amber-50 text-amber-700 border-amber-200";
    } else if (s === "driver_arrived") {
      cls += "bg-sky-50 text-sky-700 border-sky-200";
    } else if (s === "on_the_way") {
      cls += "bg-emerald-50 text-emerald-700 border-emerald-200";
    } else if (s === "completed") {
      cls += "bg-slate-50 text-slate-700 border-slate-300";
    } else {
      cls += "bg-slate-50 text-slate-600 border-slate-200";
    }

    return <span className={cls}>{label}</span>;
  };

  const formatPeso = (v: number) => `₱${v.toFixed(2)}`;

  if (state.status === "loading" || state.status === "idle") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
          Loading your order status…
        </div>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-3">
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            We could not load your order. {state.message}
          </div>
          <button
            type="button"
            onClick={goBack}
            className="w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  if (state.status !== "loaded") return null;
  const booking = state.booking;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-xl px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              Takeout order
            </p>
            <h1 className="text-sm font-semibold text-slate-900">
              {booking.booking_code}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {renderStatusChip(booking)}
            <button
              type="button"
              onClick={goBack}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-xl px-4 py-4 space-y-4">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-slate-700 mb-2">
            Order progress
          </h2>
          <p className="text-xs text-slate-600">
            We&apos;ll update this screen as your order moves from{" "}
            <span className="font-medium">preparing</span> to{" "}
            <span className="font-medium">driver arrived</span> and{" "}
            <span className="font-medium">on the way</span>.
          </p>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h2 className="text-xs font-semibold text-slate-700 mb-3">
            Fare breakdown
          </h2>
          <div className="space-y-1 text-xs text-slate-600">
            <div className="flex justify-between">
              <span>Base fee</span>
              <span>{formatPeso(booking.base_fee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Distance fare</span>
              <span>{formatPeso(booking.distance_fare)}</span>
            </div>
            <div className="flex justify-between">
              <span>Waiting time</span>
              <span>{formatPeso(booking.waiting_fee)}</span>
            </div>
            <div className="flex justify-between">
              <span>Extra stops</span>
              <span>{formatPeso(booking.extra_stop_fee)}</span>
            </div>
            <div className="border-t border-dashed border-slate-200 my-2" />
            <div className="flex justify-between font-semibold text-slate-900">
              <span>Total service fee</span>
              <span>{formatPeso(booking.total_bill)}</span>
            </div>
          </div>
          <p className="mt-3 text-[11px] text-slate-400">
            Final amount you pay may include food cost and other charges agreed
            with the rider.
          </p>
        </section>
      </main>
    </div>
  );
}
