"use client";

import { useEffect, useMemo, useState } from "react";

type PayoutRow = {
  id: number;
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
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();

  // Common best-practice mappings
  if (!raw) return "Request failed.";
  if (/insufficient wallet/i.test(raw)) return "Insufficient wallet.";
  if (/nothing to auto-approve/i.test(raw)) return "Nothing to auto-approve (no pending payouts).";
  if (/password authentication failed/i.test(raw)) return "Database auth failed (check DB password / connection).";
  if (/privileges/i.test(raw)) return "Insufficient privileges (check Supabase project access).";

  // If API returned JSON-ish error, keep it short
  if (raw.length > 180) return raw.slice(0, 180) + "…";
  return raw;
}

export default function AdminDriverPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const [approveId, setApproveId] = useState<number | null>(null);
  const [method, setMethod] = useState("GCASH");
  const [ref, setRef] = useState("");
  const [receipt, setReceipt] = useState("");
  const [note, setNote] = useState("");

  const pendingCount = useMemo(
    () => rows.filter(r => (r.status || "").toLowerCase() === "pending").length,
    [rows]
  );

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts?status=${status}&limit=100`, { cache: "no-store" });
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

  async function runAutoApprove() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts/auto-approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 100 }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Auto-approve failed");

      const checked = Number(data?.checked_count || 0);
      const approved = Number(data?.approved_count || 0);
      const skippedIns = Number(data?.skipped_insufficient || 0);
      const skippedOther = Number(data?.skipped_other || 0);

      if (checked === 0) {
        setBanner({ kind: "ok", text: "Nothing to auto-approve (no pending payouts)." });
      } else if (approved > 0) {
        setBanner({ kind: "ok", text: `Auto-approve complete: approved ${approved} / checked ${checked}.` });
      } else if (skippedIns > 0 && approved === 0) {
        setBanner({ kind: "warn", text: `No approvals: ${skippedIns} blocked by insufficient wallet.` });
      } else {
        setBanner({ kind: "warn", text: `Auto-approve ran: approved 0 / checked ${checked}.` });
      }

      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  async function approve() {
    if (!approveId) return;
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts/${approveId}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payout_method: method,
          payout_ref: ref || null,
          receipt_url: receipt || null,
          admin_note: note || null,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || "Approve failed");
      setApproveId(null);
      setRef(""); setReceipt(""); setNote("");
      setBanner({ kind: "ok", text: `Approved payout #${approveId}.` });
      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  const bannerStyle = (k: "ok" | "warn" | "err") => ({
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    marginTop: 12,
    background:
      k === "ok" ? "#ecfdf5" :
      k === "warn" ? "#fffbeb" :
      "#fef2f2",
    color:
      k === "ok" ? "#065f46" :
      k === "warn" ? "#92400e" :
      "#991b1b",
    fontSize: 14,
    maxWidth: 980,
  } as any);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Driver Payouts</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <label>
          Status:&nbsp;
          <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
            <option value="pending">pending</option>
            <option value="paid">paid</option>
            <option value="all">all</option>
          </select>
        </label>

        <button onClick={load} disabled={loading}>Refresh</button>

        <button onClick={runAutoApprove} disabled={loading || status !== "pending"}>
          Auto-Approve Pending ({pendingCount})
        </button>

        {loading ? <span style={{ opacity: 0.7 }}>Loading…</span> : null}
      </div>

      {banner ? (
        <div style={bannerStyle(banner.kind)}>
          {banner.text}
        </div>
      ) : null}

      <div style={{ marginTop: 12, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              {["id","driver_id","amount","status","requested_at","processed_at","method","ref","actions"].map(h => (
                <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.id}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee", fontFamily: "monospace" }}>{r.driver_id}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{Number(r.amount).toFixed(2)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{(r.status || "").toLowerCase()}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.requested_at)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{fmt(r.processed_at)}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_method || ""}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>{r.payout_ref || ""}</td>
                <td style={{ padding: 8, borderBottom: "1px solid #eee" }}>
                  <button
                    disabled={loading || (r.status || "").toLowerCase() !== "pending"}
                    onClick={() => { setApproveId(r.id); setMethod("GCASH"); setRef(""); setReceipt(""); setNote(""); }}
                  >
                    Approve
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: 12, color: "#666" }}>No rows.</td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {approveId ? (
        <div style={{ marginTop: 16, padding: 12, border: "1px solid #ddd", borderRadius: 10, maxWidth: 560 }}>
          <div style={{ fontWeight: 700 }}>Approve payout #{approveId}</div>

          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 8, marginTop: 10 }}>
            <div>Method</div>
            <input value={method} onChange={(e) => setMethod(e.target.value)} />

            <div>Reference</div>
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="required" />

            <div>Receipt URL</div>
            <input value={receipt} onChange={(e) => setReceipt(e.target.value)} placeholder="optional" />

            <div>Admin note</div>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={approve} disabled={loading || !ref.trim()}>Confirm Approve</button>
            <button onClick={() => setApproveId(null)} disabled={loading}>Cancel</button>
          </div>

          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            Tip: If you see “Insufficient wallet”, top up wallet or lower the driver’s min wallet requirement.
          </div>
        </div>
      ) : null}
    </div>
  );
}