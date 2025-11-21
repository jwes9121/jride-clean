"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DispatchRow, { BookingRow } from "./DispatchRow";
import { DriverInfo } from "./dispatchRules";

type DispatchActionName =
  | "assign"
  | "reassign"
  | "on_the_way"
  | "start_trip"
  | "drop_off"
  | "cancel";

type BookingsResponse = {
  bookings: BookingRow[];
};

type DriversResponse = {
  drivers: DriverInfo[];
};

export default function LiveTripsPage() {
  const router = useRouter();

  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [initialLoading, setInitialLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [workingBookingId, setWorkingBookingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function fetchBookings(): Promise<BookingRow[]> {
    const res = await fetch("/api/admin/livetrips", {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(
        `Failed to load bookings: HTTP ${res.status} ${text || ""}`
      );
    }

    const json = (await res.json()) as BookingsResponse;
    return json.bookings ?? [];
  }

  async function fetchDrivers(): Promise<DriverInfo[]> {
    const res = await fetch("/api/admin/drivers", {
      method: "GET",
      cache: "no-store",
    });

    if (!res.ok) {
      // drivers are optional; do not hard fail live trips
      console.warn("Failed to load drivers", res.status);
      return [];
    }

    const json = (await res.json()) as DriversResponse;
    return json.drivers ?? [];
  }

  // Initial load
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setInitialLoading(true);
      setError(null);

      try {
        const [bookingsData, driversData] = await Promise.all([
          fetchBookings(),
          fetchDrivers(),
        ]);

        if (!cancelled) {
          setBookings(bookingsData);
          setDrivers(driversData);
        }
      } catch (err: any) {
        console.error("LIVE_TRIPS_LOAD_ERROR", err);
        if (!cancelled) {
          setError(err?.message ?? "Failed to load live trips.");
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  async function refreshBookings() {
    setIsRefreshing(true);
    setError(null);

    try {
      const bookingsData = await fetchBookings();
      setBookings(bookingsData);
    } catch (err: any) {
      console.error("LIVE_TRIPS_REFRESH_ERROR", err);
      setError(err?.message ?? "Failed to refresh bookings.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleAction(booking: BookingRow, action: DispatchActionName) {
    setWorkingBookingId(booking.id);
    setError(null);

    try {
      const res = await fetch("/api/admin/livetrips/actions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          bookingId: booking.id,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(
          `Action ${action} failed: HTTP ${res.status} ${text || ""}`
        );
      }

      const json = (await res.json()) as {
        ok: boolean;
        booking?: BookingRow;
        error?: string;
        message?: string;
      };

      if (!json.ok) {
        throw new Error(json.message || json.error || "Action failed.");
      }

      if (json.booking) {
        const updated = json.booking;

        setBookings((prev) =>
          prev.map((b) => (b.id === updated.id ? { ...b, ...updated } : b))
        );
      } else {
        // Fallback: refresh all bookings if API did not return a row
        await refreshBookings();
      }
    } catch (err: any) {
      console.error("LIVE_TRIPS_ACTION_ERROR", err);
      setError(err?.message ?? "Unexpected error while performing action.");
    } finally {
      setWorkingBookingId(null);
    }
  }

  function handleViewMap(booking: BookingRow) {
    router.push(`/admin/livetrips/map?bookingId=${booking.id}`);
  }

  const isWorking = (bookingId: string) => workingBookingId === bookingId;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Live Trips (Dispatch)</h1>
          <p className="text-sm text-gray-500">
            Driver names + button rules are centralized in{" "}
            <code className="px-1 py-0.5 rounded bg-gray-100 text-xs">
              dispatchRules.ts
            </code>
            .
          </p>
        </div>

        <button
          type="button"
          className="text-xs border rounded-full px-3 py-1 hover:bg-gray-50 disabled:opacity-50"
          onClick={refreshBookings}
          disabled={initialLoading || isRefreshing}
        >
          {isRefreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-xs px-3 py-2 rounded">
          {error}
        </div>
      )}

      {initialLoading ? (
        <div className="text-sm text-gray-500">Loading live trips…</div>
      ) : bookings.length === 0 ? (
        <div className="text-sm text-gray-500">
          No active bookings found right now.
        </div>
      ) : (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 text-left">Booking</th>
                <th className="px-3 py-2 text-left">Driver / Status</th>
                <th className="px-3 py-2 text-left">Route</th>
                <th className="px-3 py-2 text-left whitespace-nowrap">
                  Created
                </th>
                <th className="px-3 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((booking) => (
                <DispatchRow
                  key={booking.id}
                  booking={booking}
                  drivers={drivers}
                  isWorking={isWorking(booking.id)}
                  onAssign={(b) => handleAction(b, "assign")}
                  onReassign={(b) => handleAction(b, "reassign")}
                  onCancel={(b) => handleAction(b, "cancel")}
                  onMarkOnTheWay={(b) => handleAction(b, "on_the_way")}
                  onStartTrip={(b) => handleAction(b, "start_trip")}
                  onDropOff={(b) => handleAction(b, "drop_off")}
                  onViewMap={handleViewMap}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
