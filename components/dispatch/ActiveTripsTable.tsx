"use client";

import { useState } from "react";
import { FareDetailsButton } from "@/components/dispatch/FareDetailsButton";

type PassengerFareResponse = "accepted" | "rejected" | null;

type ActiveTrip = {
  booking_code: string;
  status: string;
  driver: string | null;
  created_at: string;

  // New optional fields for fare control
  passenger_name?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  proposed_fare?: number | null;
  passenger_fare_response?: PassengerFareResponse;
  verified_fare?: number | null;
  verified_by?: string | null;
  verified_reason?: string | null;
};

type ActiveTripsTableProps = {
  trips: ActiveTrip[];
  onRefresh: () => void; // call your existing reload function here
};

export function ActiveTripsTable({ trips, onRefresh }: ActiveTripsTableProps) {
  const [loadingCode, setLoadingCode] = useState<string | null>(null);

  async function updateStatus(
    bookingCode: string,
    status: "in_transit" | "completed"
  ) {
    try {
      setLoadingCode(bookingCode);

      const res = await fetch("/api/rides/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ bookingCode, status }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        console.error("Status update failed", json);
        alert("Failed to update status: " + (json?.error ?? "UNKNOWN_ERROR"));
        return;
      }

      // refresh the data in the console
      onRefresh();
    } catch (err) {
      console.error(err);
      alert("Network error while updating status.");
    } finally {
      setLoadingCode(null);
    }
  }

  function renderActionButtons(trip: ActiveTrip) {
    const baseClasses =
      "px-3 py-1 rounded text-xs font-medium border border-zinc-500 hover:bg-zinc-700 transition";

    if (trip.status === "driver_accepted") {
      return (
        <button
          onClick={() => updateStatus(trip.booking_code, "in_transit")}
          disabled={loadingCode === trip.booking_code}
          className={baseClasses}
        >
          {loadingCode === trip.booking_code ? "Updating…" : "Start Trip"}
        </button>
      );
    }

    if (trip.status === "in_transit") {
      return (
        <button
          onClick={() => updateStatus(trip.booking_code, "completed")}
          disabled={loadingCode === trip.booking_code}
          className={baseClasses}
        >
          {loadingCode === trip.booking_code ? "Updating…" : "Complete Trip"}
        </button>
      );
    }

    // for completed or other statuses, no button
    return <span className="text-xs text-zinc-500">—</span>;
  }

  return (
    <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-zinc-100">
          Active Trips (assigned → in_transit → dropoff)
        </h2>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-zinc-600 px-3 py-1.5 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          Refresh
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs text-left text-zinc-200">
          <thead className="border-b border-zinc-800 text-[11px] uppercase text-zinc-400">
            <tr>
              <th className="px-2 py-2">#</th>
              <th className="px-2 py-2">Booking Code</th>
              <th className="px-2 py-2">Status</th>
              <th className="px-2 py-2">Driver</th>
              <th className="px-2 py-2">Created At</th>
              <th className="px-2 py-2">Fare</th>
              <th className="px-2 py-2">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {trips.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-2 py-6 text-center text-xs text-zinc-500"
                >
                  No active trips.
                </td>
              </tr>
            )}

            {trips.map((trip, idx) => (
              <tr key={trip.booking_code}>
                <td className="px-2 py-2">{idx + 1}</td>
                <td className="px-2 py-2 font-mono text-[11px]">
                  {trip.booking_code}
                </td>
                <td className="px-2 py-2">{trip.status}</td>
                <td className="px-2 py-2">
                  {trip.driver ?? (
                    <span className="text-zinc-500 text-xs">
                      No driver name
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-[11px]">
                  {new Date(trip.created_at).toLocaleString()}
                </td>
                <td className="px-2 py-2">
                  <FareDetailsButton booking={trip} onUpdated={onRefresh} />
                </td>
                <td className="px-2 py-2">{renderActionButtons(trip)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
