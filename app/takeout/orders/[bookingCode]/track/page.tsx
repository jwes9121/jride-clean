"use client";

import { useEffect, useMemo, useState } from "react";

type FareBreakdown = {
  items_total: number;
  delivery_fee: number;
  platform_fee: number;
  other_fees: number;
  grand_total: number;
};

type Order = {
  id: string;
  booking_code: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  fare_breakdown?: FareBreakdown | null;
  [key: string]: any;
};

type PageProps = {
  params: { bookingCode: string };
};

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString();
}

export default function TakeoutTrackPage({ params }: PageProps) {
  const bookingCode = decodeURIComponent(params.bookingCode);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const mapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch(`/api/orders/${encodeURIComponent(bookingCode)}`);
        if (!res.ok) {
          throw new Error(`Failed to load order: ${res.status}`);
        }
        const data = await res.json();
        const o: Order = (data.booking ?? data.order ?? data) as Order;
        setOrder(o);
      } catch (err: any) {
        console.error("Error loading tracking order", err);
        setError(err?.message ?? "Error loading order");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [bookingCode]);

  const staticMapUrl = useMemo(() => {
    if (!mapboxToken) return null;
    if (!order) return null;

    const pickupLat = order.pickup_lat;
    const pickupLng = order.pickup_lng;
    const dropLat = order.dropoff_lat;
    const dropLng = order.dropoff_lng;

    if (
      pickupLat === null ||
      pickupLat === undefined ||
      pickupLng === null ||
      pickupLng === undefined ||
      dropLat === null ||
      dropLat === undefined ||
      dropLng === null ||
      dropLng === undefined
    ) {
      return null;
    }

    const base = "https://api.mapbox.com/styles/v1/mapbox/streets-v11/static";

    const pins = [
      // Vendor / pickup – blue
      `pin-s+1D4ED8(${pickupLng},${pickupLat})`,
      // Customer / dropoff – green
      `pin-s+16A34A(${dropLng},${dropLat})`,
    ].join(",");

    const size = "600x400";
    const url = `${base}/${pins}/auto/${size}?access_token=${mapboxToken}`;

    return url;
  }, [order, mapboxToken]);

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center px-4 py-8">
      <div className="w-full max-w-xl space-y-4">
        <div className="bg-white rounded-2xl shadow-md px-5 py-4">
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-1">
            Track your order
          </p>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">
            Order code: {bookingCode}
          </h1>
          <p className="text-xs text-slate-500">
            Updated:{" "}
            <span className="font-medium">
              {formatDateTime(order?.updated_at ?? order?.created_at)}
            </span>
          </p>
          <p className="mt-2 text-[11px] text-slate-500">
            The map shows the vendor location and your dropoff location. This is
            a first version of live tracking – later we can add the rider icon
            as we wire driver GPS for takeout.
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-md px-5 py-4 flex items-center justify-center">
          {loading && <p className="text-sm text-slate-500">Loading map…</p>}
          {!loading && error && (
            <p className="text-sm text-rose-600">Error: {error}</p>
          )}
          {!loading && !error && !staticMapUrl && (
            <p className="text-sm text-slate-500">
              Map not available for this order (missing pickup/dropoff
              coordinates or Mapbox token).
            </p>
          )}
          {!loading && !error && staticMapUrl && (
            <img
              src={staticMapUrl}
              alt="Takeout route map"
              className="w-full rounded-xl border border-slate-200"
            />
          )}
        </div>

        <div className="text-xs text-slate-500">
          Tip: If you are on mobile, you can go back to the status screen to see
          the step-by-step progress while this map gives you an overview of the
          route.
        </div>
      </div>
    </div>
  );
}
