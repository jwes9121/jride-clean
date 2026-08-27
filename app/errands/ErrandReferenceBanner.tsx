"use client";

import * as React from "react";

const ACCESS_TOKEN_KEY = "jride_access_token";
const PASSENGER_TOKEN_KEY = "jride_passenger_token";
const ERRAND_CODE_KEY = "jride_active_errand_booking_code";

function cleanText(value: unknown): string {
  const clean = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const lowered = clean.toLowerCase();
  return lowered === "null" || lowered === "undefined" ? "" : clean;
}

function readStoredCode(): string {
  if (typeof window === "undefined") return "";
  try {
    return cleanText(localStorage.getItem(ERRAND_CODE_KEY));
  } catch {
    return "";
  }
}

function readPassengerToken(): string {
  if (typeof window === "undefined") return "";
  try {
    return cleanText(
      localStorage.getItem(ACCESS_TOKEN_KEY) ||
        localStorage.getItem(PASSENGER_TOKEN_KEY)
    );
  } catch {
    return "";
  }
}

export default function ErrandReferenceBanner() {
  const [bookingCode, setBookingCode] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    const refresh = async () => {
      const storedCode = readStoredCode();
      if (!disposed && storedCode) setBookingCode(storedCode);

      const token = readPassengerToken();
      if (!token) return;

      try {
        const response = await fetch("/api/passenger/errand/current", {
          method: "GET",
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
        const json: any = await response.json().catch(() => ({}));
        if (!response.ok || json?.ok === false) return;

        const liveCode = cleanText(json?.errand?.booking?.booking_code);
        if (disposed) return;

        if (liveCode) {
          setBookingCode(liveCode);
          try {
            localStorage.setItem(ERRAND_CODE_KEY, liveCode);
          } catch {}
        } else {
          setBookingCode("");
          try {
            localStorage.removeItem(ERRAND_CODE_KEY);
          } catch {}
        }
      } catch {}
    };

    void refresh();
    timer = setInterval(() => void refresh(), 3000);

    return () => {
      disposed = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  if (!bookingCode) return null;

  return (
    <div className="bg-[#f7faf9] px-4 pt-4">
      <div className="mx-auto max-w-5xl rounded-2xl border border-emerald-300 bg-emerald-50 px-4 py-3 shadow-sm">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
          Errand No.
        </div>
        <div className="mt-1 select-all break-all font-mono text-base font-black text-emerald-950 sm:text-lg">
          {bookingCode}
        </div>
        <div className="mt-1 text-xs text-emerald-800">
          Keep this number for the driver, dispatcher, or JRide support.
        </div>
      </div>
    </div>
  );
}
