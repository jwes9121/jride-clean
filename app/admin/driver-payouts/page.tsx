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
  try { return new Date(ts).toLocaleString(); } catch { return String(ts); }
}

function normalizeErr(e: any): string {
  const raw = (e?.message || e?.error || String(e || "")).trim();
  if (!raw) return "Request failed.";
  if (raw.length > 180) return raw.slice(0, 180) + "â€¦";
  return raw;
}

export default function AdminDriverPayoutsPage() {
  const [status, setStatus] = useState<"pending" | "paid" | "all">("pending");
  const [rows, setRows] = useState<PayoutRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);
  const [driverQuery, setDriverQuery] = useState("");

  const [actingId, setActingId] = useState<number | string | null>(null);
  const [method, setMethod] = useState("gcash");
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");

  async function load() {
    setLoading(true);
    setBanner(null);
    try {
      const res = await fetch(`/api/admin/driver-payouts?status=${status}&limit=200`, { cache: "no-store" });
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

  async function act(action: "approve" | "reject" | "mark_paid") {
    if (!actingId) return;
    setLoading(true);
    setBanner(null);
    try {
      const body: any = { id: actingId, action };
      if (action === "mark_paid") {
        body.payout_method = method;
        body.payout_ref = ref || null;
        body.admin_note = note || null;
      }
      const res = await fetch("/api/admin/driver-payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.message || data?.error || "Action failed");
      setActingId(null);
      setRef(""); setNote("");
      setBanner({ kind: "ok", text: `Action '${action}' applied.` });
      await load();
    } catch (e: any) {
      setBanner({ kind: "err", text: normalizeErr(e) });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [status]);

  const filtered = useMemo(() => {
    const q = driverQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r => String(r.driver_id || "").toLowerCase().includes(q));
  }, [rows, driverQuery]);

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 700 }}>Driver Payouts</h1>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
        <select value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="pending">pending</option>
          <option value="paid">paid</option>
          <option value="all">all</option>
        </select>

        <input
          value={driverQuery}
          onChange={(e) => setDriverQuery(e.target.value)}
          placeholder="search driver_idâ€¦"
          style={{ width: 260 }}
        />

        <button onClick={load} disabled={loading}>Refresh</button>
      </div>

      {banner ? <div style={{ marginTop: 10 }}>{banner.text}</div> : null}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr>
            {["id","driver_id","amount","status","requested_at","processed_at","method","ref","note","actions"].map(h => (
              <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #ddd", padding: 8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map(r => (
            <tr key={String(r.id)}>
              <td>{r.id}</td>
              <td style={{ fontFamily: "monospace" }}>{r.driver_id}</td>
              <td>{Number(r.amount).toFixed(2)}</td>
              <td>{r.status}</td>
              <td>{fmt(r.requested_at)}</td>
              <td>{fmt(r.processed_at)}</td>
              <td>{r.payout_method || ""}</td>
              <td>{r.payout_ref || ""}</td>
              <td>{r.admin_note || ""}</td>
              <td>
                {String(r.status).toLowerCase() === "pending" ? (
                  <>
                    <button onClick={() => { setActingId(r.id); act("approve"); }}>Approve</button>
                    <button onClick={() => { setActingId(r.id); act("reject"); }}>Reject</button>
                    <button onClick={() => setActingId(r.id)}>Mark Paid</button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {actingId ? (
        <div style={{ marginTop: 12 }}>
          <h3>Mark Paid</h3>
          <input value={method} onChange={e => setMethod(e.target.value)} placeholder="method" />
          <input value={ref} onChange={e => setRef(e.target.value)} placeholder="reference" />
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="note" />
          <button disabled={!ref} onClick={() => act("mark_paid")}>Confirm</button>
          <button onClick={() => setActingId(null)}>Cancel</button>
        </div>
      ) : null}
    </div>
  );
}