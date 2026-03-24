"use client";

import { useEffect, useState } from "react";

const JRIDE_ACTIVE_BOOKING_KEY = "jride_active_booking_code";

function getLocal(key: string) {
  if (typeof window === "undefined") return "";
  try {
    return String(window.localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

function setLocal(key: string, value: string) {
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
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

export default function RidePage() {
  const [input, setInput] = useState("");
  const [bookingCode, setBookingCode] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const urlCode = readUrlCode();
        if (urlCode) {
          if (cancelled) return;
          setInput(urlCode);
          setBookingCode(urlCode);
          setLocal(JRIDE_ACTIVE_BOOKING_KEY, urlCode);
          return;
        }

        const savedCode = getLocal(JRIDE_ACTIVE_BOOKING_KEY);
        if (savedCode) {
          const savedRes = await fetch(
            `/api/public/passenger/booking?code=${encodeURIComponent(savedCode)}&ts=${Date.now()}`,
            { cache: "no-store" }
          );
          const savedJson = await savedRes.json().catch(() => null);

          if (!cancelled && savedRes.ok && savedJson?.ok && savedJson?.booking?.booking_code) {
            const realCode = String(savedJson.booking.booking_code).trim();
            setInput(realCode);
            setBookingCode(realCode);
            setLocal(JRIDE_ACTIVE_BOOKING_KEY, realCode);
            return;
          }

          setLocal(JRIDE_ACTIVE_BOOKING_KEY, "");
        }

        const autoRes = await fetch(
          `/api/public/passenger/booking?ts=${Date.now()}`,
          { cache: "no-store" }
        );
        const autoJson = await autoRes.json().catch(() => null);

        if (!cancelled && autoRes.ok && autoJson?.ok && autoJson?.booking?.booking_code) {
          const realCode = String(autoJson.booking.booking_code).trim();
          setInput(realCode);
          setBookingCode(realCode);
          setLocal(JRIDE_ACTIVE_BOOKING_KEY, realCode);
          return;
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  function handleTrack() {
    const code = input.trim();
    if (!code) return;
    setBookingCode(code);
    setLocal(JRIDE_ACTIVE_BOOKING_KEY, code);
  }

  function handleClear() {
    setInput("");
    setBookingCode("");
    setLocal(JRIDE_ACTIVE_BOOKING_KEY, "");
  }

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

      {bookingCode ? (
        <iframe
          key={bookingCode}
          src={`/ride/track?code=${encodeURIComponent(bookingCode)}`}
          className="h-[600px] w-full rounded-xl border border-black/10"
          title="JRide Tracking"
        />
      ) : null}
    </div>
  );
}