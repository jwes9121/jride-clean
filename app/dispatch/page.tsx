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

type DriverNameMap = Record<string, string>;

function normalizeStatus(status: string | null): string {
  return (status ?? "").toLowerCase();
}

async function fetchDriverNamesForBookings(
  bookings: BookingRow[]
): Promise<DriverNameMap> {
  const ids = Array.from(
    new Set(
      bookings
        .map((b) => b.assigned_driver_id)
        .filter((id): id is string => !!id)
    )
  );

  if (!ids.length) return {};

  try {
    const { data, error } = await supabase
      .from("drivers")
      .select("*")
      .in("id", ids);

    if (error || !data) {
      console.error("DRIVER_NAMES_ERROR", error);
      return {};
    }

    const map: DriverNameMap = {};
    (data as any[]).forEach((row) => {
      const anyRow: any = row;
      const label =
        anyRow.full_name ??
        anyRow.name ??
        anyRow.driver_name ??
        anyRow.display_name ??
        anyRow.label ??
        (typeof anyRow.id === "string"
          ? anyRow.id.substring(0, 8)
          : String(anyRow.id ?? ""));

      if (anyRow.id && label) {
        map[String(anyRow.id)] = String(label);
      }
    });

    return map;
  } catch (err) {
    console.error("DRIVER_NAMES_UNEXPECTED", err);
    return {};
  }
}

export default function DispatchPage() {
  const [trips, setTrips] = useState<BookingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [actionBookingId, setActionBookingId] = useState<string | null>(null);
  const [driverNames, setDriverNames] = useState<DriverNameMap>({});

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
      setDriverNames({});
      setLoading(false);
      return;
    }

    const bookings = (data as BookingRow[]) ?? [];
    setTrips(bookings);

    const names = await fetchDriverNamesForBookings(bookings);
    setDriverNames(names);

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
    if (!window.confirm("Mark this trip as CANCELLED?")) return;
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
    window.location.href = `/admin/livetripss?bookingId=${bookingId}`;
  };

  useEffect(() => {
    loadTrips();
  }, []);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">
          JRide Dispatch – Active / Recent Trips
        </h1>
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
              <th className="p-2 border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trips.map((t) => {
              const normStatus = normalizeStatus(t.status);
              const isCompleted = normStatus === "completed";
              const isCancelled = normStatus === "cancelled";
              const isInactive = isCompleted || isCancelled;
              const isOnTrip = normStatus === "on_trip";
              const isBusy = actionBookingId === t.id;

              let statusClass = "";
              if (normStatus === "on_trip") statusClass = "text-green-700";
              else if (normStatus === "assigned" || normStatus === "accepted")
                statusClass = "text-blue-700";
              else if (normStatus === "cancelled")
                statusClass = "text-red-700";
              else if (normStatus === "completed")
                statusClass = "text-gray-700";

              const driverLabel = t.assigned_driver_id
                ? driverNames[t.assigned_driver_id] ??
                  t.assigned_driver_id ??
                  "—"
                : "—";

              return (
                <tr key={t.id}>
                  <td className="p-2 border">{t.booking_code}</td>
                  <td className="p-2 border">{t.passenger_name}</td>
                  <td className="p-2 border">{t.from_label}</td>
                  <td className="p-2 border">{t.to_label}</td>
                  <td className="p-2 border">{t.town}</td>
                  <td className={`p-2 border font-bold uppercase ${statusClass}`}>
                    {t.status}
                  </td>
                  <td className="p-2 border">{driverLabel}</td>
                  <td className="p-2 border">{t.updated_at}</td>
                  <td className="p-2 border space-x-1">
                    {isInactive ? (
                      <span className="text-xs text-gray-500">
                        {isCompleted ? "Completed" : "Cancelled"}
                      </span>
                    ) : (
                      <>
                        {/* Hide Assign when already ON_TRIP */}
                        {!isOnTrip && (
                          <button
                            onClick={() => handleAssignNearest(t.id)}
                            disabled={isBusy}
                            className="px-2 py-1 text-xs rounded bg-green-600 text-white disabled:opacity-60"
                          >
                            Assign
                          </button>
                        )}
                        <button
                          onClick={() => handleCancelTrip(t.id)}
                          disabled={isBusy}
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
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

