"use client";

import { useState } from "react";

type PassengerFareResponse = "accepted" | "rejected" | null;

type Booking = {
  booking_code: string;
  passenger_name?: string | null;
  from_label?: string | null;
  to_label?: string | null;
  proposed_fare?: number | null;
  passenger_fare_response?: PassengerFareResponse;
  verified_fare?: number | null;
  verified_by?: string | null;
  verified_reason?: string | null;
};

type FareDetailsButtonProps = {
  booking: Booking;
  onUpdated?: () => void;
};

export function FareDetailsButton({ booking, onUpdated }: FareDetailsButtonProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [overrideFare, setOverrideFare] = useState<string>(
    booking.verified_fare?.toString() ??
      booking.proposed_fare?.toString() ??
      ""
  );
  const [adminId, setAdminId] = useState<string>("admin-jwes");
  const [reason, setReason] = useState<string>(
    booking.verified_reason ?? "Adjusted per tricycle fare matrix"
  );

  function formatFare(value?: number | null) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "—";
    }
    return `₱${value.toFixed(2)}`;
  }

  function formatResponse(resp?: PassengerFareResponse) {
    if (!resp) return "No response yet";
    if (resp === "accepted") return "Accepted by passenger";
    if (resp === "rejected") return "Rejected by passenger";
    return resp;
  }

  async function handleOverrideSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Number(overrideFare);

    if (!overrideFare || Number.isNaN(parsed) || parsed <= 0) {
      alert("Please enter a valid fare amount.");
      return;
    }

    try {
      setSaving(true);

      const res = await fetch("/api/admin/fare-override", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bookingCode: booking.booking_code,
          verifiedFare: parsed,
          adminId: adminId || "admin",
          reason: reason || null,
        }),
      });

      const json = await res.json();

      if (!res.ok || !json.ok) {
        console.error("Fare override failed", json);
        alert(
          "Failed to override fare: " +
            (json?.error ?? res.statusText ?? "UNKNOWN_ERROR")
        );
        return;
      }

      alert("Fare verified/overridden successfully.");
      setOpen(false);
      if (onUpdated) onUpdated();
    } catch (err) {
      console.error(err);
      alert("Network error while overriding fare.");
    } finally {
      setSaving(false);
    }
  }

  function getStatusBadgeColor(resp?: PassengerFareResponse) {
    if (resp === "accepted") {
      return "bg-emerald-600/20 text-emerald-300 border-emerald-500/40";
    }
    if (resp === "rejected") {
      return "bg-red-600/20 text-red-300 border-red-500/40";
    }
    return "bg-zinc-700/50 text-zinc-300 border-zinc-500/40";
  }

  return (
    <>
      {/* Button shown in the table cell */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-medium ${
          booking.proposed_fare != null
            ? "border-amber-400/60 text-amber-200 bg-amber-900/30"
            : "border-zinc-500/40 text-zinc-300 bg-zinc-800/60"
        } hover:bg-zinc-700/80 transition`}
      >
        <span>Fare</span>
        {booking.proposed_fare != null && (
          <span className="font-semibold">
            {formatFare(booking.proposed_fare)}
          </span>
        )}
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-900 px-5 py-4 shadow-xl">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-zinc-50">
                  Fare Details – {booking.booking_code}
                </h2>
                <p className="mt-1 text-[11px] text-zinc-400">
                  {booking.from_label || "Pickup"} →{" "}
                  {booking.to_label || "Destination"}
                </p>
                {booking.passenger_name && (
                  <p className="mt-0.5 text-[11px] text-zinc-500">
                    Passenger: {booking.passenger_name}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
              >
                ✕
              </button>
            </div>

            {/* Current fare info */}
            <div className="mb-3 space-y-1 text-[12px]">
              <div className="flex justify-between">
                <span className="text-zinc-400">Proposed fare:</span>
                <span className="font-medium text-zinc-100">
                  {formatFare(booking.proposed_fare)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-zinc-400">Passenger response:</span>
                <span
                  className={
                    "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium " +
                    getStatusBadgeColor(booking.passenger_fare_response ?? null)
                  }
                >
                  {formatResponse(booking.passenger_fare_response ?? null)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-zinc-400">Verified fare:</span>
                <span className="font-medium text-emerald-300">
                  {formatFare(booking.verified_fare)}
                </span>
              </div>
              {booking.verified_by && (
                <div className="flex justify-between">
                  <span className="text-zinc-400">Verified by:</span>
                  <span className="text-[11px] text-zinc-300">
                    {booking.verified_by}
                  </span>
                </div>
              )}
              {booking.verified_reason && (
                <p className="mt-1 text-[11px] text-zinc-400">
                  Reason: {booking.verified_reason}
                </p>
              )}
            </div>

            <hr className="my-3 border-zinc-700/80" />

            {/* Override form */}
            <form onSubmit={handleOverrideSubmit} className="space-y-3">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-zinc-300">
                  Override / verify fare (₱)
                </label>
                <input
                  type="number"
                  step="1"
                  min="1"
                  value={overrideFare}
                  onChange={(e) => setOverrideFare(e.target.value)}
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
                  placeholder="e.g. 70"
                />
              </div>

              <div className="flex gap-2">
                <div className="w-1/2">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-300">
                    Admin ID / name
                  </label>
                  <input
                    type="text"
                    value={adminId}
                    onChange={(e) => setAdminId(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="admin-jwes"
                  />
                </div>
                <div className="w-1/2">
                  <label className="mb-1 block text-[11px] font-medium text-zinc-300">
                    Reason (optional)
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-[12px] text-zinc-100 focus:border-emerald-500 focus:outline-none"
                    placeholder="Adjusted per matrix"
                  />
                </div>
              </div>

              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-lg border border-zinc-600 px-3 py-1.5 text-[11px] text-zinc-300 hover:bg-zinc-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                >
                  {saving ? "Saving..." : "Save & Verify"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
