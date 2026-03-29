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
  message?: string | null;
};

function money(v?: number | null) {
  return typeof v === "number" ? `PHP ${v.toFixed(2)}` : "--";
}

function metricKm(v?: number | null) {
  return typeof v === "number" ? `${v.toFixed(1)} km` : "--";
}

function metricMin(v?: number | null) {
  return typeof v === "number" ? `${Math.round(v)} min` : "--";
}

// 🔥 CRITICAL: extract access token from localStorage
function getAccessToken(): string | null {
  try {
    const raw = localStorage.getItem("sb-access-token");
    if (raw) return raw;

    // fallback: Supabase session
    const supa = localStorage.getItem("supabase.auth.token");
    if (supa) {
      const parsed = JSON.parse(supa);
      return parsed?.currentSession?.access_token || null;
    }
  } catch {}
  return null;
}

export default function RidePage() {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const code = useMemo(() => {
    if (typeof window === "undefined") return "";
    const url = new URL(window.location.href);
    return (
      url.searchParams.get("booking_code") ||
      url.searchParams.get("code") ||
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

      setLoading(true);
      setErr("");

      try {
        const token = getAccessToken();

        if (!token) {
          setErr("Not authenticated");
          setData(null);
          return;
        }

        const res = await fetch(
          `/api/passenger/track?booking_code=${encodeURIComponent(code)}&ts=${Date.now()}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const json = await res.json().catch(() => null);

        if (!res.ok || !json?.ok) {
          setData(null);
          setErr(json?.error || "Unable to load trip tracking.");
        } else {
          setData(json);
        }
      } catch {
        setErr("Unable to load trip tracking.");
        setData(null);
      } finally {
        setLoading(false);
      }
    }

    fetchTrack();
    const t = setInterval(fetchTrack, 3000);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [code]);

  const statusSteps = [
    "searching",
    "assigned",
    "accepted",
    "fare_proposed",
    "ready",
    "on_the_way",
    "arrived",
    "on_trip",
    "completed",
  ];

  const currentIndex = statusSteps.indexOf((data?.status || "").trim());

  return (
    <div className="mx-auto max-w-xl p-4">
      <div className="mb-4 rounded-xl border bg-white p-4">
        <div className="text-sm font-semibold">Trip Tracking</div>
        <div className="text-xs opacity-70">Code: {code || "--"}</div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-2">
        {statusSteps.map((s, i) => (
          <div
            key={s}
            className={
              "rounded p-2 text-center text-xs " +
              (i < currentIndex
                ? "bg-emerald-700 text-white"
                : i === currentIndex
                ? "bg-emerald-500 text-white"
                : "bg-gray-700 text-gray-300")
            }
          >
            {s.replaceAll("_", " ")}
          </div>
        ))}
      </div>

      {loading && <div>Loading...</div>}

      {err && (
        <div className="text-red-600 text-sm mb-4">
          {err}
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <div>Status: {data.status}</div>
          <div>Driver: {data.driver?.name || "--"}</div>
          <div>Phone: {data.driver?.phone || "--"}</div>
          <div>Pickup: {metricKm(data.route?.distance_km)}</div>
          <div>ETA: {metricMin(data.route?.eta_minutes)}</div>
          <div>Trip: {metricKm(data.route?.trip_km)}</div>
          <div>Fare: {money(data.verified_fare ?? data.proposed_fare)}</div>
        </div>
      )}
    </div>
  );
}