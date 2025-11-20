// app/admin/livetrips/page.tsx
"use client";

import { useEffect, useState } from "react";

type Booking = {
  id: string;
  booking_code: string;
  status: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  assigned_driver_id: string | null;
  created_at: string;
};

export default function LiveTripsPage() {
  const [trips, setTrips] = useState<Booking[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completingCode, setCompletingCode] = useState<string | null>(null);

  const fetchTrips = async () => {
    try {
      setError(null);
      const res = await fetch("/api/admin/active-trips", {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("ACTIVE_TRIPS_FETCH_ERROR", body);
        throw new Error(
          body?.message ?? body?.error ?? res.statusText ?? "Unknown error"
        );
      }
      const data = (await res.json()) as Booking[];
      setTrips(data);
    } catch (err: any) {
      console.error("ACTIVE_TRIPS_UI_ERROR", err);
      setError(err?.message ?? "Error loading active trips");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrips();
    const interval = setInterval(fetchTrips, 5000); // refresh every 5s
    return () => clearInterval(interval);
  }, []);

  const handleComplete = async (booking: Booking) => {
    if (completingCode) return;
    const bookingCode = booking.booking_code;
    setCompletingCode(bookingCode);

    try {
      const res = await fetch("/api/admin/complete-trip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingCode }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.error("COMPLETE_TRIP_ERROR", body);
        alert(
          "Failed to complete ride: " +
            (body?.message ?? body?.error ?? res.statusText)
        );
      } else {
        const body = await res.json().catch(() => ({}));
        console.log("COMPLETE_TRIP_SUCCESS", body);
        alert("Ride marked as completed.");
        // Re-fetch list so UI stays in sync with DB
        fetchTrips();
      }
    } catch (err: any) {
      console.error("COMPLETE_TRIP_CATCH", err);
      alert("Failed to complete ride: " + (err?.message ?? "Unknown error"));
    } finally {
      setCompletingCode(null);
    }
  };

  if (loading && !trips) {
    return <div className="p-4">Loading active trips…</div>;
  }

  if (error) {
    return (
      <div className="p-4 text-red-600">
        Error loading active trips. Check /api/admin/active-trips.
        <br />
        <span className="text-xs text-gray-700">{error}</span>
      </div>
    );
  }

  const activeTrips = trips ?? [];

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-2xl font-semibold mb-2">Live Trips (Dispatch)</h1>
      {activeTrips.length === 0 ? (
        <div className="text-gray-600">No active trips.</div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100">
              <tr>
                <th className="px-3 py-2 text-left">Code</th>
                <th className="px-3 py-2 text-left">Pickup (lat,lng)</th>
                <th className="px-3 py-2 text-left">Dropoff (lat,lng)</th>
                <th className="px-3 py-2 text-left">Driver</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Created</th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {activeTrips.map((trip) => (
                <tr key={trip.id} className="border-t">
                  <td className="px-3 py-2 font-mono">{trip.booking_code}</td>
                  <td className="px-3 py-2">
                    {trip.pickup_lat != null && trip.pickup_lng != null
                      ? `${trip.pickup_lat.toFixed(
                          5
                        )}, ${trip.pickup_lng.toFixed(5)}`
                      : "-"}
                  </td>
                  <td className="px-3 py-2">
                    {trip.dropoff_lat != null && trip.dropoff_lng != null
                      ? `${trip.dropoff_lat.toFixed(
                          5
                        )}, ${trip.dropoff_lng.toFixed(5)}`
                      : "-"}
                  </td>
                  <td className="px-3 py-2">
                    {trip.assigned_driver_id ?? "-"}
                  </td>
                  <td className="px-3 py-2">{trip.status ?? "-"}</td>
                  <td className="px-3 py-2">
                    {trip.created_at
                      ? new Date(trip.created_at).toLocaleString()
                      : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      className="px-3 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-50"
                      disabled={completingCode === trip.booking_code}
                      onClick={() => handleComplete(trip)}
                    >
                      {completingCode === trip.booking_code
                        ? "Completing…"
                        : "Complete ride"}
                    </button>
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
