"use client";

import { useEffect, useState } from "react";

type TrackResponse = {
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
  return typeof v === "number" && Number.isFinite(v) ? `PHP ${v.toFixed(2)}` : "--";
}

export default function TrackClient({ code }: { code?: string }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function fetchTrack() {
    if (!code) {
      setErr("Missing booking code.");
      setData(null);
      return;
    }

    setLoading(true);
    setErr("");

    try {
      const res = await fetch(
        `/api/passenger/track?booking_code=${encodeURIComponent(code)}&ts=${Date.now()}`,
        { cache: "no-store" }
      );

      const json = await res.json().catch(() => null);

      if (!res.ok || !json?.ok) {
        setData(null);
        setErr(json?.message || "Unable to load trip tracking.");
        return;
      }

      setData(json);
    } catch {
      setData(null);
      setErr("Unable to load trip tracking.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchTrack();
    const t = setInterval(fetchTrack, 3000);
    return () => clearInterval(t);
  }, [code]);

  return (
    <div className="mx-auto max-w-3xl p-4 space-y-4">
      <div className="rounded-xl border border-black/10 bg-white p-4">
        <div className="text-sm font-semibold">Tracking</div>
        <div className="text-xs opacity-70">Code: {code || "--"}</div>
      </div>

      {loading ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 text-sm">
          Loading tracking...
        </div>
      ) : null}

      {err ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {err}
        </div>
      ) : null}

      {data ? (
        <div className="rounded-xl border border-black/10 bg-white p-4 space-y-2">
          <div>Status: {data.status ?? "--"}</div>
          <div>Driver: {data.driver?.name ?? "--"}</div>
          <div>Phone: {data.driver?.phone ?? "--"}</div>
          <div>
            Pickup distance:{" "}
            {typeof data.route?.distance_km === "number"
              ? `${data.route.distance_km.toFixed(1)} km`
              : "--"}
          </div>
          <div>
            ETA:{" "}
            {typeof data.route?.eta_minutes === "number"
              ? `${Math.round(data.route.eta_minutes)} min`
              : "--"}
          </div>
          <div>
            Trip distance:{" "}
            {typeof data.route?.trip_km === "number"
              ? `${data.route.trip_km.toFixed(1)} km`
              : "--"}
          </div>
          <div className="font-semibold">
            Fare: {money(data.verified_fare ?? data.proposed_fare ?? null)}
          </div>
        </div>
      ) : null}
    </div>
  );
}