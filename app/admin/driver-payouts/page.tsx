"use client";

import { useEffect, useMemo, useState } from "react";

type PayoutRow = {
  id: number | string;
  driver_id: string;
  amount: number;
  status: string | null;
  requested_at: string | null;
  processed_at: string | null;
  payout_method?: string | null;
  payout_ref?: string | null;
  receipt_url?: string | null;
  admin_note?: string | null;
};

type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function fmt(ts?: string | null) {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 180) return raw.slice(0, 180) + "…";
  return raw;
}

export default function AdminDriverPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  // Phase 4A required filter: driver
  const [driverQuery, setDriverQuery] = useState("");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts?status=${status}&limit=200`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Failed to load payouts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const filtered = useMemo(() => {
    const q = driverQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.driver_id || "").toLowerCase().includes(q));
  }, [rows, driverQuery]);

  const counts = useMemo(() => {
    const all = rows.length;
    const pending = rows.filter((r) => String(r.status || "").toLowerCase() === "pending").length;
    const paid = rows.filter((r) => String(r.status || "").toLowerCase() === "paid").length;
    return { all, pending, paid };
  }, [rows]);

  const bannerStyle = (k: "ok" | "warn" | "err") =>
    ({
      padding: "10px 12px",
      borderRadius: 10,
      border: "1px solid #e5e7eb",
      marginTop: 12,
      background: k === "ok" ? "#ecfdf5" : k === "warn" ? "#fffbeb" : "#fef2f2",
      color: k === "ok" ? "#065f46" : k === "warn" ? "#92400e" : "#991b1b",
      fontSize: 14,
      maxWidth: 980,
    } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Driver Payouts (Read-only)</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label>
          Status:&nbsp;
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="all">all</option>
          </select>
        </label>

        <label>
          Driver:&nbsp;
          <input
            value={driverQuery}
            onChange={(e) => setDriverQuery(e.target.value)}
            placeholder="search driver_id…"
            style={{ width: 280 }}
          />
        </label>

        <button onClick={load} disabled={loading}>
          Refresh
        </button>

        <span style={{ opacity: 0.8, fontSize: 13 }}>
          Counts: pending {counts.pending} · paid {counts.paid} · all {counts.all}
        </span>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["id", "driver_id", "amount", "status", "requested_at", "processed_at", "method", "ref", "note"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => (
              <tr key={String(r.id)}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(r.id)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>
                  {r.driver_id}
                </td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{Number(r.amount || 0).toFixed(2)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(r.status || "").toLowerCase()}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.requested_at)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.processed_at)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_method || ""}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_ref || ""}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  {r.admin_note || ""}
                </td>
              </tr>
            ))}

            {filtered.length === 0 ? (
              <tr>
                <td colSpan={9} style={{ padding: 12, color: "#666" }}>
                  No rows.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        Phase 4A guardrail: this screen is read-only and makes no wallet/ledger mutations.
      </div>
    </div>
  );
}
