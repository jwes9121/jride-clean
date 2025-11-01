"use client";
export const dynamic = "force-static";

import { useState } from "react";
import { useRouter } from "next/navigation";
export default function PassengerCountPage() {
  const [count, setCount] = useState(1);
  const router = useRouter();
  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">How many passengers will be riding?</h1>
      <p className="mb-4 text-sm">Please select the total number of passengers (including yourself).</p>
      <div className="space-y-2 mb-4">
        {[1,2,3,4].map(n => (
          <label key={n} className="flex items-center gap-2">
            <input type="radio" name="passengers" value={n} checked={count===n} onChange={()=>setCount(n)} />
            <span>{n} Passenger{n>1 ? "s" : ""}</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-yellow-700 mb-4">
        ⚠️ Tricycles can accommodate up to four (4) passengers only. Motorcycle rides are limited to one (1) passenger.
      </p>
      <button className="px-4 py-2 rounded bg-green-600 text-white" onClick={()=>router.push(`/request/confirm-fare?count=${count}`)}>
        Continue →
      </button>
    </main>
  );
}
