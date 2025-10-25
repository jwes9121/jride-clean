"use client";

import { useSearchParams } from "next/navigation";
import { platformDeduction } from "../../../lib/fare";

export default function DriverPostTripClient() {
  const params = useSearchParams();
  const totalParam = params.get("total") || "0";

  const total = Number(totalParam);
  const deduction = platformDeduction(total);
  const net = total - deduction;

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="font-semibold text-lg mb-2">Trip Summary</h1>
      <p className="text-sm text-gray-700">Total: {total}</p>
      <p className="text-sm text-gray-700">Platform deduction: {deduction}</p>
      <p className="text-sm text-gray-900 font-medium">Net: {net}</p>
      <p className="text-xs text-gray-500 mt-4">
        (stub) DriverPostTripClient is rendering.
      </p>
    </main>
  );
}
