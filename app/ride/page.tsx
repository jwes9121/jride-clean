"use client";

import { useEffect, useState } from "react";

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

  useEffect(() => {
    const urlCode = readUrlCode();
    if (urlCode) {
      setInput(urlCode);
      setBookingCode(urlCode);
    }
  }, []);

  function handleTrack() {
    const code = input.trim();
    if (!code) return;
    setBookingCode(code);
  }

  function handleClear() {
    setInput("");
    setBookingCode("");
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
          >
            Track
          </button>

          <button
            onClick={handleClear}
            className="rounded-lg border border-black/10 px-3 py-2 text-sm"
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