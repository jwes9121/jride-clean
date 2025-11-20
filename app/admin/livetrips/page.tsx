"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import DispatchRow, { BookingRow } from "./DispatchRow";
import { DriverInfo } from "./dispatchRules";

const BOOKINGS_ENDPOINT = "/api/admin/livetrips";
const DRIVERS_ENDPOINT = "/api/admin/drivers";
const ACTIONS_ENDPOINT = "/api/admin/livetrips/actions";

export default function LiveTripsPage() {
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [drivers, setDrivers] = useState<DriverInfo[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [workingBookingId, setWorkingBookingId] = useState<string | null>(null);

  const hasData = useMemo(
    () => bookings.length > 0 || drivers.length > 0,
    [bookings, drivers]
  );

  const fetchBookingsAndDrivers = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const [bookingsRes, driversRes] = await Promise.all([
        fetch(BOOKINGS_ENDPOINT, { method: "GET" }),
        fetch(DRIVERS_ENDPOINT, { method: "GET" }),
      ]);

      if (!bookingsRes.ok) {
        const text = await bookingsRes.text();
        throw new Error(
          `Failed to load bookings (${bookingsRes.status}): ${text}`
        );
      }

      if (!driversRes.ok) {
        const text = await driversRes.text();
        throw new Error(
          `Failed to load drivers (${driversRes.status}): ${text}`
        );
      }

      const bookingsJson = await bookingsRes.json();
      const driversJson = await driversRes.json();

      const bookingsData: BookingRow[] = Array.isArray(bookingsJson)
        ? (bookingsJson as BookingRow[])
        : ((bookingsJson.bookings ?? []) as BookingRow[]);

      const driversData: DriverInfo[] = Array.isArray(driversJson)
        ? (driversJson as DriverInfo[])
        : ((driversJson.drivers ?? []) as DriverInfo[]);

      setBookings(bookingsData);
      setDrivers(driversData);
    } catch (err: any) {
      console.error("Error loading livetrips:", err);
      setError(err?.message || "Failed to load live trips.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBookingsAndDrivers();
  }, [fetchBookingsAndDrivers]);

  type DispatchActionName =
    | "assign"
    | "reassign"
    | "on_the_way"
    | "start_trip"
    | "drop_off"
    | "cancel";

  async function callDispatchAction(
    action: DispatchActionName,
    booking: BookingRow
  ) {
    setWorkingBookingId(booking.id);
    setError(null);

    try {
      const res = await fetch(ACTIONS_ENDPOINT, {
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
          `Failed to perform action "${action}" (${res.status}): ${text}`
        );
      }

      await fetchBookingsAndDrivers();
    } catch (err: any) {
      console.error("Dispatch action error:", err);
      setError(err?.message || "Action failed.");
    } finally {
      setWorkingBookingId(null);
    }
  }

  function handleAssign(booking: BookingRow) {
    return callDispatchAction("assign", booking);
  }

  function handleReassign(booking: BookingRow) {
    return callDispatchAction("reassign", booking);
  }

  function handleMarkOnTheWay(booking: BookingRow) {
    return callDispatchAction("on_the_way", booking);
  }

  function handleStartTrip(booking: BookingRow) {
    return callDispatchAction("start_trip", booking);
  }

  function handleDropOff(booking: BookingRow) {
    return callDispatchAction("drop_off", booking);
  }

  function handleCancel(booking: BookingRow) {
    const ok = window.confirm(
      `Cancel booking ${booking.booking_code}? This cannot be undone.`
    );
    if (!ok) return;
    return callDispatchAction("cancel", booking);
  }

  function handleViewMap(booking: BookingRow) {
    const url = new URL(window.location.origin + "/admin/livetrips/map");
    url.searchParams.set("bookingId", booking.id);
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Live Trips (Dispatch)</h1>
          <p className="text-sm text-gray-500">
            Driver names + button rules are centralized in{" "}
            <code className="font-mono text-xs bg-gray-100 px-1 py-0.5 rounded">
              dispatchRules.ts
            </code>
            .
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchBookingsAndDrivers}
            className="text-xs border rounded-full px-3 py-1 disabled:opacity-40"
            disabled={isLoading}
          >
            {isLoading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {error}
        </div>
      )}

      {isLoading && !hasData ? (
        <div className="text-sm text-gray-500">Loading live trips…</div>
      ) : bookings.length === 0 ? (
        <div className="text-sm text-gray-500">
          No active bookings found right now.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
          <table className="min-w-full text-left">
            <thead className="bg-gray-50 text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Booking
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Driver / Status
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Route
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Created
                </th>
                <th className="px-3 py-2 font-medium whitespace-nowrap">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {bookings.map((b) => (
                <DispatchRow
                  key={b.id}
                  booking={b}
                  drivers={drivers}
                  isWorking={workingBookingId === b.id}
                  onAssign={handleAssign}
                  onReassign={handleReassign}
                  onCancel={handleCancel}
                  onMarkOnTheWay={handleMarkOnTheWay}
                  onStartTrip={handleStartTrip}
                  onDropOff={handleDropOff}
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
