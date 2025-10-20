// app/request/confirm-fare/page.tsx
"use client";
import { useSearchParams, useRouter } from "next/navigation";

export default function ConfirmFarePage() {
  const params = useSearchParams();
  const router = useRouter();
  const count = Number(params.get("count") ?? 1);
  const base = 30;
  const add = count > 1 ? (count - 1) * 20 : 0;
  const fee = 15;
  const total = base + add + fee;

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-3">Trip Summary</h1>
      <ul className="mb-4 text-sm">
        <li>• Base Fare (LLGU Matrix): ₱{base}</li>
        <li>• Additional Passengers (₱20 each): ₱{add}</li>
        <li>• Convenience Fee: ₱{fee}</li>
      </ul>
      <h2 className="text-lg font-bold mb-4">Total Fare: ₱{total}</h2>
      <p className="text-xs text-yellow-700 mb-4">
        ⚠️ Please confirm your booking. The total amount of ₱{total} is payable directly to the driver upon arrival.
      </p>
      <button
        onClick={() => router.push(`/request/success?total=${total}`)}
        className="px-4 py-2 bg-green-600 text-white rounded"
      >
        Confirm Booking →
      </button>
    </main>
  );
}
