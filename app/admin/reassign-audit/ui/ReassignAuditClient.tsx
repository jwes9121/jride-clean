"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: number;
  created_at: string;
  created_by: string;
  booking_id: string;
  booking_code: string | null;
  from_driver_id: string | null;
  to_driver_id: string;
  reason: string | null;
};

function ymd(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export default function ReassignAuditClient() {
  const today = useMemo(() => new Date(), []);
  const [from, setFrom] = useState<string>(ymd(new Date(today.getTime() - 7 * 86400000)));
  const [to, setTo] = useState<string>(ymd(today));
  const [bookingCode, setBookingCode] = useState("");
  const [fromDriver, setFromDriver] = useState("");
  const [toDriver, setToDriver] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const qs = new URLSearchParams();
      if (from) qs.set("from", from);
      if (to) qs.set("to", to);
      if (bookingCode.trim()) qs.set("booking_code", bookingCode.trim());
      if (fromDriver.trim()) qs.set("from_driver_id", fromDriver.trim());
      if (toDriver.trim()) qs.set("to_driver_id", toDriver.trim());

      const res = await fetch(`/api/admin/reassign-audit?${qs.toString()}`, { cache: "no-store" });
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error || "Failed to load");
      setRows(j.rows || []);
    } catch (e: any) {
      setErr(e?.message || String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function exportCsv() {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    if (bookingCode.trim()) qs.set("booking_code", bookingCode.trim());
    if (fromDriver.trim()) qs.set("from_driver_id", fromDriver.trim());
    if (toDriver.trim()) qs.set("to_driver_id", toDriver.trim());
    window.location.href = `/api/admin/reassign-audit/export?${qs.toString()}`;
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "end" }}>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>From</div>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>To</div>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>Booking code</div>
          <input value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} placeholder="JR-2025-0002" />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>From driver (uuid)</div>
          <input value={fromDriver} onChange={(e) => setFromDriver(e.target.value)} placeholder="uuid" />
        </div>
        <div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>To driver (uuid)</div>
          <input value={toDriver} onChange={(e) => setToDriver(e.target.value)} placeholder="uuid" />
        </div>

        <button onClick={load} disabled={loading} style={{ padding: "6px 12px" }}>
          {loading ? "Loading..." : "Refresh"}
        </button>

        <button onClick={exportCsv} style={{ padding: "6px 12px" }}>
          Export CSV
        </button>
      </div>

      {err && (
        <div style={{ marginTop: 12, color: "crimson", whiteSpace: "pre-wrap" }}>
          {err}
        </div>
      )}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid #ddd" }}>
              <th style={{ padding: 8 }}>created_at</th>
              <th style={{ padding: 8 }}>booking_code</th>
              <th style={{ padding: 8 }}>from_driver</th>
              <th style={{ padding: 8 }}>to_driver</th>
              <th style={{ padding: 8 }}>reason</th>
              <th style={{ padding: 8 }}>created_by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                <td style={{ padding: 8, whiteSpace: "nowrap" }}>{new Date(r.created_at).toLocaleString()}</td>
                <td style={{ padding: 8 }}>{r.booking_code || ""}</td>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{r.from_driver_id || ""}</td>
                <td style={{ padding: 8, fontFamily: "monospace" }}>{r.to_driver_id}</td>
                <td style={{ padding: 8 }}>{r.reason || ""}</td>
                <td style={{ padding: 8 }}>{r.created_by}</td>
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td style={{ padding: 10, opacity: 0.7 }} colSpan={6}>No rows</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
