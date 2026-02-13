"use client";

import { useState } from "react";

type DriverAssignButtonProps = {
  bookingId: string;
  driverId: string;
  label?: string;
  onAssigned?: (driverId: string) => Promise<void> | void;
};

export function DriverAssignButton({
  bookingId,
  driverId,
  label = "Assign this driver",
  onAssigned,
}: DriverAssignButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleManualAssign = async () => {
    try {
      setLoading(true);

      const res = await fetch("/api/admin/manual-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId, driver_id: driverId }),
      });

      if (!res.ok) {
        console.error("MANUAL_ASSIGN_HTTP_ERROR", res.status);
        return;
      }

      const json = await res.json();

      if (!json?.success) {
        console.error("MANUAL_ASSIGN_FAILED", json?.error);
        return;
      }

      if (onAssigned) {
        await onAssigned(driverId);
      }
    } catch (err) {
      console.error("MANUAL_ASSIGN_UNEXPECTED_ERROR", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleManualAssign}
      disabled={loading}
      className="rounded bg-amber-600 px-3 py-1 text-xs font-medium text-white disabled:bg-gray-400 disabled:text-gray-100 disabled:cursor-not-allowed"
    >
      {loading ? "Assigning..." : label}
    </button>
  );
}
