// app/request/passenger-count/page.tsx
"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PassengerCountPage() {
  const router = useRouter();
  const [count, setCount] = useState<number>(1);

  const options = [1, 2, 3, 4];

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-2">How many passengers will be riding?</h1>
      <p className="text-sm mb-4">Please select the total number of passengers (including yourself).</p>
      <div className="space-y-2">
        {options.map((opt) => (
          <label key={opt} className="flex items-center space-x-2">
            <input
              type="radio"
              name="passengers"
              checked={count === opt}
              onChange={() => setCount(opt)}
            />
            <span>{opt} Passenger{opt > 1 && "s"}</span>
          </label>
        ))}
      </div>
      <p className="mt-4 text-xs text-yellow-700">
        âš ï¸ Tricycles can accommodate up to four (4) passengers only.
        Motorcycle (single) rides are limited to one (1) passenger.
      </p>
      <button
        onClick={() => router.push(`/request/confirm-fare?count=${count}`)}
        className="mt-6 px-4 py-2 bg-blue-600 text-white rounded"
      >
        Continue â†’
      </button>
    </main>
  );
}


