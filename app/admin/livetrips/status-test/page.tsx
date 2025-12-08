"use client";

import { useCallback, useEffect, useState } from "react";
import { TripStatusButtons } from "../_components/TripStatusButtons";
import { AutoAssignButton } from "../_components/AutoAssignButton";

type Trip = {
  id: string;
  booking_code?: string | null;
  status: string;
  assigned_driver_id?: string | null;
};

export default function StatusTestPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);

  const loadTrips = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/admin/active-trips", {
        cache: "no-store",
      });

      if (!res.ok) {
        console.error("Failed to fetch active trips", res.status);
        setTrips([]);
        return;
      }

      const json = await res.json();

      const items = Array.isArray(json)
        ? json
        : Array.isArray(json.data)
        ? json.data
        : [];

      setTrips(
        items.map((item: any) => ({
          id: item.id,
          booking_code: item.booking_code ?? null,
          status: item.status ?? "unknown",
          assigned_driver_id: item.assigned_driver_id ?? null,
        }))
      );
    } catch (err) {
      console.error("Error loading active trips", err);
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTrips();
  }, [loadTrips]);

  const handleStatusChanged = async (status: string, bookingId: string) => {
    setTrips((prev) => {
      let next = prev.map((trip) =>
        trip.id === bookingId ? { ...trip, status } : trip
      );

      if (status === "completed") {
        next = next.filter((trip) => trip.id !== bookingId);
      }

      return next;
    });
  };

  const handleDriverAssigned = async (
    driverId: string | null,
    status: string,
    bookingId: string
  ) => {
    setTrips((prev) =>
      prev.map((trip) =>
        trip.id === bookingId
          ? { ...trip, assigned_driver_id: driverId ?? trip.assigned_driver_id, status }
          : trip
      )
    );
  };

  if (loading) {
    return (
      <div className="p-4 text-sm text-gray-700">
        Loading trips...
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">JRide – Trip Status & Assignment Test</h1>
      <p className="text-xs text-gray-600">
        This page is for testing: Auto Assign → Start Trip → Drop Off (completed),
        including hotline/manual bookings.
      </p>

      {trips.length === 0 ? (
        <div className="text-sm text-gray-600">
          No active trips found from /api/admin/active-trips.
        </div>
      ) : (
        <table className="min-w-full text-xs border border-gray-200">
          <thead>
            <tr className="bg-gray-100">
              <th className="px-2 py-1 border border-gray-200 text-left">
                Booking
              </th>
              <th className="px-2 py-1 border border-gray-200 text-left">
                Status
              </th>
              <th className="px-2 py-1 border border-gray-200 text-left">
                Assigned Driver
              </th>
              <th className="px-2 py-1 border border-gray-200 text-left">
                Status Actions
              </th>
              <th className="px-2 py-1 border border-gray-200 text-left">
                Auto Assign
              </th>
            </tr>
          </thead>
          <tbody>
            {trips.map((trip) => (
              <tr key={trip.id}>
                <td className="px-2 py-1 border border-gray-200">
                  {trip.booking_code || trip.id}
                </td>
                <td className="px-2 py-1 border border-gray-200">
                  {trip.status}
                </td>
                <td className="px-2 py-1 border border-gray-200">
                  {trip.assigned_driver_id || "-"}
                </td>
                <td className="px-2 py-1 border border-gray-200">
                  <TripStatusButtons
                    bookingId={trip.id}
                    status={trip.status}
                    onStatusChanged={(status) =>
                      handleStatusChanged(status, trip.id)
                    }
                  />
                </td>
                <td className="px-2 py-1 border border-gray-200">
                  <AutoAssignButton
                    bookingId={trip.id}
                    onAssigned={(driverId, status) =>
                      handleDriverAssigned(driverId, status, trip.id)
                    }
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
