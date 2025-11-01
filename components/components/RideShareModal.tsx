"use client";

import React from "react";

type RideShareModalProps = {
  /** The ride weâ€™re deciding on (optional, for display only) */
  ride?: { id?: string | number; [k: string]: any } | null;
  /** Pending passenger info (optional, for display only) */
  pendingPassenger?: { name?: string; [k: string]: any } | null;
  /** Called with true (accept) or false (decline) */
  onConfirm: (accepted: boolean) => void;
  /** Optional close handler */
  onClose?: () => void;
};

export default function RideShareModal({
  ride,
  pendingPassenger,
  onConfirm,
  onClose,
}: RideShareModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ride-share request</h2>
          {onClose ? (
            <button
              aria-label="Close"
              className="rounded p-1 text-gray-500 hover:bg-gray-100"
              onClick={onClose}
            >
              âœ•
            </button>
          ) : null}
        </div>

        <div className="space-y-2 text-sm text-gray-700">
          {pendingPassenger?.name ? (
            <p>
              <strong>{pendingPassenger.name}</strong> wants to share this ride.
            </p>
          ) : (
            <p>A passenger wants to share this ride.</p>
          )}
          {ride?.id ? (
            <p className="text-gray-500">Ride ID: {String(ride.id)}</p>
          ) : null}
          <p>Do you want to accept?</p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            className="rounded border px-3 py-2 text-sm hover:bg-gray-50"
            onClick={() => onConfirm(false)}
          >
            Decline
          </button>
          <button
            className="rounded bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700"
            onClick={() => onConfirm(true)}
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}



