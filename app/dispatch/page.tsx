"use client";

import { useEffect, useState } from "react";
import { ActiveTripsTable } from "@/components/dispatch/ActiveTripsTable";

type ActiveTripsApiResponse = {
  ok: boolean;
  trips: any[];
  error?: string;
  details?: string;
};

export default function DispatchPage() {
  const [trips, setTrips] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  async function reloadAll() {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/active-trips");
      const json: ActiveTripsApiResponse = await res.json();

      if (!res.ok || !json.ok) {
        console.error("Failed to load active trips", json);
        return;
      }

      setTrips(json.trips ?? []);
    } catch (err) {
      console.error("Error loading active trips", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reloadAll();
  }, []);

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold text-zinc-100">
        JRide Dispatch – Active Trips
      </h1>

      {loading && (
        <p className="text-xs text-zinc-400">Loading active trips…</p>
      )}

      <ActiveTripsTable trips={trips} onRefresh={reloadAll} />
    </div>
  );
}
