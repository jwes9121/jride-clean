"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "../../lib/supabaseClient";

type Ride = {
  id: string;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  status?: string | null;
  created_at?: string | null;
  // add more columns if you actually have them in "rides"
};

export default function DispatchPage() {
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    async function loadRides() {
      // call Supabase
      const { data, error } = await supabase
        .from("rides")
        .select("*"); // no args to select() in JS, this is valid

      if (error) {
        console.error("Error loading rides:", error);
        setErrorMsg(error.message);
      } else {
        setRides(data || []);
        setErrorMsg(null);
      }

      setLoading(false);
    }

    loadRides();
  }, []);

  if (loading) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-semibold mb-2">Dispatch Panel</h1>
        <p>Loading rides…</p>
      </main>
    );
  }

  if (errorMsg) {
    return (
      <main className="p-4">
        <h1 className="text-xl font-semibold mb-2">Dispatch Panel</h1>
        <p className="text-red-600">Failed to load rides: {errorMsg}</p>
      </main>
    );
  }

  return (
    <main className="p-4">
      <h1 className="text-xl font-semibold mb-4">Dispatch Panel</h1>

      {rides.length === 0 ? (
        <p className="text-gray-500">No rides found.</p>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-100 text-left">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Pickup</th>
                <th className="px-3 py-2 font-medium">Dropoff</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {rides.map((ride) => (
                <tr
                  key={ride.id}
                  className="border-t hover:bg-gray-50 transition-colors"
                >
                  <td className="px-3 py-2 font-mono text-xs">{ride.id}</td>
                  <td className="px-3 py-2">
                    {ride.pickup_location || "—"}
                  </td>
                  <td className="px-3 py-2">
                    {ride.dropoff_location || "—"}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-block rounded px-2 py-0.5 text-xs border">
                      {ride.status || "unknown"}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500">
                    {ride.created_at
                      ? new Date(ride.created_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
