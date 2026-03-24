"use client";

import { useEffect, useMemo, useState } from "react";

type BookingData = {
  booking_code?: string | null;
  status?: string | null;
  driver_name?: string | null;

  proposed_fare?: number | null;
  verified_fare?: number | null;

  pickup_distance_fee?: number | null;
  driver_to_pickup_km?: number | null;

  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;

  trip_distance_km?: number | null;
};

function fmtMoney(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `PHP ${value.toFixed(0)}`
    : "--";
}

function fmtKm(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value.toFixed(2)} km`
    : "--";
}

export default function RidePage() {
  const [bookingCode, setBookingCode] = useState("");
  const [data, setData] = useState<BookingData | null>(null);
  const [error, setError] = useState<string>("");

  async function fetchBooking() {
    if (!bookingCode.trim()) return;

    try {
      setError("");

      const res = await fetch(
        `/api/public/passenger/booking?code=${encodeURIComponent(
          bookingCode.trim()
        )}&ts=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json();

      if (!res.ok || !json?.ok) {
        setData(null);
        setError(json?.error || json?.message || "Failed to load booking");
        return;
      }

      setData(json.booking ?? null);
    } catch {
      setData(null);
      setError("Failed to load booking");
    }
  }

  useEffect(() => {
    if (!bookingCode.trim()) {
      setData(null);
      setError("");
      return;
    }

    fetchBooking();
    const t = setInterval(fetchBooking, 3000);
    return () => clearInterval(t);
  }, [bookingCode]);

  const displayedFare = useMemo(() => {
    if (!data) return null;
    return typeof data.verified_fare === "number"
      ? data.verified_fare
      : typeof data.proposed_fare === "number"
      ? data.proposed_fare
      : null;
  }, [data]);

  const receiptText = useMemo(() => {
    return [
      "JRIDE TRIP RECEIPT",
      `Code: ${data?.booking_code ?? "--"}`,
      `Status: ${data?.status ?? "--"}`,
      `Driver: ${data?.driver_name ?? "--"}`,
      `Fare: ${fmtMoney(displayedFare)}`,
      `Pickup distance fee: ${fmtMoney(data?.pickup_distance_fee)}`,
      `Driver to pickup: ${fmtKm(data?.driver_to_pickup_km)}`,
      `Trip distance: ${fmtKm(data?.trip_distance_km)}`,
    ].join("\n");
  }, [data, displayedFare]);

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Track Booking</div>
        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2"
          placeholder="Enter booking code"
          value={bookingCode}
          onChange={(e) => setBookingCode(e.target.value)}
        />
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {data ? (
        <div className="space-y-4 rounded-2xl border border-black/10 bg-white p-4">
          <div>
            <div className="text-sm font-semibold">Active Trip</div>
            <div className="mt-1 text-xs opacity-70">
              Code: {data.booking_code ?? "--"}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Driver details</div>
            <div className="mt-2 text-sm">Name: {data.driver_name ?? "--"}</div>
            <div className="text-sm">Status: {data.status ?? "--"}</div>
            <div className="text-sm">
              Driver to pickup: {fmtKm(data.driver_to_pickup_km)}
            </div>
            <div className="text-sm">
              Trip distance: {fmtKm(data.trip_distance_km)}
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Fare breakdown</div>
            <div className="mt-2 text-sm">
              Fare (backend): {fmtMoney(displayedFare)}
            </div>
            <div className="text-sm">
              Pickup distance fee (backend): {fmtMoney(data.pickup_distance_fee)}
            </div>
            <div className="text-xs opacity-70">
              Display-only. No frontend fare recomputation.
            </div>
          </div>

          <div className="rounded-xl border border-black/10 p-3">
            <div className="text-sm font-semibold">Trip coordinates</div>
            <div className="mt-2 text-sm">
              Pickup:{" "}
              {data.pickup_lat != null && data.pickup_lng != null
                ? `${data.pickup_lat}, ${data.pickup_lng}`
                : "--"}
            </div>
            <div className="text-sm">
              Dropoff:{" "}
              {data.dropoff_lat != null && data.dropoff_lng != null
                ? `${data.dropoff_lat}, ${data.dropoff_lng}`
                : "--"}
            </div>
            <div className="text-sm">
              Driver:{" "}
              {data.driver_lat != null && data.driver_lng != null
                ? `${data.driver_lat}, ${data.driver_lng}`
                : "--"}
            </div>
          </div>

          {data.status === "completed" || data.status === "cancelled" ? (
            <div className="rounded-xl border border-black/10 p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-sm font-semibold">Trip receipt</div>
                  <div className="text-xs opacity-70">
                    {data.status === "completed"
                      ? "Completed trip summary"
                      : "Cancelled trip summary"}
                  </div>
                </div>
                <button
                  className="rounded-lg border border-black/10 px-3 py-1 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(receiptText);
                    alert("Receipt copied to clipboard");
                  }}
                >
                  Copy receipt
                </button>
              </div>

              <div className="mt-3 space-y-1 text-sm">
                <div>Code: {data.booking_code ?? "--"}</div>
                <div>Status: {data.status ?? "--"}</div>
                <div>Driver: {data.driver_name ?? "--"}</div>
                <div>Fare: {fmtMoney(displayedFare)}</div>
                <div>
                  Pickup distance fee: {fmtMoney(data.pickup_distance_fee)}
                </div>
                <div>
                  Driver to pickup: {fmtKm(data.driver_to_pickup_km)}
                </div>
                <div>Trip distance: {fmtKm(data.trip_distance_km)}</div>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}