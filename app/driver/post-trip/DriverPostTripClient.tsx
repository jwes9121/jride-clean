"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { platformDeduction } from "../../../lib/fare";

export default function DriverPostTripClient() {
  const params = useSearchParams();
  const router = useRouter();

  // total fare passed in the URL, e.g. /driver/post-trip?total=85
  const totalParam = params.get("total") || "0";
  const total = Number(totalParam);

  // breakdown
  const breakdown = platformDeduction(total);
  // breakdown = {
  //   gross: number,
  //   platformCut: number,
  //   driverTakeHome: number,
  //   rate: number
  // }

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-4">Trip Complete</h1>

      <section className="text-sm text-gray-700 space-y-2">
        <div className="flex justify-between">
          <span className="text-gray-500">Total fare collected:</span>
          <span className="font-medium text-gray-900">
            ₱{breakdown.gross}
          </span>
        </div>

        <div className="flex justify-between">
          <span className="text-gray-500">
            Platform fee ({Math.round(breakdown.rate * 100)}%):
          </span>
          <span className="font-medium text-gray-900">
            ₱{breakdown.platformCut}
          </span>
        </div>

        <div className="flex justify-between border-t pt-3 mt-3">
          <span className="text-gray-800 font-semibold">You keep:</span>
          <span className="text-gray-900 font-bold">
            ₱{breakdown.driverTakeHome}
          </span>
        </div>
      </section>

      <button
        className="mt-6 border rounded px-3 py-2 text-sm"
        onClick={() => router.push("/driver")}
      >
        Done
      </button>
    </main>
  );
}
