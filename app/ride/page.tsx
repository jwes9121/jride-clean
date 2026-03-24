"use client";

import { useEffect, useState } from "react";

export default function RidePage() {
  const [bookingCode, setBookingCode] = useState("");
  const [input, setInput] = useState("");

  // ✅ Restore from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("jride_active_booking_code");
    if (saved) {
      setBookingCode(saved);
      setInput(saved);
    }
  }, []);

  function handleTrack() {
    if (!input.trim()) return;

    const code = input.trim();
    setBookingCode(code);

    // ✅ persist
    localStorage.setItem("jride_active_booking_code", code);
  }

  function handleClear() {
    setBookingCode("");
    setInput("");
    localStorage.removeItem("jride_active_booking_code");
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

      {/* ✅ Load TrackClient only when code exists */}
      {bookingCode ? (
        <iframe
          src={`/ride/track?code=${encodeURIComponent(bookingCode)}`}
          className="w-full h-[600px] border border-black/10 rounded-xl"
        />
      ) : null}
    </div>
  );
}