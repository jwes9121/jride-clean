"use client";

import React from "react";

type RideShareConfirmationModalProps = {
  isOpen: boolean;
  onClose: () => void;
  /** handler the page provides: true = accept, false = decline */
  onConfirm: (accepted: boolean) => void;

  /** These used to be required; make them optional to avoid TS errors */
  driverName?: string;
  pickupLocation?: string;
  dropoffLocation?: string;
  fare?: number;

  /** the page also passes these; keep them optional */
  ride?: any;
  pendingPassenger?: any;
};

export default function RideShareConfirmationModal({
  isOpen,
  onClose,
  onConfirm,
  driverName,
  pickupLocation,
  dropoffLocation,
  fare,
  ride,
  pendingPassenger,
}: RideShareConfirmationModalProps) {
  if (!isOpen) return null;

  // friendly fallbacks so the UI still renders even if page doesn’t supply details
  const driver = driverName ?? ride?.driverName ?? ride?.driver?.name ?? "Driver";
  const pickup = pickupLocation ?? ride?.pickupLocation ?? ride?.pickup?.address ?? "Pickup location";
  const dropoff = dropoffLocation ?? ride?.dropoffLocation ?? ride?.dropoff?.address ?? "Dropoff location";
  const price =
    typeof fare === "number"
      ? fare
      : typeof ride?.fare === "number"
      ? ride.fare
      : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-lg">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Ride-share request</h2>
          <button
            aria-label="Close"
            className="rounded p-1 text-gray-500 hover:bg-gray-100"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="space-y-2 text-sm text-gray-700">
          {pendingPassenger?.name ? (
            <p>
              <strong>{pendingPassenger.name}</strong> wants to share this ride.
            </p>
          ) : (
            <p>A passenger wants to share this ride.</p>
          )}
          <ul className="list-disc pl-5 text-gray-600">
            <li>Driver: <span className="text-gray-800">{driver}</span></li>
            <li>Pickup: <span className="text-gray-800">{pickup}</span></li>
            <li>Dropoff: <span className="text-gray-800">{dropoff}</span></li>
            {price !== undefined ? (
              <li>Fare: <span className="text-gray-800">₱{price}</span></li>
            ) : null}
          </ul>
          {ride?.id ? (
            <p className="text-xs text-gray-500">Ride ID: {String(ride.id)}</p>
          ) : null}
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
