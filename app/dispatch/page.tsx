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
  from_label: string | null;
  to_label: string | null;
  town: string | null;
  status: string | null;
  assigned_driver_id: string | null;
  updated_at: string | null;
};

export default function DispatchPage() {
  const [trips, setTrips] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadTrips = async () => {
    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,
        booking_code,
        passenger_name,
        from_label,
        to_label,
        town,
        status,
        assigned_driver_id,
        updated_at
      `)
      .order("updated_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("DB_ERROR", error);
      setErrorMessage(error.message);
      setTrips([]);
    } else {
      setTrips((data as BookingRow[]) ?? []);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadTrips();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">JRide Dispatch – Active / Recent Trips</h1>
        <button
          onClick={loadTrips}
          disabled={loading}
          className="px-3 py-1 rounded text-sm border bg-blue-600 text-white disabled:opacity-60"
        >
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {errorMessage && (
        <div className="p-3 rounded bg-red-100 text-red-800 text-sm border border-red-300">
          Supabase Error: {errorMessage}
        </div>
      )}

      {loading ? (
        <p>Loading...</p>
      ) : trips.length === 0 ? (
        <p>No trips found.</p>
      ) : (
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
            {trips.map((t) => (
              <tr key={t.id}>
                <td className="p-2 border">{t.booking_code}</td>
                <td className="p-2 border">{t.passenger_name}</td>
                <td className="p-2 border">{t.from_label}</td>
                <td className="p-2 border">{t.to_label}</td>
                <td className="p-2 border">{t.town}</td>
                <td className="p-2 border font-bold uppercase">{t.status}</td>
                <td className="p-2 border">{t.assigned_driver_id ?? "—"}</td>
                <td className="p-2 border">{t.updated_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
