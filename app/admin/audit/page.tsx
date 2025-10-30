"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

type Row = {
  created_at: string;
  actor_email: string;
  action: string;
  reason: string | null;
  details: any;
  booking_id: string;
  rider_name: string | null;
  pickup_town: string | null;
  assigned_driver_id: string | null;
};

export default function AuditPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setErr(null);
      const { data, error } = await supabase.from("dispatch_audit_view").select().limit(200);
      if (error) setErr(error.message);
      setRows((data ?? []) as Row[]);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Admin · Audit</h1>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      {loading ? (
        <div className="text-sm opacity-70">Loading…</div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="py-2">Time</th>
              <th>Actor</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Booking</th>
              <th>Rider</th>
              <th>Town</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-b align-top">
                <td className="py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                <td className="whitespace-nowrap">{r.actor_email}</td>
                <td className="whitespace-nowrap">{r.action}</td>
                <td className="whitespace-nowrap">{r.reason ?? "—"}</td>
                <td className="whitespace-nowrap">{r.booking_id.slice(0, 8)}…</td>
                <td className="whitespace-nowrap">{r.rider_name ?? "—"}</td>
                <td className="whitespace-nowrap">{r.pickup_town ?? "—"}</td>
                <td className="text-xs">
                  <pre className="whitespace-pre-wrap">{JSON.stringify(r.details, null, 2)}</pre>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="py-6 text-center opacity-60">No audit entries</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
