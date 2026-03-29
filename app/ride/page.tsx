"use client";

import { useEffect, useMemo, useState } from "react";

type TrackPayload = {
  ok?: boolean;
  booking_code?: string | null;
  status?: string | null;
  driver?: {
    id?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  route?: {
    distance_km?: number | null;
    eta_minutes?: number | null;
    trip_km?: number | null;
  } | null;
  proposed_fare?: number | null;
  verified_fare?: number | null;
  fare?: number | null;
  driver_name?: string | null;
  driver_phone?: string | null;
  pickup_distance_km?: number | null;
  eta_minutes?: number | null;
  trip_distance_km?: number | null;
  message?: string | null;
};

function money(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? "PHP " + v.toFixed(2) : "--";
}

function metricKm(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? v.toFixed(1) + " km" : "--";
}

function metricMin(v?: number | null) {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) + " min" : "--";
}

// Read stored access token (set by login page)
function getAccessToken(): string | null {
  try {
    // Primary: stored by login page
    const t = localStorage.getItem("jride_access_token");
    if (t && t.length > 20) return t;

    // Fallback: Supabase default storage key pattern
    const keys = Object.keys(localStorage);
    for (const k of keys) {
      if (k.startsWith("sb-") && k.endsWith("-auth-token")) {
        try {
          const parsed = JSON.parse(localStorage.getItem(k) || "");
          const tok = parsed?.access_token || parsed?.currentSession?.access_token;
          if (tok && tok.length > 20) return tok;
        } catch {}
      }
    }
  } catch {}
  return null;
}

const STATUS_STEPS = [
  "searching",
  "requested",
  "assigned",
  "accepted",
  "fare_proposed",
  "ready",
  "on_the_way",
  "arrived",
  "on_trip",
  "completed",
];

export default function RidePage() {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [pollCount, setPollCount] = useState(0);

  const code = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("booking_code") ||
      url.searchParams.get("code") ||
      localStorage.getItem("jride_active_booking_code") ||
      ""
    ).trim();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchTrack() {
      if (!code) {
        setErr("Missing booking code.");
        return;
      }

      // Only show loading on first fetch
      if (pollCount === 0) setLoading(true);
      setErr("");

      try {
        const token = getAccessToken();

        if (!token) {
          setErr("Not signed in. Please log in first.");
          setData(null);
          setLoading(false);
          return;
        }

        const res = await fetch(
          "/api/passenger/track?booking_code=" + encodeURIComponent(code) + "&ts=" + Date.now(),
          {
            cache: "no-store",
            headers: {
              Authorization: "Bearer " + token,
            },
          }
        );

        if (cancelled) return;

        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          if (res.status === 401) {
            // Token expired - clear and prompt re-login
            try { localStorage.removeItem("jride_access_token"); } catch {}
            setErr("Session expired. Please log in again.");
          } else {
            setErr(json?.error || json?.message || "Unable to load trip tracking.");
          }
          setData(null);
        } else {
          setData(json);
          setErr("");
        }
      } catch {
        if (!cancelled) {
          setErr("Network error. Retrying...");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setPollCount((c) => c + 1);
        }
      }
    }

    fetchTrack();
    const t = setInterval(fetchTrack, 4000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [code]);

  // Derive display values from both nested and flat fields
  const driverName = data?.driver?.name || data?.driver_name || null;
  const driverPhone = data?.driver?.phone || data?.driver_phone || null;
  const pickupKm = data?.route?.distance_km ?? data?.pickup_distance_km ?? null;
  const eta = data?.route?.eta_minutes ?? data?.eta_minutes ?? null;
  const tripKm = data?.route?.trip_km ?? data?.trip_distance_km ?? null;
  const fare = data?.fare ?? data?.verified_fare ?? data?.proposed_fare ?? null;
  const status = (data?.status || "").trim();

  const currentIndex = STATUS_STEPS.indexOf(status);
  const isCompleted = status === "completed";
  const isCancelled = status === "cancelled" || status === "canceled";

  return (
    <main className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-xl p-4 space-y-4">

        {/* Header */}
        <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold">Trip Tracking</div>
              <div className="text-xs opacity-60 mt-0.5">Code: {code || "--"}</div>
            </div>
            {status ? (
              <div
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold " +
                  (isCompleted
                    ? "bg-emerald-100 text-emerald-800"
                    : isCancelled
                    ? "bg-red-100 text-red-800"
                    : "bg-blue-100 text-blue-800")
                }
              >
                {status.replaceAll("_", " ").toUpperCase()}
              </div>
            ) : null}
          </div>
        </div>

        {/* Status Steps */}
        {data && !isCancelled ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm">
            <div className="text-xs font-semibold mb-2 opacity-60">PROGRESS</div>
            <div className="grid grid-cols-5 gap-1">
              {STATUS_STEPS.map((s, i) => (
                <div
                  key={s}
                  className={
                    "rounded px-1 py-1.5 text-center text-[10px] leading-tight font-medium " +
                    (i < currentIndex
                      ? "bg-emerald-600 text-white"
                      : i === currentIndex
                      ? "bg-emerald-500 text-white ring-2 ring-emerald-300"
                      : "bg-gray-100 text-gray-400")
                  }
                >
                  {s.replaceAll("_", " ")}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* Loading */}
        {loading ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 text-sm text-center opacity-70">
            Loading trip tracking...
          </div>
        ) : null}

        {/* Error */}
        {err && !loading ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4">
            <div className="text-sm text-red-700">{err}</div>
            {err.includes("log in") ? (
              <a
                href="/passenger-login"
                className="mt-2 inline-block text-sm font-semibold text-blue-600 underline"
              >
                Go to login
              </a>
            ) : null}
          </div>
        ) : null}

        {/* Trip Details */}
        {data ? (
          <div className="rounded-xl border border-black/10 bg-white p-4 shadow-sm space-y-3">
            <div className="text-xs font-semibold opacity-60 mb-1">TRIP DETAILS</div>

            {/* Driver */}
            <div className="flex items-center justify-between border-b border-black/5 pb-2">
              <div className="text-sm opacity-60">Driver</div>
              <div className="text-sm font-medium">{driverName || "Waiting for driver..."}</div>
            </div>

            {driverPhone ? (
              <div className="flex items-center justify-between border-b border-black/5 pb-2">
                <div className="text-sm opacity-60">Phone</div>
                <a href={"tel:" + driverPhone} className="text-sm font-medium text-blue-600 underline">
                  {driverPhone}
                </a>
              </div>
            ) : null}

            {/* Metrics */}
            <div className="grid grid-cols-3 gap-3 pt-1">
              <div className="text-center">
                <div className="text-xs opacity-50">Pickup</div>
                <div className="text-sm font-semibold">{metricKm(pickupKm)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs opacity-50">ETA</div>
                <div className="text-sm font-semibold">{metricMin(eta)}</div>
              </div>
              <div className="text-center">
                <div className="text-xs opacity-50">Trip</div>
                <div className="text-sm font-semibold">{metricKm(tripKm)}</div>
              </div>
            </div>

            {/* Fare */}
            <div className="flex items-center justify-between pt-2 border-t border-black/5">
              <div className="text-sm opacity-60">Fare</div>
              <div className="text-lg font-bold">{money(fare)}</div>
            </div>
          </div>
        ) : null}

        {/* Completed State */}
        {isCompleted ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
            <div className="text-lg font-semibold text-emerald-800">Trip Completed</div>
            <div className="text-sm text-emerald-700 mt-1">
              Thank you for riding with JRide!
            </div>
            <a
              href="/passenger"
              className="mt-3 inline-block rounded-xl bg-emerald-600 px-5 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
            >
              Back to Dashboard
            </a>
          </div>
        ) : null}

        {/* Cancelled State */}
        {isCancelled ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-center">
            <div className="text-lg font-semibold text-red-800">Trip Cancelled</div>
            <a
              href="/ride"
              className="mt-3 inline-block rounded-xl bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              Book Another Ride
            </a>
          </div>
        ) : null}

        {/* Back link */}
        <div className="text-center pt-2">
          <a href="/passenger" className="text-xs opacity-50 hover:opacity-80 underline">
            Back to dashboard
          </a>
        </div>
      </div>
    </main>
  );
}