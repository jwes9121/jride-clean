"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { computeTriplycFare } from "../../../lib/fare";

export default function ConfirmFareClient() {
  const params = useSearchParams();
  const router = useRouter();

  const origin = params.get("origin") || "";
  const destination = params.get("destination") || "";
  const passengers = Number(params.get("count") || "1");

  const fare = computeTriplycFare(origin, destination, passengers);

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="font-semibold text-lg mb-2">Confirm Fare</h1>

      <div className="text-sm text-gray-700 mb-2">
        <div>Origin: {origin}</div>
        <div>Destination: {destination}</div>
        <div>Passengers: {passengers}</div>
      </div>

      <div className="text-sm text-gray-900 font-medium">
        Total: ₱{fare.total} {fare.currency}
      </div>
      <div className="text-xs text-gray-500">
        Per-head est: ₱{fare.perHead} {fare.currency}
      </div>

      <p className="text-xs text-gray-500 mt-4">
        (stub) ConfirmFareClient is rendering.
      </p>

      <button
        className="mt-4 border rounded px-3 py-2 text-sm"
        onClick={() => router.push("/")}
      >
        Done
      </button>
    </main>
  );
}
