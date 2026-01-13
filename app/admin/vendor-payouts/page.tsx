"use client";

import { useEffect, useMemo, useState } from "react";

type Row = {
  id: string;
  vendor_id: string;
  requested_amount: number;
  status: string | null;
  note: string | null;
  created_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
};

type Banner = { kind: "ok" | "warn" | "err"; text: string } | null;

function fmt(ts?: string | null) {
  if (!ts) return "";
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 260) return raw.slice(0, 260) + "â€¦";
  return raw;
}

export default function AdminVendorPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [vendorQuery, setVendorQuery] = useState("");

  const [markPaidId, setMarkPaidId] = useState<string | null>(null);
  const [reviewedBy, setReviewedBy] = useState("admin");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/vendor-payouts?status=${status}&limit=200`, { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Failed to load vendor payouts");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setRows([]);
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function markPaid(id: string) {
    setLoading(true);
    setBanner(null);
    try {
      const body = { id, action: "mark_paid", reviewed_by: reviewedBy || "admin" };
      const res = await fetch("/api/admin/vendor-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        const msg = data?.message || data?.error || data?.details || (data?.code ? `DB_ERROR ${data.code}` : "") || "Action failed";
        throw new Error(String(msg));
      }
      setBanner({ kind: "ok", text: `Marked paid for ${id}.` });
      setMarkPaidId(null);
      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const q = vendorQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => String(r.vendor_id || "").toLowerCase().includes(q));
  }, [rows, vendorQuery]);

  const btn: any = {
    padding: "6px 10px",
    border: "1px solid #ddd",
    borderRadius: 8,
    background: "white",
    cursor: "pointer",
    fontSize: 12,
  };
  const btnDisabled: any = { ...btn, opacity: 0.5, cursor: "not-allowed" };

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
      whiteSpace: "pre-wrap",
    } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Vendor Payouts</h1>

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
          Vendor:&nbsp;
          <input
            value={vendorQuery}
            onChange={(e) => setVendorQuery(e.target.value)}
            placeholder="search vendor_idâ€¦"
            style={{ width: 260 }}
          />
        </label>

        <button style={loading ? btnDisabled : btn} onClick={load} disabled={loading}>Refresh</button>
        {loading ? <span style={{ opacity: 0.7 }}>Loadingâ€¦</span> : null}
      </div>

      {banner ? <div style={bannerStyle(banner.kind)}>{banner.text}</div> : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["id","vendor_id","amount","status","created_at","reviewed_at","reviewed_by","note","actions"].map((h) => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{h}</th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((r) => {
              const st = String(r.status || "").toLowerCase();
              const canMarkPaid = st === "pending";
              return (
                <tr key={String(r.id)}>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{String(r.id)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{r.vendor_id}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{Number(r.requested_amount || 0).toFixed(2)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{st}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.created_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.reviewed_at)}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.reviewed_by || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.note || ""}</td>
                  <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                    <button
                      style={!canMarkPaid || loading ? btnDisabled : btn}
                      disabled={!canMarkPaid || loading}
                      onClick={() => { setMarkPaidId(String(r.id)); setReviewedBy("admin"); }}
                      title="pending -> paid (NO wallet mutation)"
                    >
                      Mark Paid
                    </button>
                  </td>
                </tr>
              );
            })}

            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 12, color: "#666" }}>No rows.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {markPaidId ? (
        <div style={{ marginTop: 14, padding: 12, border: "1px solid #ddd", borderRadius: 10, maxWidth: 720 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>Mark Paid - {markPaidId}</div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8, alignItems: "center" }}>
            <div>Reviewed by</div>
            <input value={reviewedBy} onChange={(e) => setReviewedBy(e.target.value)} placeholder="admin" />
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
            <button style={loading ? btnDisabled : btn} disabled={loading} onClick={() => markPaid(markPaidId)}>Confirm</button>
            <button style={loading ? btnDisabled : btn} disabled={loading} onClick={() => setMarkPaidId(null)}>Cancel</button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            Locked rule: this action updates vendor_payout_requests only. No vendor wallet balance mutations.
          </div>
        </div>
      ) : null}
    </div>
  );
}