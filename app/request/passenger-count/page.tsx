"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PassengerCountPage() {
  const router = useRouter();
  const [count, setCount] = useState<number>(1);
  const options = [1, 2, 3, 4];

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-2">How many passengers will be riding?</h1>
      <p className="text-sm mb-4">
        Please select the total number of passengers (including yourself).
      </p>

      <div className="space-y-3">
        {options.map((opt) => (
          <label key={opt} className="flex items-center space-x-3 border rounded-lg p-3">
            <input
              type="radio"
              name="passengers"
              checked={count === opt}
              onChange={() => setCount(opt)}
              className="h-4 w-4"
            />
            <span className="text-sm">
              {opt} Passenger{opt > 1 && "s"}
            </span>
          </label>
        ))}
      </div>

      <p className="mt-4 text-xs text-yellow-700">
        ⚠️ Tricycles can accommodate up to four (4) passengers only.
        Motorcycle (single) rides are limited to one (1) passenger for safety and regulatory compliance.
      </p>

      <div className="mt-6 flex gap-3">
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 rounded border"
        >
          Cancel
        </button>
        <button
          onClick={() => router.push(`/request/confirm-fare?count=${count}`)}
          className="px-4 py-2 rounded bg-blue-600 text-white"
        >
          Continue →
        </button>
      </div>
    </main>
  );
}
