"use client";

import { useEffect, useMemo, useState } from "react";

type WalletTx = {
  id: number;
  driver_id: string;
  amount: number;
  balance_after: number | null;
  reason: string | null;
  booking_id: string | null;
  created_at: string | null;
};

type PayoutReq = {
  id: number;
  driver_id: string;
  amount: number;
  status: string;
  requested_at: string | null;
  processed_at: string | null;
  payout_method: string | null;
  payout_ref: string | null;
  receipt_url: string | null;
  admin_note: string | null;
};

function s(v: any) { return String(v ?? "").trim(); }
function n(v: any) { const x = Number(v); return Number.isFinite(x) ? x : 0; }

function fmtMoney(v: any) {
  const x = n(v);
  return x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DriverWalletPage() {
  const [driverId, setDriverId] = useState("");
  const [status, setStatus] = useState<"all" | "pending" | "approved" | "paid" | "rejected">("all");

  const [bal, setBal] = useState<number>(0);
  const [tx, setTx] = useState<WalletTx[]>([]);
  const [reqs, setReqs] = useState<PayoutReq[]>([]);

  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    // TEMP: self-service via query param until driver auth is wired
    const sp = new URLSearchParams(window.location.search);
    const d = s(sp.get("driver_id"));
    if (d) setDriverId(d);
  }, []);

  async function loadAll() {
    const d = s(driverId);
    if (!d) { setMsg("Provide driver_id in the box (or URL ?driver_id=UUID)."); return; }

    setLoading(true);
    setMsg("");
    try {
      const w = await fetch(`/api/driver/wallet?driver_id=${encodeURIComponent(d)}&tx_limit=30`, { cache: "no-store" });
      const wj = await w.json().catch(() => ({} as any));
      if (!w.ok || !wj.ok) throw new Error(wj?.message || "Failed to load wallet");

      const p = await fetch(`/api/driver/payout-requests?driver_id=${encodeURIComponent(d)}&status=${encodeURIComponent(status)}&limit=50`, { cache: "no-store" });
      const pj = await p.json().catch(() => ({} as any));
      if (!p.ok || !pj.ok) throw new Error(pj?.message || "Failed to load payout history");

      setBal(n(wj.balance));
      setTx(Array.isArray(wj.transactions) ? wj.transactions : []);
      setReqs(Array.isArray(pj.requests) ? pj.requests : []);
    } catch (e: any) {
      setMsg(String(e?.message || e));
      setBal(0); setTx([]); setReqs([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (driverId) loadAll(); }, [status]);

  const totalCredits = useMemo(() => tx.reduce((a, r) => a + (n(r.amount) > 0 ? n(r.amount) : 0), 0), [tx]);
  const totalDebits  = useMemo(() => tx.reduce((a, r) => a + (n(r.amount) < 0 ? Math.abs(n(r.amount)) : 0), 0), [tx]);

  const card: any = { border: "1px solid #e5e7eb", borderRadius: 12, padding: 12, background: "white" };
  const btn: any = { padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, background: "white", cursor: "pointer", fontSize: 12 };
  const input: any = { padding: "6px 10px", border: "1px solid #ddd", borderRadius: 10, width: 380 };

  return (
    <div style={{ padding: 16 }}>
      <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Driver Wallet (Read-only)</h1>
      <div style={{ marginTop: 6, opacity: 0.7, fontSize: 12 }}>
        Self-service view. Locked: no mutations. For now, driver_id is provided via URL or input.
      </div>

      <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          style={input}
          value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          placeholder="driver_id UUID (or use ?driver_id=...)"
        />

        <select value={status} onChange={(e) => setStatus(e.target.value as any)} style={btn}>
          <option value="all">payout status: all</option>
          <option value="pending">pending</option>
          <option value="approved">approved</option>
          <option value="paid">paid</option>
          <option value="rejected">rejected</option>
        </select>

        <button style={btn} onClick={loadAll} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
      </div>

      {msg ? <div style={{ marginTop: 10, padding: 10, border: "1px solid #eee", borderRadius: 10 }}>{msg}</div> : null}

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        <div style={card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Current Balance</div>
          <div style={{ fontSize: 26, fontWeight: 900 }}>{fmtMoney(bal)}</div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
            Recent totals (last 30 tx): credits {fmtMoney(totalCredits)} Â· debits {fmtMoney(totalDebits)}
          </div>
        </div>

        <div style={card}>
          <div style={{ fontSize: 12, opacity: 0.7 }}>Quick Test Link</div>
          <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12, opacity: 0.85 }}>
            /driver/wallet?driver_id=YOUR_UUID
          </div>
          <div style={{ marginTop: 8, fontSize: 12, opacity: 0.7 }}>
            Phase 10B can wire this to driver session so no query param is needed.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Recent Wallet Transactions</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr>
                  {["id", "created_at", "amount", "balance_after", "reason", "booking_id"].map(h => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tx.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{r.id}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{s(r.created_at)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{fmtMoney(r.amount)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{r.balance_after == null ? "" : fmtMoney(r.balance_after)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{s(r.reason)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{s(r.booking_id)}</td>
                  </tr>
                ))}
                {tx.length === 0 ? (
                  <tr><td colSpan={6} style={{ padding: 10, opacity: 0.7 }}>No transactions.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div style={card}>
          <div style={{ fontWeight: 800, marginBottom: 8 }}>Payout Request History</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
              <thead>
                <tr>
                  {["id", "requested_at", "amount", "status", "processed_at", "payout_method", "payout_ref", "admin_note"].map(h => (
                    <th key={h} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 8, fontSize: 12 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {reqs.map(r => (
                  <tr key={r.id}>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{r.id}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{s(r.requested_at)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{fmtMoney(r.amount)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{s(r.status)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6", fontFamily: "monospace" }}>{s(r.processed_at)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{s(r.payout_method)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{s(r.payout_ref)}</td>
                    <td style={{ padding: 8, borderBottom: "1px solid #f3f4f6" }}>{s(r.admin_note)}</td>
                  </tr>
                ))}
                {reqs.length === 0 ? (
                  <tr><td colSpan={8} style={{ padding: 10, opacity: 0.7 }}>No payout requests.</td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

      </div>

      <div style={{ marginTop: 12, fontSize: 12, opacity: 0.7 }}>
        Locked rule: this page is read-only and intended for driver self-service. It does not mutate wallet or payout state.
      </div>
    </div>
  );
}