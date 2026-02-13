"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type VendorSummary = {
  vendor_id: string;
  email: string;
  display_name: string | null;
  total_billings: number;
  total_platform_fees: number;
  total_vendor_earnings: number;
  wallet_balance: number;
  last_payout_at: string | null;
  last_payout_amount: number | null;
};

export default function AdminVendorPayoutsPage() {
  const [vendors, setVendors] = useState<VendorSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [settlingVendorId, setSettlingVendorId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/takeout/admin/vendor-payouts");
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Failed to load admin vendor payouts");
        }

        const list = (json.vendors ?? []) as any[];
        const mapped: VendorSummary[] = list.map((v) => ({
          vendor_id: v.vendor_id,
          email: v.email,
          display_name: v.display_name ?? null,
          total_billings: Number(v.total_billings ?? 0),
          total_platform_fees: Number(v.total_platform_fees ?? 0),
          total_vendor_earnings: Number(v.total_vendor_earnings ?? 0),
          wallet_balance: Number(v.wallet_balance ?? 0),
          last_payout_at: v.last_payout_at ?? null,
          last_payout_amount:
            v.last_payout_amount !== null && v.last_payout_amount !== undefined
              ? Number(v.last_payout_amount)
              : null,
        }));

        setVendors(mapped);
      } catch (err: any) {
        console.error("Failed to load admin vendor payouts:", err);
        setError(err?.message || "Failed to load admin data.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const totals = useMemo(() => {
    return vendors.reduce(
      (acc, v) => {
        acc.totalBillings += v.total_billings;
        acc.totalPlatformFees += v.total_platform_fees;
        acc.totalVendorEarnings += v.total_vendor_earnings;
        acc.totalWalletOutstanding += v.wallet_balance;
        return acc;
      },
      {
        totalBillings: 0,
        totalPlatformFees: 0,
        totalVendorEarnings: 0,
        totalWalletOutstanding: 0,
      }
    );
  }, [vendors]);

  async function handleSettleVendor(vendorId: string, amount: number) {
    if (amount <= 0) return;

    const confirmed = window.confirm(
      `Settle wallet for this vendor?\n\nPayout amount: ₱${amount.toFixed(
        2
      )}\n\nThis will create a payout entry and reset their wallet to ₱0.00.`
    );
    if (!confirmed) return;

    try {
      setSettlingVendorId(vendorId);
      setError(null);

      const res = await fetch("/api/takeout/admin/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(json.error || "Failed to settle wallet");
      }

      // Reload to reflect new wallet + last payout
      window.location.reload();
    } catch (err: any) {
      console.error("Failed to settle vendor wallet:", err);
      setError(err?.message || "Failed to settle vendor wallet.");
      setSettlingVendorId(null);
    }
  }

  if (loading) {
    return <div className="p-6">Loading admin vendor payouts...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">
          Takeout – Admin Vendor Payouts
        </h1>
        <span className="text-sm text-gray-500">
          Vendors: {vendors.length}
        </span>
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-md">
          {error}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Total Billings (All Vendors)
          </h2>
          <div className="text-xl font-bold">
            ₱{totals.totalBillings.toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Platform Fees (10%)
          </h2>
          <div className="text-xl font-bold">
            ₱{totals.totalPlatformFees.toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Vendor Earnings (Lifetime)
          </h2>
          <div className="text-xl font-bold">
            ₱{totals.totalVendorEarnings.toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Outstanding Wallet Balances
          </h2>
          <div className="text-xl font-bold">
            ₱{totals.totalWalletOutstanding.toFixed(2)}
          </div>
        </div>
      </div>

      {/* Vendor table */}
      <div>
        <h2 className="text-lg font-semibold mb-2">Vendors</h2>
        {vendors.length === 0 ? (
          <div className="text-sm text-gray-500">
            No vendors found yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Vendor</th>
                <th className="p-2">Email</th>
                <th className="p-2 text-right">Total Billings</th>
                <th className="p-2 text-right">Platform Fees</th>
                <th className="p-2 text-right">Vendor Earnings</th>
                <th className="p-2 text-right">Wallet Balance</th>
                <th className="p-2">Last Payout</th>
                <th className="p-2 text-right">Last Payout Amount</th>
                <th className="p-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {vendors.map((v) => {
                const hasOutstanding = v.wallet_balance > 0.009;
                const lastPayoutAmount =
                  v.last_payout_amount !== null &&
                  v.last_payout_amount !== undefined
                    ? Math.abs(v.last_payout_amount)
                    : null;

                const isSettling = settlingVendorId === v.vendor_id;

                return (
                  <tr
                    key={v.vendor_id}
                    className="border-b last:border-b-0 hover:bg-gray-50"
                  >
                    <td className="p-2">
                      <button
                        className="font-medium text-blue-600 hover:underline text-left"
                        onClick={() =>
                          router.push(
                            `/takeout/admin/payouts/${v.vendor_id}`
                          )
                        }
                      >
                        {v.display_name || "Unnamed Vendor"}
                      </button>
                      <div className="text-xs text-gray-500">
                        {v.vendor_id}
                      </div>
                    </td>
                    <td className="p-2">{v.email}</td>
                    <td className="p-2 text-right">
                      ₱{v.total_billings.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      ₱{v.total_platform_fees.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      ₱{v.total_vendor_earnings.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      <span
                        className={
                          hasOutstanding
                            ? "font-semibold text-amber-700"
                            : "text-gray-700"
                        }
                      >
                        ₱{v.wallet_balance.toFixed(2)}
                      </span>
                    </td>
                    <td className="p-2">
                      {v.last_payout_at ? (
                        <span className="text-xs text-gray-600">
                          {v.last_payout_at}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">
                          No payout yet
                        </span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {lastPayoutAmount !== null ? (
                        <>₱{lastPayoutAmount.toFixed(2)}</>
                      ) : (
                        <span className="text-xs text-gray-400">-</span>
                      )}
                    </td>
                    <td className="p-2 text-right">
                      {hasOutstanding ? (
                        <button
                          onClick={() =>
                            handleSettleVendor(v.vendor_id, v.wallet_balance)
                          }
                          disabled={isSettling}
                          className={`px-3 py-1 rounded-md text-xs font-medium border ${
                            isSettling
                              ? "bg-gray-200 text-gray-500 cursor-not-allowed"
                              : "bg-green-600 text-white hover:bg-green-700"
                          }`}
                        >
                          {isSettling ? "Settling..." : "Settle Wallet"}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-400">No balance</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
