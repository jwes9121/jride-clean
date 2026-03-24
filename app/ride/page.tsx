"use client";

import { useEffect, useState } from "react";

type Booking = {
  booking_code?: string | null;
  status?: string | null;
  driver_name?: string | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  pickup_distance_fee?: number | null;
  driver_to_pickup_km?: number | null;
  trip_distance_km?: number | null;
  driver_lat?: number | null;
  driver_lng?: number | null;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  dropoff_lat?: number | null;
  dropoff_lng?: number | null;
};

const STORAGE_KEY = "jride_active_booking_code";

function getStoredCode() {
  if (typeof window === "undefined") return "";
  try {
    return String(localStorage.getItem(STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function setStoredCode(code: string) {
  if (typeof window === "undefined") return;
  try {
    if (code) localStorage.setItem(STORAGE_KEY, code);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function readUrlCode() {
  if (typeof window === "undefined") return "";
  const url = new URL(window.location.href);
  return String(
    url.searchParams.get("code") ||
      url.searchParams.get("booking_code") ||
      ""
  ).trim();
}

function money(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v}` : "--";
}

function km(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? `${v.toFixed(1)} km` : "--";
}

export default function RidePage() {
  const [input, setInput] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);

  async function loadBooking(code: string) {
    const cleanCode = String(code || "").trim();
    if (!cleanCode) {
      setErr("");
      setBooking(null);
      setActiveCode("");
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/public/passenger/booking?code=${encodeURIComponent(cleanCode)}&ts=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setBooking(null);
        setActiveCode("");
        setStoredCode("");
        setErr(json?.error === "BOOKING_NOT_FOUND" ? "Booking not found." : "Unable to load booking.");
        return;
      }

      const b = (json.booking || null) as Booking | null;
      setBooking(b);
      setActiveCode(cleanCode);
      setStoredCode(cleanCode);
      setErr("");
    } catch {
      setBooking(null);
      setActiveCode(cleanCode);
      setErr("Unable to load booking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const urlCode = readUrlCode();
    const stored = getStoredCode();
    const code = urlCode || stored;

    if (code) {
      setInput(code);
      loadBooking(code);
    }
  }, []);

  useEffect(() => {
    if (!activeCode) return;

    const t = setInterval(() => {
      loadBooking(activeCode);
    }, 3000);

    return () => clearInterval(t);
  }, [activeCode]);

  function handleTrack() {
    const code = input.trim();
    if (!code) return;
    loadBooking(code);
  }

  function handleClear() {
    setInput("");
    setActiveCode("");
    setBooking(null);
    setErr("");
    setStoredCode("");
  }

  const shownFare = booking?.verified_fare ?? booking?.proposed_fare ?? null;
  const pickupFee = booking?.pickup_distance_fee ?? null;
  const platformFee = 15;
  const total =
    (typeof shownFare === "number" ? shownFare : 0) +
    (typeof pickupFee === "number" ? pickupFee : 0) +
    platformFee;

  return (
    <div className="mx-auto max-w-2xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Track Booking</div>

        <input
          className="mt-2 w-full rounded-lg border border-black/10 px-3 py-2"
          placeholder="Enter booking code"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />

        <div className="mt-3 flex gap-2">
          <button
            onClick={handleTrack}
            className="rounded-lg bg-black px-3 py-2 text-sm font-semibold text-white"
            disabled={loading}
          >
            Track
          </button>

          <button
            onClick={handleClear}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
            disabled={loading}
          >
            Clear
          </button>
        </div>
      </div>

      {(activeCode || loading || err || booking) && (
        <div className="rounded-xl border border-black/10 bg-white p-4 space-y-4">
          <div>
            <div className="text-sm font-semibold">Tracking</div>
            <div className="text-xs opacity-70">Code: {activeCode || "--"}</div>
          </div>

          {loading && (
            <div className="rounded-lg border border-black/10 p-3 text-sm">
              Loading booking...
            </div>
          )}

          {err && !loading && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {err}
            </div>
          )}

          {booking && !loading && (
            <>
              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Trip status</div>
                <div className="text-sm">Status: {booking.status ?? "--"}</div>
                <div className="text-sm">Driver: {booking.driver_name ?? "--"}</div>
              </div>

              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Fare summary</div>
                <div className="text-sm">Fare: {money(shownFare)}</div>
                <div className="text-sm">Pickup distance fee: {money(pickupFee)}</div>
                <div className="text-sm">Platform fee: {money(platformFee)}</div>
                <div className="text-sm font-semibold">Total: {money(total)}</div>
              </div>

              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Trip metrics</div>
                <div className="text-sm">Driver to pickup: {km(booking.driver_to_pickup_km)}</div>
                <div className="text-sm">Trip distance: {km(booking.trip_distance_km)}</div>
              </div>

              <div className="rounded-lg border border-black/10 p-3 space-y-1">
                <div className="text-sm font-semibold">Coordinates</div>
                <div className="text-sm">
                  Pickup:{" "}
                  {booking.pickup_lat != null && booking.pickup_lng != null
                    ? `${booking.pickup_lat}, ${booking.pickup_lng}`
                    : "--"}
                </div>
                <div className="text-sm">
                  Dropoff:{" "}
                  {booking.dropoff_lat != null && booking.dropoff_lng != null
                    ? `${booking.dropoff_lat}, ${booking.dropoff_lng}`
                    : "--"}
                </div>
                <div className="text-sm">
                  Driver:{" "}
                  {booking.driver_lat != null && booking.driver_lng != null
                    ? `${booking.driver_lat}, ${booking.driver_lng}`
                    : "--"}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}