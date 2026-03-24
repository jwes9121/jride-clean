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

type BookForm = {
  town: string;
  from_label: string;
  to_label: string;
  passenger_name: string;
  pickup_lat: string;
  pickup_lng: string;
  dropoff_lat: string;
  dropoff_lng: string;
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

function numOrNull(v: string) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export default function RidePage() {
  const [input, setInput] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [booking, setBooking] = useState<Booking | null>(null);

  const [bookMode, setBookMode] = useState(false);
  const [bookSubmitting, setBookSubmitting] = useState(false);
  const [bookErr, setBookErr] = useState("");
  const [bookForm, setBookForm] = useState<BookForm>({
    town: "Lagawe",
    from_label: "",
    to_label: "",
    passenger_name: "",
    pickup_lat: "",
    pickup_lng: "",
    dropoff_lat: "",
    dropoff_lng: "",
  });

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
        setErr(
          json?.error === "BOOKING_NOT_FOUND"
            ? "Booking not found."
            : "Unable to load booking."
        );
        return;
      }

      const b = (json.booking || null) as Booking | null;
      setBooking(b);
      setActiveCode(cleanCode);
      setStoredCode(cleanCode);
      setErr("");
    } catch {
      setBooking(null);
      setActiveCode("");
      setStoredCode("");
      setErr("Unable to load booking.");
    } finally {
      setLoading(false);
    }
  }

  async function handleBookSubmit() {
    setBookSubmitting(true);
    setBookErr("");

    try {
      const body: any = {
        town: bookForm.town,
        from_label: bookForm.from_label.trim() || null,
        to_label: bookForm.to_label.trim() || null,
        passenger_name: bookForm.passenger_name.trim() || null,
        pickup_lat: numOrNull(bookForm.pickup_lat),
        pickup_lng: numOrNull(bookForm.pickup_lng),
        dropoff_lat: numOrNull(bookForm.dropoff_lat),
        dropoff_lng: numOrNull(bookForm.dropoff_lng),
      };

      const res = await fetch("/api/public/passenger/book", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok || !json?.booking_code) {
        setBookErr(json?.message || json?.code || "Booking failed.");
        return;
      }

      const code = String(json.booking_code).trim();
      setStoredCode(code);
      setInput(code);
      setBookMode(false);
      setBookErr("");

      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set("code", code);
        window.history.replaceState({}, "", url.toString());
      }

      await loadBooking(code);
    } catch (e: any) {
      setBookErr("Network error: " + String(e?.message || e || "unknown"));
    } finally {
      setBookSubmitting(false);
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
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("booking_code");
      window.history.replaceState({}, "", url.pathname);
    }
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
      {!activeCode && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 space-y-3">
          {bookMode ? (
            <>
              <div className="text-sm font-semibold text-blue-900">Book a Ride</div>

              {bookErr && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  {bookErr}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="text-xs font-medium">Town</label>
                  <select
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    value={bookForm.town}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, town: e.target.value }))
                    }
                  >
                    <option value="Lagawe">Lagawe</option>
                    <option value="Hingyon">Hingyon</option>
                    <option value="Banaue">Banaue</option>
                  </select>
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-medium">Passenger name</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="Optional"
                    value={bookForm.passenger_name}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, passenger_name: e.target.value }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-medium">Pickup label</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="e.g. Municipal Hall"
                    value={bookForm.from_label}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, from_label: e.target.value }))
                    }
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-medium">Drop-off label</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="e.g. Public Market"
                    value={bookForm.to_label}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, to_label: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="text-xs font-medium">Pickup latitude</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="16.82"
                    value={bookForm.pickup_lat}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, pickup_lat: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="text-xs font-medium">Pickup longitude</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="121.11"
                    value={bookForm.pickup_lng}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, pickup_lng: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="text-xs font-medium">Drop-off latitude</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="16.83"
                    value={bookForm.dropoff_lat}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, dropoff_lat: e.target.value }))
                    }
                  />
                </div>

                <div>
                  <label className="text-xs font-medium">Drop-off longitude</label>
                  <input
                    className="mt-1 w-full rounded-lg border border-black/10 px-3 py-2 text-sm"
                    placeholder="121.12"
                    value={bookForm.dropoff_lng}
                    onChange={(e) =>
                      setBookForm((f) => ({ ...f, dropoff_lng: e.target.value }))
                    }
                  />
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handleBookSubmit}
                  disabled={
                    bookSubmitting ||
                    !bookForm.from_label.trim() ||
                    !bookForm.to_label.trim()
                  }
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {bookSubmitting ? "Booking..." : "Confirm Booking"}
                </button>

                <button
                  onClick={() => {
                    setBookMode(false);
                    setBookErr("");
                  }}
                  className="rounded-lg border border-black/10 px-4 py-2 text-sm"
                  disabled={bookSubmitting}
                >
                  Cancel
                </button>
              </div>
            </>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-blue-900">Need a ride?</div>
                <div className="text-xs text-blue-800/70">
                  Book a new ride or track an existing booking below.
                </div>
              </div>

              <button
                onClick={() => setBookMode(true)}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white"
              >
                Book Ride
              </button>
            </div>
          )}
        </div>
      )}

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
                  Drop-off:{" "}
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