"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

type BookingRow = {
  id: string;
  booking_code: string | null;
  passenger_name: string | null;
  pickup_address: string | null;
  dropoff_address: string | null;
  status: string | null;
  assigned_driver_id: string | null;
};

export default function DispatchPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionBookingId, setActionBookingId] = useState<string | null>(null);

  const loadTrips = async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_code, passenger_name, pickup_address, dropoff_address, status, assigned_driver_id"
      )
      .in("status", ["accepted", "assigned", "arrived", "on_trip"])
      .order("id", { ascending: false });

    if (error) {
      console.error("ACTIVE_TRIPS_DB_ERROR", error);
      setTrips([]);
    } else {
      setTrips((data as BookingRow[]) ?? []);
    }

    setLoading(false);
  };

  const handleAssignNearest = async (bookingId: string) => {
    if (!window.confirm("Assign nearest driver to this trip?")) return;
    setActionBookingId(bookingId);

    try {
      const res = await fetch("/api/rides/assign-nearest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId }),
      });

      if (!res.ok) {
        console.error("ASSIGN_NEAREST_ERROR", await res.text());
        alert("Failed to assign nearest driver.");
      } else {
        await loadTrips();
      }
    } catch (err) {
      console.error("ASSIGN_NEAREST_ERROR", err);
      alert("Failed to assign nearest driver.");
    } finally {
      setActionBookingId(null);
    }
  };

  const handleCancelTrip = async (bookingId: string) => {
    if (!window.confirm("Mark this trip as cancelled?")) return;
    setActionBookingId(bookingId);

    try {
      const res = await fetch("/api/rides", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, status: "cancelled" }),
      });

      if (!res.ok) {
        console.error("CANCEL_TRIP_ERROR", await res.text());
        alert("Failed to cancel trip.");
      } else {
        await loadTrips();
      }
    } catch (err) {
      console.error("CANCEL_TRIP_ERROR", err);
      alert("Failed to cancel trip.");
    } finally {
      setActionBookingId(null);
    }
  };

  const handleViewMap = (bookingId: string) => {
    router.push(`/admin/livetrips?bookingId=${bookingId}`);
  };

  useEffect(() => {
    // initial load
    loadTrips();

    // realtime updates
    const channel = supabase
      .channel("bookings_changes_dispatch_ui")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bookings" },
        () => {
          loadTrips();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          JRide Dispatch – Active Trips
        </h1>
        <button
          onClick={loadTrips}
          disabled={loading}
          className="px-3 py-1 rounded text-sm border bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {loading ? (
        <p>Loading active trips...</p>
      ) : trips.length === 0 ? (
        <p>No active trips right now.</p>
      ) : (
        <table className="min-w-full border text-sm">
          <thead>
            <tr className="bg-gray-200">
              <th className="p-2 border">Code</th>
              <th className="p-2 border">Passenger</th>
              <th className="p-2 border">Pickup</th>
              <th className="p-2 border">Drop Off</th>
              <th className="p-2 border">Status</th>
              <th className="p-2 border">Driver</th>
              <th className="p-2 border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => (
              <tr key={t.id}>
                <td className="p-2 border">{t.booking_code}</td>
                <td className="p-2 border">{t.passenger_name}</td>
                <td className="p-2 border">{t.pickup_address}</td>
                <td className="p-2 border">{t.dropoff_address}</td>
                <td className="p-2 border font-bold uppercase">
                  {t.status}
                </td>
                <td className="p-2 border">
                  {t.assigned_driver_id ?? "—"}
                </td>
                <td className="p-2 border space-x-1">
                  <button
                    onClick={() => handleAssignNearest(t.id)}
                    disabled={loading || actionBookingId === t.id}
                    className="px-2 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-60"
                  >
                    Assign
                  </button>
                  <button
                    onClick={() => handleCancelTrip(t.id)}
                    disabled={loading || actionBookingId === t.id}
                    className="px-2 py-1 text-xs rounded bg-red-600 text-white disabled:opacity-60"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleViewMap(t.id)}
                    className="px-2 py-1 text-xs rounded border"
                  >
                    View Map
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
