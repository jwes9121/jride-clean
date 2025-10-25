"use client";

import React from "react";

function computeTriplycFareLocal(
  origin: string,
  destination: string,
  passengers: number
): number {
  // Basic placeholder fare logic:
  // ₱20 base + ₱10 per extra passenger beyond 1
  const baseFare = 20;
  const extras = passengers > 1 ? (passengers - 1) * 10 : 0;

  // You can later enhance with distance/origin/destination pricing rules.
  return baseFare + extras;
}

export default function ConfirmFareClient() {
  // Get query params on the client side
  const search =
    typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);

  const origin: string = params.get("origin") || "";
  const destination: string = params.get("destination") || "";
  const passengers: number = Number(params.get("count") || "1");

  // use ONLY our local helper
  const fare: number = computeTriplycFareLocal(
    origin,
    destination,
    passengers
  );

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Confirm Fare</h1>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-600">Pickup:</span>
          <span className="font-medium text-gray-900">
            {origin || "—"}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">Dropoff:</span>
          <span className="font-medium text-gray-900">
            {destination || "—"}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-600">Passengers:</span>
          <span className="font-medium text-gray-900">
            {passengers}
          </span>
        </div>

        <div className="flex justify-between text-lg pt-4 border-t mt-4">
          <span className="text-gray-800 font-semibold">
            Estimated Fare:
          </span>
          <span className="text-gray-900 font-bold">
            ₱{fare}
          </span>
        </div>
      </div>

      <button
        className="mt-6 w-full bg-black text-white text-sm font-medium py-2 rounded-lg hover:bg-gray-800 transition-colors"
        onClick={() => {
          console.log("Confirm ride", {
            origin,
            destination,
            passengers,
            fare,
          });
        }}
      >
        Confirm & Request Driver
      </button>
    </main>
  );
}
