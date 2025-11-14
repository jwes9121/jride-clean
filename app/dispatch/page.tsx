"use client";

import { useEffect, useState } from "react";

type DispatchRide = {
  booking_id: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  status: string | null;
  created_at: string | null;
  passenger_name: string | null;
  driver_name: string | null;
  vehicle_type: string | null;
  plate_number: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  driver_status: string | null;
};

type ApiResponse =
  | {
      ok: true;
      rows: DispatchRide[];
    }
  | {
      ok?: false;
      error: string;
      message?: string;
      details?: unknown;
    };

export default function DispatchPage() {
  const [rides, setRides] = useState<DispatchRide[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  async function fetchOverview() {
    try {
      setError(null);

      const res = await fetch("/api/dispatch/overview", {
        method: "GET",
        cache: "no-store",
      });

      const data: ApiResponse = await res.json();

      if (!res.ok || (data as any).ok === false) {
        const msg =
          (data as any).message ||
          (data as any).error ||
          "Failed to load dispatch data";
        setError(msg);
        return;
      }

      const rows = (data as any).rows ?? [];
      setRides(rows);
      setLastUpdated(new Date().toLocaleTimeString());
    } catch (err) {
      console.error("Error fetching dispatch overview:", err);
      setError("Unexpected error while loading dispatch overview");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // Initial load
    fetchOverview();

    // Simple polling every 10 seconds
    const interval = setInterval(() => {
      fetchOverview();
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-4 md:p-6 lg:p-8 space-y-4">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dispatch Overview</h1>
          <p className="text-sm text-gray-500">
            Live list of active bookings and their assigned drivers.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchOverview}
            className="px-3 py-1.5 rounded-md border text-sm font-medium hover:bg-gray-50"
          >
            Refresh now
          </button>
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Last updated: {lastUpdated}
            </span>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-sm text-gray-500">Loading dispatch data…</div>
      )}

      {error && (
        <div className="text-sm text-red-600 border border-red-200 bg-red-50 p-3 rounded-md">
          <div className="font-semibold mb-1">Error</div>
          <div>{error}</div>
        </div>
      )}

      {!loading && !error && rides.length === 0 && (
        <div className="text-sm text-gray-500 border border-dashed border-gray-300 rounded-md p-4">
          No active rides found right now.
        </div>
      )}

      {!loading && !error && rides.length > 0 && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-3 py-2 text-left font-semibold">Booking ID</th>
                <th className="px-3 py-2 text-left font-semibold">Passenger</th>
                <th className="px-3 py-2 text-left font-semibold">Driver</th>
                <th className="px-3 py-2 text-left font-semibold">Vehicle</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-left font-semibold">Driver Status</th>
                <th className="px-3 py-2 text-left font-semibold">Created</th>
              </tr>
            </thead>
            <tbody>
              {rides.map((ride) => (
                <tr
                  key={ride.booking_id}
                  className="border-t hover:bg-gray-50 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-xs">
                    {ride.booking_id}
                  </td>
                  <td className="px-3 py-2">
                    {ride.passenger_name || <span className="text-gray-400">N/A</span>}
                  </td>
                  <td className="px-3 py-2">
                    {ride.driver_name || <span className="text-gray-400">Unassigned</span>}
                  </td>
                  <td className="px-3 py-2">
                    {ride.vehicle_type || "-"}{" "}
                    {ride.plate_number ? `(${ride.plate_number})` : ""}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                      {ride.status || "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-gray-100 text-gray-700">
                      {ride.driver_status || "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {ride.created_at
                      ? new Date(ride.created_at).toLocaleString()
                      : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
