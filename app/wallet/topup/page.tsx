"use client";
export const dynamic = "force-static";

import { useState } from "react";
export default function WalletTopupPage() {
  const [amount, setAmount] = useState<number|"">("");
  const onTopup = ()=>alert(`Top-up requested: ₱${amount || 0}`);
  return (
    <main className="p-6 max-w-md mx-auto">
      <h1 className="text-xl font-semibold mb-3">Wallet Top-up</h1>
      <label className="block text-sm mb-2">Amount (₱)</label>
      <input className="border rounded px-3 py-2 w-full mb-4" value={amount}
             onChange={e=>setAmount(Number(e.target.value)||"")} inputMode="numeric" placeholder="e.g. 100" />
      <button className="px-4 py-2 rounded bg-green-600 text-white disabled:opacity-60"
              disabled={amount==="" || (amount as number)<=0} onClick={onTopup}>Continue</button>
    </main>
  );
}
