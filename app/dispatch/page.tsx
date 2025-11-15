"use client";

import { useEffect, useState, useCallback } from "react";
import { AssignNearestButton } from "@/components/AssignNearestButton";

type Booking = {
  id: string;
  booking_code: string | null;
  status: string;
  assigned_driver_id: string | null;
  created_at: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
};

type SummaryResponse =
  | {
      ok: true;
      pending: Booking[];
      active: Booking[];
      completed: Booking[];
    }
  | {
      ok: false;
      error: string;
      message?: string;
    };

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  searching: "Searching",
  assigned: "Assigned",
  driver_accepted: "Driver Accepted",
  driver_arrived: "Driver Arrived",
  passenger_onboard: "Passenger Onboard",
  in_transit: "In Transit",
  completed: "Completed",
};

function getStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

// Determine the next status in your B-flow and corresponding button label
function getNextStatusAndLabel(
  currentStatus: string
): { nextStatus: string; label: string } | null {
  switch (currentStatus) {
    case "assigned":
      return { nextStatus: "driver_accepted", label: "Mark Driver Accepted" };
    case "driver_accepted":
      return { nextStatus: "driver_arrived", label: "Mark Arrived" };
    case "driver_arrived":
      return { nextStatus: "passenger_onboard", label: "Passenger Onboard" };
    case "passenger_onboard":
      return { nextStatus: "in_transit", label: "Start Trip" };
    case "in_transit":
      return { nextStatus: "completed", label: "Complete Trip" };
    default:
      return null;
  }
}

export default function DispatchPage() {
  const [pending, setPending] = useState<Booking[]>([]);
  const [active, setActive] = useState<Booking[]>([]);
  const [completed, setCompleted] = useState<Booking[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastReload, setLastReload] = useState<Date | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);
    setErrorText(null);

    try {
      const res = await fetch("/api/admin/livetrips/summary", {
        method: "GET",
        cache: "no-store",
      });

      const data: SummaryResponse = await res.json();

      if (!res.ok || !("ok" in data) || data.ok === false) {
        const msg =
          (data as any)?.message ??
          (data as any)?.error ??
          `Request failed with status ${res.status}`;
        setErrorText(`Failed to load trips: ${msg}`);
        setPending([]);
        setActive([]);
        setCompleted([]);
        return;
      }

      setPending(data.pending ?? []);
      setActive(data.active ?? []);
      setCompleted(data.completed ?? []);
      setLastReload(new Date());
    } catch (err: any) {
      setErrorText(
        `Server error while fetching trips: ${
          err?.message ?? "Unknown error"
        }`
      );
      setPending([]);
      setActive([]);
      setCompleted([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const handleAfterAssign = useCallback(() => {
    // After assigning nearest driver, reload all lists
    loadSummary();
  }, [loadSummary]);

  const handleAdvanceStatus = useCallback(
    async (booking: Booking) => {
      const nextInfo = getNextStatusAndLabel(booking.status);
      if (!nextInfo) return;

      setUpdatingId(booking.id);

      try {
        const res = await fetch("/api/admin/livetrips/update-status", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            bookingId: booking.id,
            nextStatus: nextInfo.nextStatus,
          }),
        });

        const data = await res.json().catch(() => null);

        if (!res.ok || !data?.ok) {
          const msg =
            data?.message ||
            data?.error ||
            `Status update failed with status ${res.status}`;
          setErrorText(`Failed to update status: ${msg}`);
          return;
        }

        // Reload lists after successful update
        await loadSummary();
      } catch (err: any) {
        setErrorText(
          `Server error while updating status: ${
            err?.message ?? "Unknown error"
          }`
        );
      } finally {
        setUpdatingId(null);
      }
    },
    [loadSummary]
  );

  return (
    <main className="p-4 md:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* HEADER */}
        <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h1 className="text-xl md:text-2xl font-semibold">
              JRide Dispatch Console
            </h1>
            <p className="text-sm text-gray-600">
              Live console for dispatchers to manage the ride queue, active
              trips, and completions. Uses the B-flow statuses:
              {" "}
              <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                assigned → driver_accepted → driver_arrived → passenger_onboard
                → in_transit → completed
              </code>
              .
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={loadSummary}
              disabled={loading}
              className="px-3 py-2 rounded-md border text-sm font-medium
                         disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? "Refreshing..." : "Refresh All"}
            </button>

            <AssignNearestButton onAfterAction={handleAfterAssign} />
          </div>
        </header>

        {/* ERROR BANNER */}
        {errorText && (
          <div className="border border-red-200 bg-red-50 text-red-700 text-sm rounded-md px-3 py-2">
            {errorText}
          </div>
        )}

        {/* PENDING QUEUE */}
        <section className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Pending Queue (status = &apos;pending&apos; or &apos;searching&apos;, no driver yet)
            </h2>
            <span className="text-xs text-gray-500">
              {lastReload
                ? `Last reload: ${lastReload.toLocaleTimeString()}`
                : "Not loaded yet"}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    #
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Booking Code
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Created At
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Pickup (Lat, Lng)
                  </th>
                </tr>
              </thead>
              <tbody>
                {pending.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      No pending bookings in queue.
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      Loading trips...
                    </td>
                  </tr>
                )}

                {!loading &&
                  pending.map((b, index) => (
                    <tr
                      key={b.id}
                      className="border-t last:border-b hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-800">
                        {b.booking_code ?? b.id}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {getStatusLabel(b.status)}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {b.pickup_lat != null && b.pickup_lng != null ? (
                          <>
                            {b.pickup_lat.toFixed(5)},{" "}
                            {b.pickup_lng.toFixed(5)}
                          </>
                        ) : (
                          <span className="text-gray-400 italic">n/a</span>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ACTIVE TRIPS */}
        <section className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-medium">
              Active Trips (assigned → in_transit)
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    #
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Booking Code
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Status
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Driver
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Created At
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {active.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      No active trips at the moment.
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      Loading trips...
                    </td>
                  </tr>
                )}

                {!loading &&
                  active.map((b, index) => {
                    const nextInfo = getNextStatusAndLabel(b.status);

                    return (
                      <tr
                        key={b.id}
                        className="border-t last:border-b hover:bg-gray-50"
                      >
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {index + 1}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-800">
                          {b.booking_code ?? b.id}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {getStatusLabel(b.status)}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {b.assigned_driver_id ?? (
                            <span className="text-gray-400 italic">
                              unknown
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {new Date(b.created_at).toLocaleString()}
                        </td>
                        <td className="px-3 py-2 align-top text-xs text-gray-700">
                          {nextInfo ? (
                            <button
                              type="button"
                              onClick={() => handleAdvanceStatus(b)}
                              disabled={updatingId === b.id}
                              className="px-3 py-1 rounded-md border text-xs font-medium
                                         disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {updatingId === b.id
                                ? "Updating..."
                                : nextInfo.label}
                            </button>
                          ) : (
                            <span className="text-gray-400 italic">
                              No action
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        </section>

        {/* COMPLETED TODAY */}
        <section className="border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
            <h2 className="text-sm font-medium">Completed Trips (today)</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-100">
                <tr>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    #
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Booking Code
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Driver
                  </th>
                  <th className="px-3 py-2 text-left font-medium text-xs text-gray-600">
                    Completed At
                  </th>
                </tr>
              </thead>
              <tbody>
                {completed.length === 0 && !loading && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      No trips completed today yet.
                    </td>
                  </tr>
                )}

                {loading && (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-xs text-gray-500"
                    >
                      Loading trips...
                    </td>
                  </tr>
                )}

                {!loading &&
                  completed.map((b, index) => (
                    <tr
                      key={b.id}
                      className="border-t last:border-b hover:bg-gray-50"
                    >
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {index + 1}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-800">
                        {b.booking_code ?? b.id}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {b.assigned_driver_id ?? (
                          <span className="text-gray-400 italic">
                            unknown
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 align-top text-xs text-gray-700">
                        {new Date(b.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
