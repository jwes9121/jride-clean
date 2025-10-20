"use client";
import { useSearchParams } from "next/navigation";
import { platformDeduction } from "@/lib/fare";

export default function DriverPostTripClient() {
  const params = useSearchParams();
  const total = Number(params.get("total") ?? 85);
  const deduction = platformDeduction(total);
  const net = total - deduction;

  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-2">Trip Completed!</h1>
      <ul className="text-sm mb-4">
        <li>• Total Fare Collected: ₱{total}</li>
        <li>• Platform Deduction: ₱{deduction} {total >= 50 ? "(for trips ₱50 and above)" : "(none for trips under ₱50)"} </li>
        <li>— ₱15 convenience/service fee</li>
        <li>— ₱5 system/LGU partnership share</li>
      </ul>
      <h2 className="font-bold text-lg">✅ Net Amount Credited to Your Wallet: ₱{net}</h2>
    </main>
  );
}


