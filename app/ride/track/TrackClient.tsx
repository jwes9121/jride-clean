"use client";

import { useEffect, useState } from "react";

type Booking = {
  booking_code?: string | null;
  status?: string | null;
  driver_name?: string | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  convenience_fee?: number | null;
  pickup_distance_fee?: number | null;
  driver_to_pickup_km?: number | null;
  trip_distance_km?: number | null;
};

function money(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v}` : "--";
}

export default function TrackClient({ code }: { code?: string }) {
  const [data, setData] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [raw, setRaw] = useState<any>(null);

  async function fetchBooking() {
    if (!code) {
      setErr("Missing booking code");
      setData(null);
      setRaw(null);
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/public/passenger/booking?code=${encodeURIComponent(code)}&ts=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json();
      setRaw(json);

      if (!res.ok || !json?.ok) {
        setData(null);
        setErr(json?.error || json?.message || `BOOKING_FETCH_FAILED (${res.status})`);
        return;
      }

      setData(json.booking ?? null);
    } catch (e: any) {
      setData(null);
      setErr(String(e?.message || e || "BOOKING_FETCH_FAILED"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchBooking();
    const t = setInterval(fetchBooking, 3000);
    return () => clearInterval(t);
  }, [code]);

  const proposedFare = data?.verified_fare ?? data?.proposed_fare ?? null;
  const pickupFee = data?.pickup_distance_fee ?? null;
  const fee =
    typeof data?.convenience_fee === "number" ? data.convenience_fee : 15;
  const total =
    (typeof proposedFare === "number" ? proposedFare : 0) +
    (typeof pickupFee === "number" ? pickupFee : 0) +
    fee;

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Tracking</div>
        <div className="text-xs opacity-70">
          Code: {code || "--"}
        </div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm">
          Loading booking...
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Error: {err}
        </div>
      ) : null}

      {data ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
          <div>Status: {data.status ?? "--"}</div>
          <div>Driver: {data.driver_name ?? "--"}</div>
          <div>Fare: {money(proposedFare)}</div>
          <div>Pickup distance fee: {money(pickupFee)}</div>
          <div>
            Driver to pickup:{" "}
            {typeof data.driver_to_pickup_km === "number"
              ? `${data.driver_to_pickup_km.toFixed(1)} km`
              : "--"}
          </div>
          <div>
            Trip distance:{" "}
            {typeof data.trip_distance_km === "number"
              ? `${data.trip_distance_km.toFixed(1)} km`
              : "--"}
          </div>
          <div>Platform fee: {money(fee)}</div>
          <div className="font-semibold">Total: {money(total)}</div>
        </div>
      ) : null}

      {!loading && !data && raw ? (
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <div className="text-sm font-semibold">API response</div>
          <pre className="mt-2 overflow-auto text-xs whitespace-pre-wrap">
            {JSON.stringify(raw, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}