"use client";

import React, { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

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
  const [trips, setTrips] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);

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
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-4">
        JRide Dispatch – Active Trips
      </h1>

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
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
