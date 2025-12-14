"use client";

import { useState } from "react";

type AutoAssignButtonProps = {
  bookingId: string;
  onAssigned?: (driverId: string | null, status: string) => Promise<void> | void;
};

export function AutoAssignButton({ bookingId, onAssigned }: AutoAssignButtonProps) {
  const [loading, setLoading] = useState(false);

  const handleAutoAssign = async () => {
    try {
      setLoading(true);

      const res = await fetch("/api/admin/auto-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ booking_id: bookingId }),
      });

      if (!res.ok) {
        console.error("AUTO_ASSIGN_HTTP_ERROR", res.status);
        return;
      }

      const json = await res.json();

      if (!json?.success) {
        console.error("AUTO_ASSIGN_FAILED", json?.error);
        return;
      }

      const driverId = (json.chosen_driver_id as string) ?? null;
      const status = (json.booking?.status as string) ?? "in_progress";

      if (onAssigned) {
        await onAssigned(driverId, status);
      }
    } catch (err) {
      console.error("AUTO_ASSIGN_UNEXPECTED_ERROR", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleAutoAssign}
      disabled={loading}
      className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:bg-gray-400 disabled:text-gray-100 disabled:cursor-not-allowed"
    >
      {loading ? "Assigning..." : "Auto Assign"}
    </button>
  );
}
