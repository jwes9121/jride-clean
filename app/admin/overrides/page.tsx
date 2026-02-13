"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type OverrideRow = {
  override_id: number;
  booking_id: string;
  booking_code: string | null;
  town: string | null;
  status: string | null;
  trip_type: string | null;
  driver_id: string;
  driver_home_town: string | null;
  pickup_town: string | null;
  actor: string;
  reason: string | null;
  created_at: string;
};

function formatDateTimeLocal(iso: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export default function OverridesPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rows, setRows] = useState<OverrideRow[]>([]);
  const [loading, setLoading] = useState(false);

  // default range = last 7 days
  useEffect(() => {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const fromDateObj = new Date(now);
    fromDateObj.setDate(fromDateObj.getDate() - 6);
    const from = fromDateObj.toISOString().slice(0, 10);
    setFromDate(from);
    setToDate(to);
  }, []);

  const loadOverrides = async () => {
    if (!fromDate || !toDate) return;
    try {
      setLoading(true);
      const { data, error } = await supabase.rpc(
        "admin_get_ordinance_overrides",
        {
          p_from: fromDate,
          p_to: toDate,
        }
      );

      if (error) {
        console.error("admin_get_ordinance_overrides error:", error);
        setRows([]);
        return;
      }

      if (Array.isArray(data)) {
        setRows(data as OverrideRow[]);
      } else {
        setRows([]);
      }
    } catch (err) {
      console.error("loadOverrides failed:", err);
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  // auto-load once dates are initialized
  useEffect(() => {
    if (fromDate && toDate) {
      loadOverrides();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromDate, toDate]);

  return (
    <div className="flex h-full flex-col bg-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b bg-slate-50 px-4 py-3 text-sm">
        <div>
          <div className="font-semibold">Ordinance Override Log</div>
          <div className="text-[11px] text-slate-500">
            Every time the pickup-town rule is broken by an admin, it is logged here.
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <div className="flex items-center gap-1">
            <span>From</span>
            <input
              type="date"
              className="rounded border border-slate-300 px-2 py-1 text-[11px]"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-1">
            <span>To</span>
            <input
              type="date"
              className="rounded border border-slate-300 px-2 py-1 text-[11px]"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </div>
          <button
            onClick={loadOverrides}
            className="rounded bg-slate-800 px-3 py-1 text-[11px] font-semibold text-white hover:bg-slate-900 disabled:opacity-40"
            disabled={loading || !fromDate || !toDate}
          >
            {loading ? "Loading..." : "Load"}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {rows.length === 0 && !loading ? (
          <div className="p-4 text-[12px] text-slate-500">
            No overrides found for this range.
          </div>
        ) : (
          <table className="min-w-full border-t text-[11px]">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="border-b px-2 py-2 text-left">When</th>
                <th className="border-b px-2 py-2 text-left">Town</th>
                <th className="border-b px-2 py-2 text-left">Booking</th>
                <th className="border-b px-2 py-2 text-left">Status</th>
                <th className="border-b px-2 py-2 text-left">Trip type</th>
                <th className="border-b px-2 py-2 text-left">Pickup town</th>
                <th className="border-b px-2 py-2 text-left">Driver home town</th>
                <th className="border-b px-2 py-2 text-left">Actor</th>
                <th className="border-b px-2 py-2 text-left">Reason</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.override_id}
                  className="odd:bg-white even:bg-slate-50/40"
                >
                  <td className="border-b px-2 py-1">
                    {formatDateTimeLocal(row.created_at)}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.town || "-"}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.booking_code || row.booking_id}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.status || "-"}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.trip_type || "ride"}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.pickup_town || "-"}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.driver_home_town || "-"}
                  </td>
                  <td className="border-b px-2 py-1">
                    {row.actor}
                  </td>
                  <td className="border-b px-2 py-1 max-w-xs">
                    <div className="truncate" title={row.reason || ""}>
                      {row.reason || "-"}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
