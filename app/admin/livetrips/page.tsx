"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type ActiveTrip = {
  id: string;
  booking_code: string | null;
  passenger_name: string | null;
  from_label: string | null;
  to_label: string | null;
  town: string | null;
  status: string | null;
  assigned_driver_id: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  updated_at: string | null;
};

function normalizeStatus(status: string | null): string {
  return (status ?? "").toLowerCase();
}

export default function LiveTripsPage() {
  const searchParams = useSearchParams();
  const focusedBookingId = searchParams.get("bookingId") ?? undefined;

  const [trips, setTrips] = useState<ActiveTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrips = async () => {
    setLoading(true);
    setErrorMessage(null);

    try {
      const qs = focusedBookingId ? `?bookingId=${focusedBookingId}` : "";
      const res = await fetch(`/api/admin/active-trips${qs}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("ACTIVE_TRIPS_API_ERROR", text);
        setErrorMessage("Failed to load active trips.");
        setTrips([]);
        setLoading(false);
        return;
      }

      const json = await res.json();
      setTrips((json.trips as ActiveTrip[]) ?? []);
    } catch (err) {
      console.error("ACTIVE_TRIPS_API_UNEXPECTED", err);
      setErrorMessage("Unexpected error while loading active trips.");
      setTrips([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTrips();
  }, [focusedBookingId]);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Live Trips (Dispatch)</h1>
        <button
          onClick={loadTrips}
          disabled={loading}
          className="px-3 py-1 rounded text-sm border bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {focusedBookingId && (
        <p className="text-sm text-gray-600">
          Focused booking ID:{" "}
          <span className="font-mono">{focusedBookingId}</span>
        </p>
      )}

      {errorMessage && (
        <div className="p-3 rounded bg-red-100 text-red-800 text-sm border border-red-300">
          {errorMessage}
        </div>
      )}

      {loading ? (
        <p>Loading active trips...</p>
      ) : trips.length === 0 ? (
        <p>No active trips.</p>
      ) : (
        <div className="space-y-3">
          <table className="min-w-full border text-sm">
            <thead>
              <tr className="bg-gray-200">
                <th className="p-2 border">Code</th>
                <th className="p-2 border">Passenger</th>
                <th className="p-2 border">From</th>
                <th className="p-2 border">To</th>
                <th className="p-2 border">Town</th>
                <th className="p-2 border">Status</th>
                <th className="p-2 border">Driver</th>
                <th className="p-2 border">Updated</th>
              </tr>
            </thead>
            <tbody>
              {trips.map((t) => {
                const normStatus = normalizeStatus(t.status);
                const isFocused = focusedBookingId === t.id;
                let statusClass = "";
                if (normStatus === "on_trip") statusClass = "text-green-700";
                else if (normStatus === "assigned" || normStatus === "accepted")
                  statusClass = "text-blue-700";
                else if (normStatus === "cancelled")
                  statusClass = "text-red-700";

                return (
                  <tr
                    key={t.id}
                    className={isFocused ? "bg-yellow-50" : ""}
                  >
                    <td className="p-2 border font-mono">
                      {t.booking_code}
                    </td>
                    <td className="p-2 border">{t.passenger_name}</td>
                    <td className="p-2 border">{t.from_label}</td>
                    <td className="p-2 border">{t.to_label}</td>
                    <td className="p-2 border">{t.town}</td>
                    <td
                      className={`p-2 border font-bold uppercase ${statusClass}`}
                    >
                      {t.status}
                    </td>
                    <td className="p-2 border">
                      {t.assigned_driver_id ?? "—"}
                    </td>
                    <td className="p-2 border">{t.updated_at}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className="text-xs text-gray-500">
            <p>
              This view lists all trips with status{" "}
              <span className="font-mono">
                accepted / assigned / arrived / on_trip
              </span>
              . The row matching the{" "}
              <span className="font-mono">bookingId</span> in the URL is
              highlighted.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
