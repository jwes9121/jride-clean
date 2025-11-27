"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import DispatchRow, { BookingRow } from "./DispatchRow";
import { DriverInfo } from "./dispatchRules";
import { supabase } from "@/lib/supabaseClient";
import BookingMapClient from "./map/BookingMapClient";

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

  // NEW: currently selected booking for the right-hand map panel
  const [selectedBookingForMap, setSelectedBookingForMap] =
    useState<BookingRow | null>(null);

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

          // If nothing is selected yet but we have bookings, preselect the first one for the map
          if (!selectedBookingForMap && bookingsData.length > 0) {
            setSelectedBookingForMap(bookingsData[0]);
          }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime subscription: keep bookings in sync
  useEffect(() => {
    const channel = supabase
      .channel("realtime-bookings-dispatch")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "bookings",
        },
        (payload) => {
          console.log("REALTIME_BOOKING_CHANGE", payload);

          const updated = payload.new as BookingRow | null;
          if (!updated) return;

          setBookings((prev) => {
            const idx = prev.findIndex((b) => b.id === updated.id);

            if (idx === -1) {
              return prev;
            }

            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...updated };

            // If the updated booking is the one currently on the map, update that too
            setSelectedBookingForMap((current) =>
              current && current.id === updated.id
                ? { ...current, ...updated }
                : current
            );

            return copy;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function refreshBookings() {
    setIsRefreshing(true);
    setError(null);

    try {
      const bookingsData = await fetchBookings();
      setBookings(bookingsData);

      // Keep selection sensible after refresh
      setSelectedBookingForMap((current) => {
        if (!current) {
          return bookingsData[0] ?? null;
        }
        const found = bookingsData.find((b) => b.id === current.id);
        return found ?? (bookingsData[0] ?? null);
      });
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

        // Also update selected booking on the map if it matches
        setSelectedBookingForMap((current) =>
          current && current.id === updated.id
            ? { ...current, ...updated }
            : current
        );
      } else {
        await refreshBookings();
      }
    } catch (err: any) {
      console.error("LIVE_TRIPS_ACTION_ERROR", err);
      setError(err?.message ?? "Unexpected error while performing action.");
    } finally {
      setWorkingBookingId(null);
    }
  }

  // NEW: when dispatcher clicks View map in a row, just select that booking for the map panel
  function handleViewMap(booking: BookingRow) {
    setSelectedBookingForMap(booking);
  }

  const isWorking = (bookingId: string) => workingBookingId === bookingId;

  // Map props based on selected booking
  const mapBooking = selectedBookingForMap;
  const mapProps =
    mapBooking != null
      ? {
          bookingId: mapBooking.id,
          pickupLat: mapBooking.pickup_lat ?? null,
          pickupLng: mapBooking.pickup_lng ?? null,
          dropoffLat: mapBooking.dropoff_lat ?? null,
          dropoffLng: mapBooking.dropoff_lng ?? null,
          driverId: mapBooking.assigned_driver_id ?? null,
        }
      : {
          bookingId: null,
          pickupLat: null,
          pickupLng: null,
          dropoffLat: null,
          dropoffLng: null,
          driverId: null,
        };

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
        // NEW: two-column layout: table + map
        <div className="grid grid-cols-1 xl:grid-cols-[3fr,4fr] gap-4">
          {/* LEFT: table */}
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

          {/* RIGHT: live map for selected booking */}
          <div className="border rounded-lg p-2 flex flex-col">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-xs text-gray-600">
                {mapBooking ? (
                  <>
                    <div>
                      <span className="font-semibold">Selected Booking:</span>{" "}
                      <span className="font-mono">
                        {mapBooking.booking_code ?? mapBooking.id}
                      </span>
                    </div>
                    {mapBooking.assigned_driver_id && (
                      <div>
                        Driver ID:{" "}
                        <span className="font-mono">
                          {mapBooking.assigned_driver_id}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <span>Select a booking to view on the map.</span>
                )}
              </div>
            </div>

            <div className="flex-1 min-h-[420px]">
              <BookingMapClient {...mapProps} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
