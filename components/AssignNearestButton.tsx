"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type AssignResult =
  | {
      ok: true;
      booking_id?: string;
      booking_code?: string;
      assigned_driver_id?: string;
    }
  | {
      ok: false;
      reason?: string;
      booking_id?: string;
      booking_code?: string;
    };

type AssignNearestButtonProps = {
  // Optional callback for parent pages (e.g. to reload tables)
  onAfterAction?: () => void;
};

export function AssignNearestButton({ onAfterAction }: AssignNearestButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  const handleClick = async () => {
    if (loading) return;

    setLoading(true);
    setStatusText(null);
    setErrorText(null);

    try {
      const res = await fetch("/api/rides/assign-nearest/latest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        const msg =
          data?.message ||
          data?.error ||
          `Request failed with status ${res.status}`;

        setErrorText(`Assign failed: ${msg}`);
        if (onAfterAction) onAfterAction();
        return;
      }

      const result: AssignResult = data?.result ?? data;

      if (!result || result.ok === false) {
        const reason =
          result?.reason ??
          "No pending booking or no available driver at the moment.";
        setStatusText(`No assignment: ${reason}`);
        if (onAfterAction) onAfterAction();
        return;
      }

      const booking = result.booking_code ?? result.booking_id ?? "booking";
      const driver = result.assigned_driver_id ?? "driver";

      setStatusText(`Assigned ${driver} to ${booking}.`);

      // Refresh server components so your tables update
      router.refresh();
      if (onAfterAction) onAfterAction();
    } catch (err: any) {
      setErrorText(
        `Server error while assigning driver: ${
          err?.message ?? "Unknown error"
        }`
      );
      if (onAfterAction) onAfterAction();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1 items-start">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className="px-4 py-2 rounded-md border text-sm font-medium
                   disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {loading ? "Assigning..." : "Assign Nearest Driver"}
      </button>

      {statusText && (
        <p className="text-xs text-gray-600">
          {statusText}
        </p>
      )}

      {errorText && (
        <p className="text-xs text-red-600">
          {errorText}
        </p>
      )}
    </div>
  );
}
