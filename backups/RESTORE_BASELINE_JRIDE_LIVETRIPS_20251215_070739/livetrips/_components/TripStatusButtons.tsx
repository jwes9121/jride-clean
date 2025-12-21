"use client";

import { useState } from "react";

type TripStatusButtonsProps = {
  bookingId: string;
  status: string;
  onStatusChanged?: (status: string) => Promise<void> | void;
};

export function TripStatusButtons({
  bookingId,
  status,
  onStatusChanged,
}: TripStatusButtonsProps) {
  const [loading, setLoading] = useState(false);

  const isInProgress = status === "in_progress";
  const isOnTrip = status === "on_trip";
  const isCompleted = status === "completed";

  const handleClick = async (nextStatus: string) => {
    try {
      setLoading(true);

      const res = await fetch("/api/admin/update-trip-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, status: nextStatus }),
      });

      if (!res.ok) {
        console.error("Failed to update trip status, HTTP", res.status);
        return;
      }

      if (onStatusChanged) {
        await onStatusChanged(nextStatus);
      }
    } catch (err) {
      console.error("Failed to update trip status", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      {/* ON THE WAY = STATUS INDICATOR (in_progress) */}
      <button
        type="button"
        disabled
        className="rounded bg-gray-400 px-3 py-1 text-xs font-medium text-gray-100 cursor-default"
      >
        On the Way (in_progress)
      </button>

      {/* START TRIP: only when in_progress */}
      <button
        type="button"
        onClick={() => handleClick("on_trip")}
        disabled={loading || !isInProgress || isCompleted}
        className="rounded px-3 py-1 text-xs font-medium text-white disabled:bg-gray-400 disabled:text-gray-100 disabled:cursor-not-allowed bg-green-600"
      >
        Start Trip (on_trip)
      </button>

      {/* DROP OFF: only when on_trip */}
      <button
        type="button"
        onClick={() => handleClick("completed")}
        disabled={loading || !isOnTrip || isCompleted}
        className="rounded px-3 py-1 text-xs font-medium text-white disabled:bg-gray-400 disabled:text-gray-100 disabled:cursor-not-allowed bg-red-600"
      >
        Drop Off (completed)
      </button>
    </div>
  );
}
