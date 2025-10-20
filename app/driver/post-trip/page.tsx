// app/driver/post-trip/page.tsx
"use client";
import { useSearchParams } from "next/navigation";

export default function PostTripPage() {
  const params = useSearchParams();
  const total = Number(params.get("total") ?? 85);
  const deduction = total >= 50 ? 20 : 0;
  const net = total - deduction;

  return (
    <main className="p-6">
      <h1 className="text-xl font-semibold mb-2">Trip Completed!</h1>
      <ul className="text-sm mb-4">
        <li>• Total Fare Collected: ₱{total}</li>
        <li>• Platform Deduction: ₱{deduction} (for trips ₱50 and above)</li>
        <li>— ₱15 convenience/service fee</li>
        <li>— ₱5 system/LGU partnership share</li>
      </ul>
      <h2 className="font-bold text-lg">
        ✅ Net Amount Credited to Your Wallet: ₱{net}
      </h2>
    </main>
  );
}
