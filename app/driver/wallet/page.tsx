"use client";

function friendlySbError(err: any): string {
  const msg = (err?.message ?? "").toString();
  const lc = msg.toLowerCase();

  if (lc.includes("insufficient wallet")) return "Insufficient wallet balance.";
  if (lc.includes("below minimum") || lc.includes("min_wallet")) return "Wallet is below minimum required.";
  if (lc.includes("not found")) return "Record not found.";
  return msg || "Request failed.";
}

import { useEffect, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function DriverWalletPage() {
  const [driverId, setDriverId] = useState("");
  const [wallet, setWallet] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [activity, setActivity] = useState<any[]>([]);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadWallet() {
    if (!driverId) return;

    const { data: walletData } = await supabase
      .from("driver_wallet_status_view")
      .select("*")
      .eq("driver_id", driverId)
      .single();

    const { data: payoutHistory } = await supabase
      .from("driver_payout_requests")
      .select("*")
      .eq("driver_id", driverId)
      .order("requested_at", { ascending: false })
      .limit(10);

    const { data: walletActivity } = await supabase
      .from("driver_wallet_transactions")
      .select("*")
      .eq("driver_id", driverId)
      .order("created_at", { ascending: false })
      .limit(25);

    setWallet(walletData);
    setHistory(payoutHistory || []);
    setActivity(walletActivity || []);
  }

  async function requestPayout() {
    setError(null);
    setLoading(true);

    try {
      const amt = Number(amount);
      if (!amt || amt <= 0) throw new Error("Invalid amount");

      const { error } = await supabase.rpc("driver_request_payout", {
        p_driver_id: driverId,
        p_amount: amt,
      });

      if (error) throw error;

      setAmount("");
      await loadWallet();
    } catch (e: any) {
      setError(e.message ?? "Failed to request payout");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadWallet();
    const i = setInterval(loadWallet, 10000);
    return () => clearInterval(i);
  }, [driverId]);

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-6">
      <h1 className="text-2xl font-bold">JRide • Driver Wallet</h1>

      <div className="border rounded p-4 space-y-2">
        <label className="text-sm font-medium">Driver UUID</label>
        <input
          className="w-full border rounded px-3 py-2"
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          placeholder="Paste driver UUID"
        />
      </div>

      {wallet && (
        <>
          <div className="border rounded p-4">
            <div className="text-lg font-semibold">
              ₱{wallet.wallet_balance?.toFixed(2)}
            </div>
            <div className="text-sm text-gray-500">
              Minimum required: ₱{wallet.min_wallet_required?.toFixed(2)}
            </div>
          </div>

          <div className="border rounded p-4 space-y-3">
            <h2 className="font-semibold">Request payout</h2>
            <input
              className="w-full border rounded px-3 py-2"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Amount (₱)"
            />
            <button
              onClick={requestPayout}
              disabled={loading}
              className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
            >
              Request payout
            </button>
            {error && <div className="text-red-600 text-sm">{error}</div>}
          </div>

          <div className="border rounded p-4">
            <h2 className="font-semibold mb-2">Payout history</h2>
            {history.map((p) => (
              <div key={p.id} className="text-sm border-b py-1">
                ₱{p.amount} — {p.status}
              </div>
            ))}
          </div>

          <div className="border rounded p-4">
            <h2 className="font-semibold mb-2">Wallet activity</h2>
            {activity.map((a) => (
              <div key={a.id} className="text-sm border-b py-1">
                {a.amount > 0 ? "+" : ""}
                {a.amount} — {a.reason}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
