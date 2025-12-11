"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type PayoutRequestRow = {
  id: string;
  vendor_id: string;
  requested_amount: number;
  status: string;
  note: string | null;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  vendor_email: string | null;
  vendor_name: string | null;
};

export default function AdminPayoutRequestsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<PayoutRequestRow[]>([]);

  async function load() {
    try {
      setError(null);
      setLoading(true);

      const res = await fetch(
        "/api/takeout/admin/vendor-payout/list-requests"
      );
      const json = await res.json();

      if (!res.ok) {
        throw new Error(json.error || "Failed to load payout requests.");
      }

      const mapped: PayoutRequestRow[] = (json.requests ?? []).map(
        (r: any) => ({
          id: r.id,
          vendor_id: r.vendor_id,
          requested_amount: Number(r.requested_amount ?? 0),
          status: r.status,
          note: r.note ?? null,
          created_at: r.created_at,
          reviewed_at: r.reviewed_at ?? null,
          reviewed_by: r.reviewed_by ?? null,
          vendor_email: r.vendor_email ?? null,
          vendor_name: r.vendor_name ?? null,
        })
      );

      setRows(mapped);
    } catch (err: any) {
      console.error("Failed to load payout requests:", err);
      setError(err?.message || "Failed to load payout requests.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSettle(row: PayoutRequestRow) {
    if (row.status !== "pending") return;

    const vendorLabel = row.vendor_name || row.vendor_email || row.vendor_id;

    const confirmed = window.confirm(
      `Mark this payout request as PAID (cash)?\n\nVendor: ${vendorLabel}\nAmount: ₱${row.requested_amount.toFixed(
        2
      )}\n\nThis will create a payout wallet transaction and mark the request as paid.`
    );
    if (!confirmed) return;

    try {
      setSavingId(row.id);
      setError(null);

      const res = await fetch(
        "/api/takeout/admin/vendor-payout/settle-request",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ requestId: row.id }),
        }
      );

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json.error || "Failed to settle payout request.");
      }

      // Reload list after settlement
      await load();
      router.refresh();
    } catch (err: any) {
      console.error("Failed to settle payout request:", err);
      setError(err?.message || "Failed to settle payout request.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            Takeout – Admin Vendor Payout Requests
          </h1>
          <div className="text-sm text-gray-600 mt-1">
            Global queue of vendor payout requests
          </div>
        </div>
        <button
          className="text-sm text-blue-600 hover:underline"
          onClick={() => router.push("/takeout/admin/payouts")}
        >
          ← Back to Vendor Payouts Summary
        </button>
      </div>

      {error && (
        <div className="text-sm text-red-600 border border-red-200 bg-red-50 px-3 py-2 rounded">
          {error}
        </div>
      )}

      {loading ? (
        <div>Loading payout requests...</div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-gray-500">
          There are no payout requests yet.
        </div>
      ) : (
        <table className="w-full text-left border-collapse text-sm bg-white rounded-lg shadow overflow-hidden">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="p-2">Requested At</th>
              <th className="p-2">Vendor</th>
              <th className="p-2 text-right">Amount</th>
              <th className="p-2">Status</th>
              <th className="p-2">Reviewed By</th>
              <th className="p-2">Note</th>
              <th className="p-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-b-0">
                <td className="p-2">{r.created_at}</td>
                <td className="p-2">
                  <div className="font-medium">
                    {r.vendor_name ?? "Unnamed Vendor"}
                  </div>
                  <div className="text-xs text-gray-500">
                    {r.vendor_email ?? r.vendor_id}
                  </div>
                </td>
                <td className="p-2 text-right">
                  ₱{r.requested_amount.toFixed(2)}
                </td>
                <td className="p-2 capitalize">{r.status}</td>
                <td className="p-2">{r.reviewed_by ?? "-"}</td>
                <td className="p-2">{r.note ?? ""}</td>
                <td className="p-2 text-right">
                  {r.status === "pending" ? (
                    <button
                      onClick={() => handleSettle(r)}
                      disabled={savingId === r.id}
                      className="px-3 py-1 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 disabled:bg-gray-300"
                    >
                      {savingId === r.id ? "Processing..." : "Mark as Paid (Cash)"}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-500">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
