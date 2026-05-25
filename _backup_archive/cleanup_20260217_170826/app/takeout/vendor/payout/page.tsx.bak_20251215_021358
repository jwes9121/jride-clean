"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Summary = {
  total_billings: number;
  total_platform_fees: number;
  total_vendor_earnings: number;
  wallet_balance: number;
  last_payout_at: string | null;
  last_payout_amount: number | null;
};

type MonthlyRow = {
  vendor_id: string;
  month_start: string;
  total_billings: number;
  total_platform_fees: number;
  total_vendor_earnings: number;
  total_payouts: number;
};

type OrderRow = {
  id: string;
  booking_code: string;
  service_type: string;
  vendor_status: string | null;
  customer_status: string | null;
  total_service_fare: number;
  platform_fee_10pct: number;
  vendor_earnings_90pct: number;
  created_at: string | null;
  updated_at: string | null;
};

type WalletTx = {
  booking_code: string | null;
  amount: number;
  kind: string;
  note: string | null;
  created_at: string;
};

type PayoutRequest = {
  id: string;
  vendor_id: string;
  requested_amount: number;
  status: string;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

function normalizeMonthKey(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export default function VendorPayoutPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [monthly, setMonthly] = useState<MonthlyRow[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [walletTxs, setWalletTxs] = useState<WalletTx[]>([]);
  const [payoutRequests, setPayoutRequests] = useState<PayoutRequest[]>([]);
  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  const [selectedMonthKey, setSelectedMonthKey] = useState<string>("all");

  useEffect(() => {
    async function load() {
      try {
        setError(null);
        setLoading(true);

        const res = await fetch("/api/takeout/vendor/payout/details");
        const json = await res.json();

        if (!res.ok) {
          throw new Error(json.error || "Failed to load vendor payout details");
        }

        if (json.summary) {
          setSummary({
            total_billings: Number(json.summary.total_billings ?? 0),
            total_platform_fees: Number(
              json.summary.total_platform_fees ?? 0
            ),
            total_vendor_earnings: Number(
              json.summary.total_vendor_earnings ?? 0
            ),
            wallet_balance: Number(json.summary.wallet_balance ?? 0),
            last_payout_at: json.summary.last_payout_at ?? null,
            last_payout_amount:
              json.summary.last_payout_amount !== null
                ? Number(json.summary.last_payout_amount)
                : null,
          });
        } else {
          setSummary(null);
        }

        const mRows: MonthlyRow[] = (json.monthly ?? []).map((m: any) => ({
          vendor_id: m.vendor_id,
          month_start: m.month_start,
          total_billings: Number(m.total_billings ?? 0),
          total_platform_fees: Number(m.total_platform_fees ?? 0),
          total_vendor_earnings: Number(m.total_vendor_earnings ?? 0),
          total_payouts: Number(m.total_payouts ?? 0),
        }));
        setMonthly(mRows);

        const oRows: OrderRow[] = (json.orders ?? []).map((o: any) => ({
          id: o.id,
          booking_code: o.booking_code,
          service_type: o.service_type,
          vendor_status: o.vendor_status ?? null,
          customer_status: o.customer_status ?? null,
          total_service_fare: Number(o.total_service_fare ?? 0),
          platform_fee_10pct: Number(o.platform_fee_10pct ?? 0),
          vendor_earnings_90pct: Number(o.vendor_earnings_90pct ?? 0),
          created_at: o.created_at ?? null,
          updated_at: o.updated_at ?? null,
        }));
        setOrders(oRows);

        const wRows: WalletTx[] = (json.walletTransactions ?? []).map(
          (t: any) => ({
            booking_code: t.booking_code ?? null,
            amount: Number(t.amount ?? 0),
            kind: String(t.kind ?? ""),
            note: t.note ?? null,
            created_at: t.created_at,
          })
        );
        setWalletTxs(wRows);

        const prRows: PayoutRequest[] = (json.payoutRequests ?? []).map(
          (r: any) => ({
            id: r.id,
            vendor_id: r.vendor_id,
            requested_amount: Number(r.requested_amount ?? 0),
            status: r.status,
            note: r.note ?? null,
            created_at: r.created_at,
            reviewed_at: r.reviewed_at ?? null,
            reviewed_by: r.reviewed_by ?? null,
          })
        );
        setPayoutRequests(prRows);

        setHasPendingRequest(Boolean(json.hasPendingRequest));
      } catch (err: any) {
        console.error("Failed to load vendor payout details:", err);
        setError(err?.message || "Failed to load vendor payout details.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const monthOptions = useMemo(() => {
    const opts: { key: string; label: string }[] = [];
    monthly.forEach((m) => {
      const key = normalizeMonthKey(m.month_start);
      if (!key) return;
      if (!opts.find((o) => o.key === key)) {
        opts.push({ key, label: key });
      }
    });
    opts.sort((a, b) => (a.key < b.key ? 1 : -1));
    return opts;
  }, [monthly]);

  const filteredOrders = useMemo(() => {
    if (selectedMonthKey === "all") return orders;
    return orders.filter((o) => {
      const key = normalizeMonthKey(o.created_at ?? undefined);
      return key === selectedMonthKey;
    });
  }, [orders, selectedMonthKey]);

  const filteredWalletTxs = useMemo(() => {
    if (selectedMonthKey === "all") return walletTxs;
    return walletTxs.filter((t) => {
      const key = normalizeMonthKey(t.created_at);
      return key === selectedMonthKey;
    });
  }, [walletTxs, selectedMonthKey]);

  const walletBalance = summary?.wallet_balance ?? 0;
  const noBalance = walletBalance <= 0;

  const canRequestPayout = !noBalance && !hasPendingRequest;

  let requestButtonLabel = "Request Payout";
  if (noBalance) {
    requestButtonLabel = "No Wallet Balance";
  } else if (hasPendingRequest) {
    requestButtonLabel = "Payout Request Pending";
  }

  async function handleRequestPayout() {
    if (!canRequestPayout || requesting) return;

    const confirmed = window.confirm(
      `Request payout for your current wallet balance?\n\nAmount: ₱${walletBalance.toFixed(
        2
      )}\n\nThis sends a payout request to JRide admin for approval.`
    );
    if (!confirmed) return;

    try {
      setRequesting(true);
      setError(null);

      const res = await fetch("/api/takeout/vendor/payout/request", {
        method: "POST",
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Failed to create payout request.");
      }

      alert("Payout request submitted. Please wait for admin approval.");

      // Reload the page data to reflect the new pending request & wallet summary
      router.refresh();
      const reload = await fetch("/api/takeout/vendor/payout/details");
      const reloadJson = await reload.json();
      if (reload.ok) {
        if (reloadJson.summary) {
          setSummary({
            total_billings: Number(reloadJson.summary.total_billings ?? 0),
            total_platform_fees: Number(
              reloadJson.summary.total_platform_fees ?? 0
            ),
            total_vendor_earnings: Number(
              reloadJson.summary.total_vendor_earnings ?? 0
            ),
            wallet_balance: Number(reloadJson.summary.wallet_balance ?? 0),
            last_payout_at: reloadJson.summary.last_payout_at ?? null,
            last_payout_amount:
              reloadJson.summary.last_payout_amount !== null
                ? Number(reloadJson.summary.last_payout_amount)
                : null,
          });
        }

        const prRows: PayoutRequest[] = (reloadJson.payoutRequests ?? []).map(
          (r: any) => ({
            id: r.id,
            vendor_id: r.vendor_id,
            requested_amount: Number(r.requested_amount ?? 0),
            status: r.status,
            note: r.note ?? null,
            created_at: r.created_at,
            reviewed_at: r.reviewed_at ?? null,
            reviewed_by: r.reviewed_by ?? null,
          })
        );
        setPayoutRequests(prRows);
        setHasPendingRequest(Boolean(reloadJson.hasPendingRequest));
      }
    } catch (err: any) {
      console.error("Failed to create payout request:", err);
      setError(err?.message || "Failed to create payout request.");
    } finally {
      setRequesting(false);
    }
  }

  function handleMonthChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setSelectedMonthKey(e.target.value);
  }

  if (loading) {
    return <div className="p-6">Loading vendor payout summary...</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Vendor Payout Summary</h1>
          <div className="text-sm text-gray-600 mt-1">
            JRide Takeout – Wallet & Earnings
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          {monthOptions.length > 0 && (
            <div className="text-sm">
              <label className="mr-2 text-gray-600">Filter month:</label>
              <select
                value={selectedMonthKey}
                onChange={handleMonthChange}
                className="border rounded-md px-2 py-1 text-sm"
              >
                <option value="all">All months</option>
                {monthOptions.map((m) => (
                  <option key={m.key} value={m.key}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={handleRequestPayout}
            disabled={!canRequestPayout || requesting}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              canRequestPayout
                ? "bg-green-600 text-white hover:bg-green-700"
                : "bg-gray-300 text-gray-600 cursor-not-allowed"
            }`}
          >
            {requesting ? "Submitting..." : requestButtonLabel}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Total Billings (Takeout)
          </h2>
          <div className="text-xl font-bold">
            ₱{(summary?.total_billings ?? 0).toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Platform Fees (10%)
          </h2>
          <div className="text-xl font-bold">
            ₱{(summary?.total_platform_fees ?? 0).toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Vendor Earnings (Lifetime)
          </h2>
          <div className="text-xl font-bold">
            ₱{(summary?.total_vendor_earnings ?? 0).toFixed(2)}
          </div>
        </div>

        <div className="p-4 rounded-lg bg-white shadow">
          <h2 className="text-xs text-gray-500 uppercase">
            Wallet Balance (Current)
          </h2>
          <div className="text-xl font-bold">
            ₱{(summary?.wallet_balance ?? 0).toFixed(2)}
          </div>
          {summary?.last_payout_at && (
            <div className="text-xs text-gray-500 mt-1">
              Last payout at {summary.last_payout_at}
            </div>
          )}
          {summary?.last_payout_amount !== null && (
            <div className="text-xs text-gray-500">
              Last payout amount ₱{summary.last_payout_amount?.toFixed(2)}
            </div>
          )}
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">
          Monthly Earnings & Payouts
        </h2>
        {monthly.length === 0 ? (
          <div className="text-sm text-gray-500">No monthly data yet.</div>
        ) : (
          <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Month</th>
                <th className="p-2 text-right">Total Billings</th>
                <th className="p-2 text-right">Platform Fees</th>
                <th className="p-2 text-right">Vendor Earnings</th>
                <th className="p-2 text-right">Payouts</th>
                <th className="p-2 text-right">Net (Earnings - Payouts)</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const net = m.total_vendor_earnings - m.total_payouts;
                return (
                  <tr key={m.month_start} className="border-b last:border-b-0">
                    <td className="p-2">{m.month_start}</td>
                    <td className="p-2 text-right">
                      ₱{m.total_billings.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      ₱{m.total_platform_fees.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      ₱{m.total_vendor_earnings.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">
                      ₱{m.total_payouts.toFixed(2)}
                    </td>
                    <td className="p-2 text-right">₱{net.toFixed(2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Your Takeout Orders</h2>
        {filteredOrders.length === 0 ? (
          <div className="text-sm text-gray-500">
            No orders for this month (or overall yet).
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Booking</th>
                <th className="p-2">Status</th>
                <th className="p-2">Date</th>
                <th className="p-2 text-right">Bill</th>
                <th className="p-2 text-right">Platform Fee</th>
                <th className="p-2 text-right">Your Earnings</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.id} className="border-b last:border-b-0">
                  <td className="p-2">{o.booking_code}</td>
                  <td className="p-2">
                    {o.vendor_status ?? o.customer_status ?? "-"}
                  </td>
                  <td className="p-2">{o.created_at ?? ""}</td>
                  <td className="p-2 text-right">
                    ₱{o.total_service_fare.toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₱{o.platform_fee_10pct.toFixed(2)}
                  </td>
                  <td className="p-2 text-right">
                    ₱{o.vendor_earnings_90pct.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Wallet Transactions</h2>
        {filteredWalletTxs.length === 0 ? (
          <div className="text-sm text-gray-500">
            No wallet transactions for this month (or overall yet).
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Date</th>
                <th className="p-2">Type</th>
                <th className="p-2">Booking</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {filteredWalletTxs.map((t, idx) => (
                <tr key={idx} className="border-b last:border-b-0">
                  <td className="p-2">{t.created_at}</td>
                  <td className="p-2">{t.kind}</td>
                  <td className="p-2">{t.booking_code ?? "-"}</td>
                  <td className="p-2 text-right">₱{t.amount.toFixed(2)}</td>
                  <td className="p-2">{t.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-2">Payout Requests</h2>
        {payoutRequests.length === 0 ? (
          <div className="text-sm text-gray-500">
            You have no payout requests yet.
          </div>
        ) : (
          <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
            <thead>
              <tr className="border-b bg-gray-50">
                <th className="p-2">Date</th>
                <th className="p-2 text-right">Amount</th>
                <th className="p-2">Status</th>
                <th className="p-2">Reviewed By</th>
                <th className="p-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {payoutRequests.map((r) => (
                <tr key={r.id} className="border-b last:border-b-0">
                  <td className="p-2">{r.created_at}</td>
                  <td className="p-2 text-right">
                    ₱{r.requested_amount.toFixed(2)}
                  </td>
                  <td className="p-2 capitalize">{r.status}</td>
                  <td className="p-2">{r.reviewed_by ?? "-"}</td>
                  <td className="p-2">{r.note ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
